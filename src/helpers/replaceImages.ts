import { requestUrl } from 'src/api/http';
import { HTTPS_PROTOCOL, HTTP_PROTOCOL } from 'src/constants/urlProtocols';
import { imageBedFileName, shouldUploadToImageBed, uploadToImageBed } from 'src/helpers/imageBed';
import ReadItLaterPlugin from 'src/main';
import { getFileExtensionFromMimeType, isValidUrl } from './fileutils';

type Replacer = {
    (match: string, anchor: string, link: string): Promise<string>;
};

const EXTERNAL_MEDIA_LINK_PATTERN = /!\[(?<anchor>.*?)\]\((?<link>.+?)\)/g;

export async function replaceImages(
    plugin: ReadItLaterPlugin,
    noteFileName: string,
    content: string,
    assetsDir: string,
): Promise<string> {
    return await replaceAsync(content, EXTERNAL_MEDIA_LINK_PATTERN, imageTagProcessor(plugin, noteFileName, assetsDir));
}

async function replaceAsync(content: string, searchValue: string | RegExp, replacer: Replacer) {
    try {
        if (typeof replacer === 'function') {
            // 1. Run fake pass of `replace`, collect values from `replacer` calls
            // 2. Resolve them with `Promise.all`
            // 3. Run `replace` with resolved values
            const values: Promise<string>[] = [];
            String.prototype.replace.call(content, searchValue, function (match: string, anchor: string, link: string) {
                values.push(replacer(match, anchor, link));
                return '';
            });
            return Promise.all(values).then(function (resolvedValues) {
                return String.prototype.replace.call(content, searchValue, function () {
                    return resolvedValues.shift();
                });
            });
        } else {
            return Promise.resolve(String.prototype.replace.call(content, searchValue, replacer));
        }
    } catch (error) {
        console.error();
        return Promise.reject(error);
    }
}

function imageTagProcessor(plugin: ReadItLaterPlugin, noteFileName: string, assetsDir: string): Replacer {
    return async function processImageTag(match: string, anchor: string, link: string): Promise<string> {
        if (!isValidUrl(link, [HTTP_PROTOCOL, HTTPS_PROTOCOL])) {
            return match;
        }
        const url = new URL(link);

        try {
            // Image bed enabled and the resource matches the selected categories:
            // reuse the persisted link when this source URL was uploaded before
            // (re-clipping must not duplicate files on the image bed); upload it
            // otherwise; on failure fall through to the workspace assets.
            if (shouldUploadToImageBed(link, plugin)) {
                const cachedLink = plugin.imageBedLinks[link];
                if (cachedLink) {
                    return `![${anchor}](${cachedLink})`;
                }

                const { fileContent, status } = await downloadImage(url);
                if (status < 400) {
                    const remoteUrl = await uploadToImageBed(plugin, imageBedFileName(link), fileContent);
                    if (remoteUrl) {
                        plugin.imageBedLinks[link] = remoteUrl;
                        void plugin.persistImageBedLinks();
                        return `![${anchor}](${remoteUrl})`;
                    }
                }
            }

            const { fileContent, fileExtension } = await downloadImage(url);

            if (fileExtension === '') {
                return match;
            }

            const fileName = `${noteFileName}-${Date.now().toString(36)}${Math.random()
                .toString(36)
                .substring(2, 8)}.${fileExtension}`;
            const assetPath = await uploadAsset(fileName, fileContent, assetsDir);
            return `![${anchor}](${assetPath})`;
        } catch (error) {
            console.warn(error);
            return match;
        }
    };
}

/**
 * Uploads a downloaded image into the workspace assets directory via the kernel and
 * returns the markdown-ready asset path (e.g. `assets/20240101-foo.png`).
 * The kernel creates missing directories and deduplicates file names by itself.
 */
async function uploadAsset(fileName: string, fileContent: ArrayBuffer, assetsDir: string): Promise<string> {
    const file = new File([fileContent], fileName, { type: 'application/octet-stream' });
    const formData = new FormData();
    // Kernel contract field is `assetsDirPath`; older kernels used `assetsDir`, send both.
    const dirPath = assetsDir.startsWith('/') ? assetsDir : `/${assetsDir}`;
    formData.append('assetsDirPath', dirPath.endsWith('/') ? dirPath : `${dirPath}/`);
    formData.append('assetsDir', assetsDir.replace(/^\/|\/$/g, ''));
    formData.append('file[]', file);

    const response = await fetch('/api/asset/upload', {
        method: 'POST',
        body: formData,
    });
    const result = await response.json();

    if (result.code !== 0) {
        throw new Error(result.msg || `Asset upload failed for ${fileName}`);
    }

    const uploadedPath = result.data?.succMap?.[fileName];
    if (!uploadedPath) {
        throw new Error(`Asset upload failed for ${fileName}`);
    }

    return uploadedPath;
}

async function downloadImage(url: URL): Promise<{ fileContent: ArrayBuffer; fileExtension: string; status: number }> {
    const res = await requestUrl({
        url: url.href,
        method: 'get',
    });

    return {
        fileContent: res.arrayBuffer,
        fileExtension: getFileExtensionFromMimeType(res.headers['content-type'] || '') ?? '',
        status: res.status,
    };
}
