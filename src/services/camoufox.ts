import { postJSON } from 'src/api/kernel';
import type { ReadItLaterSettings } from 'src/settings';

export interface CamoufoxConfig {
    baseUrl: string;
    token: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
}

interface JsonRpcResponse {
    result?: {
        content?: Array<{ type?: string; text?: string }>;
    };
    error?: { code?: number; message?: string };
}

/**
 * Minimal client for a self-hosted camoufox MCP server
 * (Streamable HTTP transport: JSON-RPC request in, SSE `data:` line out).
 *
 * The plugin cannot drive a browser itself: SiYuan frontends have no process
 * execution, and the 2.5GB camoufox browser cannot ship inside a marketplace
 * plugin. Parsers that need a real browser (anti-scraping walls like Zhihu's
 * zse-ck challenge) delegate the page render to this external service, which
 * the user deploys separately and configures under the global settings.
 */
export class CamoufoxClient {
    private id = 0;

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
            token: String(settings.camoufoxApiToken ?? ''),
            timeoutMs: Number.isFinite(waitSeconds) && waitSeconds > 0 ? Math.round(waitSeconds * 1000) : 30000,
        });
    }

    async serverStatus(): Promise<Record<string, unknown>> {
        return (await this.callTool('server_status', {})) as Record<string, unknown>;
    }

    /**
     * Renders a URL in a throwaway tab and returns the extracted HTML plus
     * the evaluated metadata. The tab is always closed afterwards.
     */
    async renderPage<T>(
        url: string,
        options: {
            /** CSS selector to wait for before extracting; empty skips the wait. */
            waitSelector?: string;
            /** Selector scoping the HTML extraction; empty returns full page HTML. */
            htmlSelector?: string;
            /** JS expressions evaluated against the rendered page. */
            expressions?: Record<string, string>;
        } = {},
    ): Promise<{ html: string; values: T }> {
        const tabId = await this.createTab(url);
        try {
            if (options.waitSelector) {
                await this.waitForSelector(tabId, options.waitSelector);
            }
            const html = await this.getPageHtml(tabId, options.htmlSelector);
            const values = {} as Record<string, unknown>;
            for (const [key, expression] of Object.entries(options.expressions ?? {})) {
                values[key] = await this.evaluateJs(tabId, expression);
            }
            return { html, values: values as T };
        } finally {
            await this.closeTab(tabId).catch(() => {
                // Best effort: the tab is server-side and expires on its own.
            });
        }
    }

    private async createTab(url: string): Promise<string> {
        const result = (await this.callTool('create_tab', { url })) as { tabId?: unknown };
        if (typeof result.tabId !== 'string' || !result.tabId) {
            throw new Error('camoufox create_tab returned no tabId');
        }
        return result.tabId;
    }

    private async waitForSelector(tabId: string, selector: string): Promise<void> {
        await this.callTool('camofox_wait_for_selector', {
            tabId,
            selector,
            timeout: this.config.timeoutMs,
        });
    }

    private async getPageHtml(tabId: string, selector?: string): Promise<string> {
        const result = (await this.callTool('camofox_get_page_html', {
            tabId,
            ...(selector ? { selector } : {}),
        })) as { html?: unknown };
        if (typeof result.html !== 'string') {
            throw new Error('camoufox get_page_html returned no html');
        }
        return result.html;
    }

    private async evaluateJs(tabId: string, expression: string): Promise<unknown> {
        const result = (await this.callTool('camofox_evaluate_js', { tabId, expression })) as {
            result?: unknown;
        };
        return result.result;
    }

    private async closeTab(tabId: string): Promise<void> {
        await this.callTool('close_tab', { tabId });
    }

    private async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
        const rpc = {
            jsonrpc: '2.0',
            id: ++this.id,
            method: 'tools/call',
            params: { name: tool, arguments: args },
        };
        let status: number;
        let text: string;
        try {
            ({ status, text } = await this.postDirect(JSON.stringify(rpc)));
        } catch (error) {
            // Direct frontend fetch fails when the MCP server omits CORS
            // headers (cross-origin 6806 -> 3000) or the host resolves only
            // inside docker. Retry through the kernel forward proxy (same
            // origin, no CORS), which forwards from the kernel's network.
            console.warn(`ReadItLater: camoufox direct ${tool} failed, retrying via kernel proxy`, error);
            ({ status, text } = await this.postViaKernelProxy(rpc));
        }
        if (status === 401 || status === 403) {
            throw new Error(`camoufox ${tool} rejected (HTTP ${status}): check the API token`);
        }
        if (status < 200 || status >= 300) {
            throw new Error(`camoufox ${tool} failed: HTTP ${status}`);
        }
        const payload = CamoufoxClient.parseSse(text);
        const content = payload.result?.content?.[0]?.text;
        if (payload.error) {
            throw new Error(`camoufox ${tool} error: ${payload.error.message ?? payload.error.code}`);
        }
        if (typeof content !== 'string') {
            throw new Error(`camoufox ${tool} returned an unexpected response`);
        }
        const parsed: { isError?: boolean; message?: string } = JSON.parse(content);
        if (parsed.isError === true) {
            throw new Error(`camoufox ${tool} failed: ${parsed.message ?? content.slice(0, 200)}`);
        }
        return parsed;
    }

    private async postDirect(body: string): Promise<{ status: number; text: string }> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs + 15000);
        try {
            const response = await fetch(`${this.config.baseUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
                },
                body,
                signal: controller.signal,
            });
            return { status: response.status, text: await response.text() };
        } finally {
            clearTimeout(timer);
        }
    }

    private async postViaKernelProxy(rpc: Record<string, unknown>): Promise<{ status: number; text: string }> {
        const headers: Array<Record<string, string>> = [{ Accept: 'application/json, text/event-stream' }];
        if (this.config.token) {
            headers.push({ Authorization: `Bearer ${this.config.token}` });
        }
        // Payload MUST be an object: forwardProxy JSON-serializes it as the
        // request body, while a string payload gets quoted and the MCP server
        // answers 400 Parse error (verified against kernel/api/network.go).
        const data = await postJSON<{
            status: number;
            body: string;
            bodyEncoding: string;
        }>(
            '/api/network/forwardProxy',
            {
                url: `${this.config.baseUrl}/mcp`,
                method: 'POST',
                timeout: this.config.timeoutMs + 15000,
                headers,
                contentType: 'application/json',
                payload: rpc,
                responseEncoding: 'text',
                redirect: true,
            },
            this.config.timeoutMs + 20000,
        );
        if (data.bodyEncoding !== 'text') {
            throw new Error('camoufox kernel proxy returned a non-text body');
        }
        return { status: data.status, text: data.body };
    }

    private static parseSse(body: string): JsonRpcResponse {
        const dataLines = body
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim());
        if (dataLines.length === 0) {
            throw new Error('camoufox returned an empty SSE stream');
        }
        return JSON.parse(dataLines.join('\n')) as JsonRpcResponse;
    }
}
