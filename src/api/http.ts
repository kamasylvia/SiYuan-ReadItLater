import { postJSON } from './kernel';

/**
 * HTTP layer backed by the SiYuan kernel forward proxy (/api/network/forwardProxy).
 * It exposes the same shapes the parsers used from Obsidian (`requestUrl` and `request`),
 * so parser code only needed an import swap.
 *
 * Going through the kernel avoids CORS restrictions entirely and works on every
 * frontend (desktop, mobile, browser) without extra configuration.
 */

export interface RequestUrlResponseLike {
    status: number;
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
    text: string;
    json: any;
}

export interface RequestOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    contentType?: string;
    /** Request timeout in milliseconds, defaults to 30s. */
    timeout?: number;
}

interface IForwardProxyData {
    url: string;
    status: number;
    contentType: string;
    body: string;
    bodyEncoding: string;
    headers: Record<string, string[]>;
    elapsed: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

function base64Decode(value: string): ArrayBuffer {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function normalizeHeaders(headers: Record<string, string[]> | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) {
        return result;
    }
    for (const [key, values] of Object.entries(headers)) {
        if (values && values.length > 0) {
            result[key.toLowerCase()] = values.join(', ');
        }
    }
    return result;
}

async function forwardProxy(options: RequestOptions, responseEncoding: 'text' | 'base64'): Promise<IForwardProxyData> {
    const headerEntries = Object.entries(options.headers ?? {})
        .filter(([key]) => key.toLowerCase() !== 'content-type')
        .map(([key, value]) => ({ [key]: value }));

    let payload: string | Record<string, unknown> = '';
    let payloadEncoding: string | undefined;
    if (typeof options.body === 'string') {
        payload = options.body;
        payloadEncoding = 'text';
    } else if (options.body) {
        payload = options.body;
    }

    return await postJSON<IForwardProxyData>('/api/network/forwardProxy', {
        url: options.url,
        method: (options.method ?? 'GET').toUpperCase(),
        timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
        headers: headerEntries,
        contentType: options.contentType,
        payloadEncoding,
        payload,
        responseEncoding,
        redirect: true,
    });
}

/**
 * Drop-in replacement for Obsidian's `requestUrl`. The response body is fetched as
 * base64 so binary downloads (images) keep working; `text`/`json` decode it on demand.
 */
export async function requestUrl(options: RequestOptions): Promise<RequestUrlResponseLike> {
    const data = await forwardProxy(options, 'base64');
    const headers = normalizeHeaders(data.headers);
    const arrayBuffer =
        data.bodyEncoding === 'text' ? new TextEncoder().encode(data.body).buffer : base64Decode(data.body);
    const text = data.bodyEncoding === 'text' ? data.body : new TextDecoder('utf-8').decode(arrayBuffer);

    return {
        status: data.status,
        headers,
        arrayBuffer,
        text,
        json: undefined,
    };
}

/**
 * Drop-in replacement for Obsidian's `request`: returns the response body as text.
 * Parsers feed it to JSON.parse themselves.
 */
export async function request(options: RequestOptions): Promise<string> {
    const data = await forwardProxy(options, 'text');
    return data.bodyEncoding === 'text' ? data.body : new TextDecoder('utf-8').decode(base64Decode(data.body));
}

export function getRequestStatus(response: RequestUrlResponseLike): number {
    return response.status;
}

/**
 * Forwards an arbitrary request through the kernel proxy and reconstitutes a
 * synthetic `Response` (binary body, status), keeping the same downstream
 * interface as a direct `fetch`. Used as the fallback when the browser blocks
 * a direct request (remote-mode CORS / mixed content). Binary payloads are
 * base64-forwarded; when the kernel cannot resolve the target hostname (docker
 * deployments vs Tailscale names) the port is kept and the host is retried via
 * `host.docker.internal`.
 */
export async function kernelForward(
    url: string,
    method: string,
    payload?: string | Uint8Array,
    contentType?: string,
    proxyHeaders?: Record<string, string>,
): Promise<Response> {
    try {
        return await kernelForwardOnce(url, method, payload, contentType, proxyHeaders);
    } catch (error) {
        const message = String((error as Error)?.message ?? error);
        if (!message.includes('no such host')) {
            throw error;
        }
        const rewritten = new URL(url);
        rewritten.hostname = 'host.docker.internal';
        return await kernelForwardOnce(rewritten.toString(), method, payload, contentType, proxyHeaders);
    }
}

async function kernelForwardOnce(
    url: string,
    method: string,
    payload: string | Uint8Array | undefined,
    contentType: string | undefined,
    proxyHeaders: Record<string, string> | undefined,
): Promise<Response> {
    const body: Record<string, unknown> = {
        url,
        method: method.toUpperCase(),
        timeout: DEFAULT_TIMEOUT_MS,
        responseEncoding: 'base64',
        headers: Object.entries(proxyHeaders ?? {}).map(([key, value]) => ({ [key]: value })),
    };
    if (payload !== undefined) {
        if (payload instanceof Uint8Array) {
            let binary = '';
            for (let i = 0; i < payload.length; i++) {
                binary += String.fromCharCode(payload[i]);
            }
            body.payload = btoa(binary);
            body.payloadEncoding = 'base64';
        } else {
            body.payload = payload;
        }
    }
    if (contentType !== undefined) {
        body.contentType = contentType;
    }

    const data = await postJSON<IForwardProxyData>('/api/network/forwardProxy', body);
    const bytes =
        data.bodyEncoding === 'text' ? new TextEncoder().encode(data.body) : new Uint8Array(base64Decode(data.body));
    const responseHeaders = data.contentType ? { 'Content-Type': data.contentType } : {};
    return new Response(bytes, { status: data.status, headers: responseHeaders });
}
