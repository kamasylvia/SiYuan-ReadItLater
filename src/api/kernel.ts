export interface IKernelResponse<T = any> {
    code: number;
    msg: string;
    data: T;
}

/**
 * POST JSON to the SiYuan kernel API and return the parsed envelope {code, msg, data}.
 * Throws when the kernel reports a non-zero code or the request itself fails.
 */
export async function postJSON<T = any>(
    endpoint: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000,
): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`${endpoint} failed with HTTP ${response.status}`);
        }

        const result = (await response.json()) as IKernelResponse<T>;
        if (result.code !== 0) {
            throw new Error(result.msg || `${endpoint} failed with code ${result.code}`);
        }

        return result.data;
    } finally {
        window.clearTimeout(timer);
    }
}

export interface INotebook {
    id: string;
    name: string;
    icon: string;
    closed: boolean;
    sort: number;
}

export function listNotebooks(): Promise<INotebook[]> {
    return postJSON<{ notebooks: INotebook[] }>('/api/notebook/lsNotebooks').then((data) => data.notebooks ?? []);
}
