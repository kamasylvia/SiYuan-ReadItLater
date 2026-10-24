import { kernelForward } from 'src/api/http';
import ReadItLaterPlugin from 'src/main';

/**
 * Uploads clipped resources to a self-hosted image bed (Sanyue-ImgHub /
 * CloudFlare-ImgBed compatible: POST /upload, multipart `file` field,
 * optional Bearer token, response `[{src: "/file/<name>"}]`).
 *
 * Uploads go direct first; when the browser blocks the request (remote-mode
 * CORS / mixed content) or the bed answers with an HTTP error, the same
 * hand-built multipart body is re-sent through the kernel forward proxy —
 * the same body works for both transports because it is a raw byte array.
 * Failures resolve to `null` so the caller can fall back to local assets.
 */

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tiff']);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'flv', 'wmv', 'mpeg', 'mpg']);

export type TResourceCategory = 'image' | 'video' | 'file';

function urlExtension(url: string): string {
    let pathname = url;
    try {
        const parsed = new URL(url);
        // WeChat media URLs carry the format as a query param (wx_fmt=png) and
        // often have no path extension at all. WeChat also emits the meaningless
        // label wx_fmt=other — treat it like a missing extension.
        const wxFmt = parsed.searchParams.get('wx_fmt');
        pathname = parsed.pathname;
        if (wxFmt && wxFmt.toLowerCase() !== 'other' && !/\.[a-zA-Z0-9]+$/.test(pathname)) {
            return wxFmt.toLowerCase();
        }
    } catch (error) {
        // Not a valid absolute URL — treat as no extension.
        return '';
    }
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1].toLowerCase() : '';
}

export function getResourceCategory(url: string): TResourceCategory | null {
    const extension = urlExtension(url);
    if (!extension) {
        return null;
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
        return 'image';
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
        return 'video';
    }
    return 'file';
}

export function shouldUploadToImageBed(url: string, plugin: ReadItLaterPlugin): boolean {
    const settings = plugin.settings;
    if (!settings.useImageBed || !settings.imageBedUrl) {
        return false;
    }
    const extension = urlExtension(url);
    const customExtensions = String(settings.imageBedCustomExtensions ?? '')
        .split(/[,;\s]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
        .filter((entry) => entry !== '');
    if (extension && customExtensions.includes(extension)) {
        return true;
    }
    // The calling pattern only matches `![]()` image embeds, so an unknown or
    // missing extension still counts as an image (some sites serve images
    // without any URL extension).
    const category = getResourceCategory(url);
    if (category === 'video') {
        return settings.imageBedUploadVideos === true;
    }
    if (category === 'file') {
        return settings.imageBedUploadFiles === true;
    }
    return settings.imageBedUploadImages === true;
}

export function imageBedFileName(url: string): string {
    try {
        const parsed = new URL(url);
        const base = parsed.pathname.split('/').pop() ?? '';
        const decoded = decodeURIComponent(base);
        if (decoded && /\.[a-zA-Z0-9]+$/.test(decoded)) {
            return decoded;
        }
    } catch (error) {
        // fall through to generated name
    }
    const extension = urlExtension(url);
    return `resource-${Date.now().toString(36)}${extension ? `.${extension}` : ''}`;
}

/**
 * Diagnostic detail of the most recent image bed failure (empty when the last
 * upload succeeded). Surfaced by the settings connectivity check.
 */
let lastImageBedError = '';

export function getImageBedLastError(): string {
    return lastImageBedError;
}

function recordImageBedError(message: string, detail?: unknown): void {
    lastImageBedError = message;
    console.warn(`ReadItLater: ${message}`, detail ?? '');
}

/**
 * Uploads one resource to the image bed. Resolves to the reference URL for the
 * note, or `null` when the upload failed (the caller then falls back to the
 * workspace assets directory).
 */
export async function uploadToImageBed(
    plugin: ReadItLaterPlugin,
    fileName: string,
    content: ArrayBuffer,
): Promise<string | null> {
    const settings = plugin.settings;
    const uploadBase = String(settings.imageBedUrl ?? '').replace(/\/+$/, '');
    if (!uploadBase) {
        recordImageBedError('Image bed upload URL is not configured');
        return null;
    }

    try {
        // Hand-build the multipart body as raw bytes so the identical payload
        // can be sent directly and, when the browser blocks that (remote-mode
        // CORS / mixed content), be re-sent base64-encoded via the kernel proxy.
        const boundary = `----siyuanReadItLater${Date.now()}${Math.floor(Math.random() * 100000)}`;
        const safeFilename = fileName.replace(/[^\x20-\x7e]/g, '_');
        const encoder = new TextEncoder();
        const head = encoder.encode(
            `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
                'Content-Type: application/octet-stream\r\n\r\n',
        );
        const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
        const fileBytes = new Uint8Array(content);
        const body = new Uint8Array(head.length + fileBytes.length + tail.length);
        body.set(head, 0);
        body.set(fileBytes, head.length);
        body.set(tail, head.length + fileBytes.length);

        const contentType = `multipart/form-data; boundary=${boundary}`;
        const headers: Record<string, string> = {};
        const token = String(settings.imageBedToken ?? '')
            .trim()
            .replace(/^bearer /i, '');
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        let response: Response;
        try {
            response = await fetch(`${uploadBase}/upload`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': contentType },
                body,
            });
            if (!response.ok) {
                console.warn(
                    `ReadItLater: image bed direct upload returned HTTP ${response.status}, trying kernel proxy`,
                );
                response = await kernelForward(`${uploadBase}/upload`, 'POST', body, contentType, headers);
            }
        } catch (error) {
            console.warn('ReadItLater: image bed direct upload blocked, falling back to kernel proxy', error);
            response = await kernelForward(`${uploadBase}/upload`, 'POST', body, contentType, headers);
        }

        if (!response.ok) {
            recordImageBedError(`Image bed upload failed: HTTP ${response.status} (direct and kernel proxy)`);
            return null;
        }

        const result = await response.json();
        const src = Array.isArray(result) ? result[0]?.src : result?.data?.[0]?.src;
        if (!src) {
            recordImageBedError(`Image bed response has no src: ${JSON.stringify(result).slice(0, 200)}`);
            return null;
        }

        // Some beds answer with absolute URLs — use them as-is. Otherwise links
        // written into notes use the external link URL when configured (upload
        // and public origins often differ), falling back to the upload URL.
        const linkBase = (String(settings.imageBedLinkUrl ?? '').trim() || uploadBase).replace(/\/+$/, '');
        lastImageBedError = '';
        return src.startsWith('http') ? src : `${linkBase}${src.startsWith('/') ? src : `/${src}`}`;
    } catch (error) {
        recordImageBedError('Image bed upload threw an exception', error);
        return null;
    }
}

/** 1x1 transparent PNG used as the connectivity probe. */
const PROBE_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export interface IImageBedCheckResult {
    ok: boolean;
    /** Localized message ready for display. */
    message: string;
    /** Present when connectivity worked but the probe cleanup failed. */
    leftoverProbeName?: string;
}

/**
 * Connectivity check for the settings dialog: uploads a 1x1 PNG probe through
 * the regular upload channel, then deletes it via the image bed management API.
 * Cleanup failure does not change the connectivity verdict.
 */
export async function checkImageBedConnectivity(
    plugin: ReadItLaterPlugin,
    t: (key: string) => string,
): Promise<IImageBedCheckResult> {
    const fail = (message: string): IImageBedCheckResult => ({ ok: false, message });

    if (plugin.settings.useImageBed !== true) {
        return fail(t('imgbedCheckNotEnabled'));
    }
    if (!String(plugin.settings.imageBedUrl ?? '').trim()) {
        return fail(t('imgbedCheckNoUrl'));
    }

    const probeName = `imgbed-probe-${Date.now()}.png`;
    const probe = Uint8Array.from(atob(PROBE_PNG_BASE64), (c) => c.charCodeAt(0));
    const link = await uploadToImageBed(plugin, probeName, probe.buffer);
    if (!link) {
        const detail = getImageBedLastError();
        return fail(`${t('imgbedCheckFail')}${detail ? ` (${detail})` : ''}`);
    }

    // The bed renames uploads to "<serverTimestamp>_<name>" — the delete target
    // must be the stored name (basename of the returned link), not the sent one.
    const storedName = decodeURIComponent(link.split('/').pop() || probeName);
    const cleaned = await deleteFromImageBed(plugin, storedName);
    if (!cleaned) {
        return {
            ok: true,
            message: `${t('imgbedCheckOk')} ${t('imgbedCheckCleanupFailed').replace('{name}', probeName)}`,
            leftoverProbeName: probeName,
        };
    }
    return { ok: true, message: t('imgbedCheckOk') };
}

/**
 * Deletes a file from the image bed via the management API, using the same
 * direct-then-kernel-proxy fallback as uploads.
 */
async function deleteFromImageBed(plugin: ReadItLaterPlugin, fileName: string): Promise<boolean> {
    const uploadBase = String(plugin.settings.imageBedUrl ?? '').replace(/\/+$/, '');
    if (!uploadBase) {
        return false;
    }

    const headers: Record<string, string> = {};
    const token = String(plugin.settings.imageBedToken ?? '')
        .trim()
        .replace(/^bearer /i, '');
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const url = `${uploadBase}/api/manage/delete/${fileName}?folder=false`;
    let response: Response;
    try {
        response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) {
            console.warn(`ReadItLater: image bed direct delete returned HTTP ${response.status}, trying kernel proxy`);
            response = await kernelForward(url, 'GET', undefined, undefined, headers);
        }
    } catch (error) {
        console.warn('ReadItLater: image bed direct delete blocked, falling back to kernel proxy', error);
        response = await kernelForward(url, 'GET', undefined, undefined, headers);
    }
    return response.ok;
}
