/**
 * Camoufox browser client — direct REST against the camofox-browser
 * container (no MCP layer).
 *
 * The camofox-mcp container is a thin JSON-RPC wrapper around this exact
 * REST API (camofox-browser serves `/tabs`, `/sessions/...`, `/evaluate`
 * natively; the MCP server only translates protocol). Going straight to
 * the browser removes the MCP layer's fixed 30s call cap (challenge pages
 * can load longer and the browser keeps rendering) and its session-state
 * false negatives. Requires the SiYuan container to share a docker network
 * with camofox-browser; all calls are forwarded through the SiYuan kernel
 * HTTP API (`/api/network/forwardProxy`) because the plugin frontend
 * cannot reach container DNS.
 *
 * Anti-scraping walls (Zhihu zse-ck) additionally require a non-headless
 * rendering path: `virtualDisplay` switches the browser to a virtual
 * (Xvfb) display — persisted server-side per session.
 */
import { postJSON } from 'src/api/kernel';
import type { ReadItLaterSettings } from 'src/settings';

export interface CamoufoxConfig {
    /** Browser service base, e.g. `http://camofox-browser:8080`. */
    baseUrl: string;
    /** API key when the browser service requires it (x-api-key + Bearer). */
    apiKey: string;
    /** Selector-wait budget in seconds (drives poll timeout). */
    waitSeconds: number;
    /** SiYuan user id scoping the browser session. */
    userId: string;
    /** Render on a virtual (Xvfb) display instead of headless. */
    virtualDisplay: boolean;
}

export interface StageUpdate {
    percent: number;
    /** i18n key for the stage description. */
    stageKey: string;
}

interface BrowserResponse {
    ok?: boolean;
    result?: unknown;
    truncated?: boolean;
    error?: string;
    [key: string]: unknown;
}

export class CamoufoxClient {
    constructor(private readonly config: CamoufoxConfig) {}

    static fromSettings(settings: ReadItLaterSettings): CamoufoxClient | null {
        if (settings.camoufoxEnabled !== true) {
            return null;
        }
        const baseUrl = String(settings.camoufoxApiUrl ?? '')
            .trim()
            .replace(/\/+$/, '');
        if (!baseUrl) {
            return null;
        }
        const waitSeconds = Number(settings.camoufoxWaitSeconds);
        return new CamoufoxClient({
            baseUrl,
            apiKey: String(settings.camoufoxApiToken ?? ''),
            waitSeconds: Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds : 30,
            userId: 'default',
            virtualDisplay: settings.camoufoxVirtualDisplay !== false,
        });
    }

    async serverStatus(): Promise<Record<string, unknown>> {
        return (await this.requestJson('/health', { method: 'GET' })) as Record<string, unknown>;
    }

    /**
     * Switches the session to a virtual (Xvfb) display. Anti-scraping walls
     * fingerprint headless sessions and soft-block UGC pages for them; the
     * override persists server-side per session, so a TIMEOUT on this call
     * still applied it and the caller should proceed.
     */
    async enableVirtualDisplay(): Promise<void> {
        await this.requestNoContent(
            `/sessions/${encodeURIComponent(this.config.userId)}/toggle-display`,
            { method: 'POST', body: JSON.stringify({ headless: 'virtual' }) },
        );
    }

    /**
     * Imports cookies into the browser session jar (persisted with the
     * session profile). `cookies` is a Cookie-header string ("k=v; k2=v2").
     */
    async importCookieHeader(cookieHeader: string, domain = '.zhihu.com'): Promise<void> {
        const cookies = cookieHeader
            .split(';')
            .map((pair) => {
                const eq = pair.indexOf('=');
                if (eq <= 0) return null;
                const name = pair.slice(0, eq).trim();
                const value = pair.slice(eq + 1).trim();
                if (!name || !value) return null;
                return { name, value, domain, path: '/' };
            })
            .filter(Boolean);
        if (!cookies.length) return;
        await this.requestNoContent(
            `/sessions/${encodeURIComponent(this.config.userId)}/cookies`,
            { method: 'POST', body: JSON.stringify({ cookies }) },
        );
    }

    /**
     * Renders a URL in a throwaway tab and returns the extracted HTML plus
     * the evaluated metadata. Stages are reported through `onStage` with
     * i18n keys; the tab is always closed afterwards.
     */
    async renderPage<T>(
        url: string,
        options: {
            waitSelector?: string;
            htmlSelector?: string;
            expressions?: Record<string, string>;
        } = {},
        onStage?: (percent: number, stageKey: string) => void,
    ): Promise<{ html: string; values: T }> {
        if (this.config.virtualDisplay) {
            await this.enableVirtualDisplay();
        }
        onStage?.(10, 'clippingStageConnecting');
        const tabId = await this.createTabWithRecovery(url);
        try {
            onStage?.(30, 'clippingStageRendering');
            if (options.waitSelector) {
                await this.waitForSelector(tabId, options.waitSelector);
            }
            onStage?.(60, 'clippingStageExtracting');
            const html = await this.getPageHtml(tabId, options.htmlSelector);
            const values = {} as Record<string, unknown>;
            for (const [key, expression] of Object.entries(options.expressions ?? {})) {
                values[key] = await this.evaluateJs(tabId, expression);
            }
            return { html, values: values as T };
        } finally {
            await this.closeTab(tabId).catch(() => undefined);
        }
    }

    private async createTabWithRecovery(url: string): Promise<string> {
        let tabId: string | undefined;
        try {
            const created = (await this.requestJson('/tabs', {
                method: 'POST',
                body: JSON.stringify({ url, userId: this.config.userId }),
            })) as { tabId?: string; id?: string };
            tabId = created.tabId ?? created.id;
        } catch {
            tabId = undefined;
        }
        if (!tabId) {
            // The MCP server answers TIMEOUT after its fixed 30s call cap on
            // challenge pages while the tab keeps loading — recover the
            // tabId from the tab list instead of failing the clip.
            await new Promise((r) => setTimeout(r, 3000));
            const rows = (await this.requestJson('/tabs', { method: 'GET' })) as unknown;
            const list = Array.isArray(rows)
                ? (rows as Array<{ url?: string; tabId?: string }>)
                : [];
            const target = url.split('?')[0] ?? url;
            const mine = list.filter((row) => (row.url ?? '').startsWith(target));
            tabId = (mine[0] ?? list[list.length - 1])?.tabId;
            if (!tabId) {
                throw new Error('camoufox create_tab timed out and no tab could be recovered');
            }
        }
        return tabId;
    }

    private async waitForSelector(tabId: string, selector: string): Promise<void> {
        // Poll via evaluate: the browser service has no native selector-wait
        // endpoint, and a long-running evaluate hits its internal 5s cap —
        // so poll outside with the full wait budget.
        const deadline = Date.now() + this.config.waitSeconds * 1000;
        const exists = `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
        while (Date.now() < deadline) {
            const r = (await this.evaluateJs(tabId, exists).catch(() => null)) as
                | { result?: unknown }
                | null;
            if (r?.result === true) return;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`camoufox wait: selector not found within budget: ${selector}`);
    }

    private async getPageHtml(tabId: string, selector?: string): Promise<string> {
        const expr = selector
            ? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)}); return el.innerHTML; })()`
            : 'document.documentElement.outerHTML';
        const r = await this.evaluateJs(tabId, expr);
        if (typeof r.result !== 'string') {
            throw new Error('camoufox html extraction returned no html');
        }
        return r.result;
    }

    private async evaluateJs(tabId: string, expression: string): Promise<{ result?: unknown }> {
        return (await this.evaluate(tabId, expression)) as { result?: unknown };
    }

    private async evaluate(tabId: string, expression: string): Promise<BrowserResponse> {
        return (await this.requestJson(`/tabs/${encodeURIComponent(tabId)}/evaluate`, {
            method: 'POST',
            body: JSON.stringify({ expression, userId: this.config.userId }),
        })) as BrowserResponse;
    }

    private async closeTab(tabId: string): Promise<void> {
        await this.requestNoContent(`/tabs/${encodeURIComponent(tabId)}`, { method: 'DELETE' });
    }

    private async requestNoContent(path: string, init: { method?: string; body?: string }): Promise<void> {
        await this.request(path, init);
    }

    private async requestJson(path: string, init: { method?: string; body?: string }): Promise<unknown> {
        const text = await this.request(path, init);
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`camoufox: non-JSON response from ${path}`);
        }
    }

    private async request(path: string, init: { method?: string; body?: string }): Promise<string> {
        const headers: Record<string, string> = {
            contentType: 'application/json',
            accept: 'application/json, text/event-stream',
        };
        if (this.config.apiKey) {
            headers.authorization = `Bearer ${this.config.apiKey}`;
        }
        const timeoutMs = this.config.waitSeconds * 1000 + 15000;
        const result = await postJSON(
            '/api/network/forwardProxy',
            {
                url: `${this.config.baseUrl}${path}`,
                method: init.method ?? 'GET',
                timeout: timeoutMs,
                headers: [Object.entries(headers).map(([k, v]) => ({ [k]: v })).reduce((a, b) => ({ ...a, ...b }), {})],
                contentType: init.body !== undefined ? 'application/json' : undefined,
                payload: init.body ?? '',
                payloadEncoding: 'text',
                responseEncoding: 'text',
                redirect: true,
            },
            timeoutMs + 5000,
        );
        if (result.status >= 400) {
            // 404 almost always means the URL points at the wrong port: the
            // REST API lives on camofox-browser:8080 (e.g. 9377 is not it).
            const hint = result.status === 404 ? ' (wrong port? the REST API listens on 8080)' : '';
            throw new Error(`camoufox ${init.method ?? 'GET'} ${path}: HTTP ${result.status}${hint}`);
        }
        return result.body;
    }

}
