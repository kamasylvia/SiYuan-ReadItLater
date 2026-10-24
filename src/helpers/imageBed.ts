import ReadItLaterPlugin from 'src/main';

/**
 * Uploads clipped resources to a self-hosted image bed (Sanyue-ImgHub /
 * CloudFlare-ImgBed compatible: POST /upload, multipart `file` field,
 * optional Bearer token, response `[{src: "/file/<name>"}]`).
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

export async function uploadToImageBed(
    plugin: ReadItLaterPlugin,
    fileName: string,
    content: ArrayBuffer,
): Promise<string> {
    const settings = plugin.settings;
    const baseUrl = String(settings.imageBedUrl ?? '').replace(/\/+$/, '');
    if (!baseUrl) {
        throw new Error('Image bed URL is not configured');
    }

    const file = new File([content], fileName, { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    const token = String(settings.imageBedToken ?? '').trim();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}/upload`, {
        method: 'POST',
        headers,
        body: formData,
    });
    if (!response.ok) {
        throw new Error(`Image bed upload failed: HTTP ${response.status}`);
    }

    const result = await response.json();
    const src = Array.isArray(result) ? result[0]?.src : result?.data?.[0]?.src;
    if (!src) {
        throw new Error('Image bed upload returned no file path');
    }

    return `${baseUrl}${src.startsWith('/') ? src : `/${src}`}`;
}
