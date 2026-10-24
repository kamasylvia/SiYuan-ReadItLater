import { ReadItLaterSettings } from 'src/settings';
import mime from 'mime';

export interface FilesystemLimits {
    path: number;
    fileName: number;
}

export function isValidUrl(url: string, allowedProtocols: string[] = []): boolean {
    let urlObject;
    try {
        urlObject = new URL(url);
    } catch (e) {
        return false;
    }

    if (allowedProtocols.length === 0) {
        return true;
    }

    return allowedProtocols.includes(urlObject.protocol);
}

export function getBaseUrl(url: string, origin: string): string {
    const baseURL = new URL(url, origin);
    return baseURL.href;
}

export function normalizeFilename(fileName: string, preserveUnicode: boolean = true): string {
    if (preserveUnicode) {
        return fileName.replace(/[:#/\\|?*<>"]/g, '');
    }

    return fileName.replace(
        /[:#/\\()|?*<>"[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu,
        '',
    );
}

/**
 * Joins a directory path and file name, truncating the file name and the full path
 * to the configured limits. SiYuan document titles live in the database, but they
 * are surfaced as file paths in the doc tree, sync layer and export, so the same
 * sanity limits as the Obsidian version are kept.
 */
export function applyFilesystemLimits(path: string, fileName: string, filesystemLimits: FilesystemLimits): string {
    const fileExtension = `.${getFileExtension(fileName)}`;

    let optimizedFileName = fileName;
    if (optimizedFileName.length > filesystemLimits.fileName) {
        optimizedFileName =
            optimizedFileName.substring(0, filesystemLimits.fileName - fileExtension.length) + `${fileExtension}`;
    }

    let optimizedFilePath = path ? `${path}/${optimizedFileName}` : optimizedFileName;
    if (optimizedFilePath.length > filesystemLimits.path) {
        optimizedFilePath = optimizedFilePath.substring(0, optimizedFilePath.length - fileExtension.length);
        const pathOverflow = optimizedFilePath.length + fileExtension.length - filesystemLimits.path;
        if (pathOverflow > 0) {
            optimizedFilePath = optimizedFilePath.substring(0, optimizedFilePath.length - pathOverflow);
        }
        optimizedFilePath = optimizedFilePath + fileExtension;
    }

    return optimizedFilePath;
}

export function getFileSystemLimits(settings: ReadItLaterSettings): FilesystemLimits {
    const defaultFilesystenLimits = getDefaultFilesystenLimits();

    return {
        path: settings.filesystemLimitPath ?? defaultFilesystenLimits.path,
        fileName: settings.filesystemLimitFileName ?? defaultFilesystenLimits.fileName,
    };
}

export function getDefaultFilesystenLimits(): FilesystemLimits {
    return createFilesystemLimits(1024, 255);
}

export function getFileExtension(fileName: string): string {
    if (!fileName.includes('.')) {
        return '';
    }

    return fileName.split('.').pop();
}

export function getFileExtensionFromMimeType(mimeType: string): string {
    return mime.getExtension(mimeType) ?? '';
}

function createFilesystemLimits(path: number, fileName: number): FilesystemLimits {
    return { path: path, fileName: fileName };
}
