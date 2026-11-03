import { handleError } from 'src/helpers/error';
import { normalizeFilename } from 'src/helpers/fileutils';
import { replaceImages } from 'src/helpers/replaceImages';
import { CamoufoxClient } from 'src/services/camoufox';
import { Parser } from './Parser';
import { Note } from './Note';
import { parseHtmlContent } from './parsehtml';

interface ZhihuNoteData {
    date: string;
    questionTitle: string;
    answerURL: string;
    answerContent: string;
    authorName: string;
}

interface ZhihuPageValues {
    title?: unknown;
    authorName?: unknown;
    questionTitle?: unknown;
}

/**
 * Zhihu answers are behind the zse-ck anti-scraping wall: direct page fetches
 * return HTTP 403, the v4 API requires login, and anonymous reader proxies
 * are unreachable from the user's network. Rendering therefore goes through
 * the user's self-hosted camoufox MCP server (global setting), which drives
 * a real browser past the JS challenge.
 *
 * When the camoufox service is disabled, test() returns false and Zhihu URLs
 * fall through to WebsiteParser (previous behavior).
 */
class ZhihuParser extends Parser {
    test(clipboardContent: string): boolean {
        // URL-only match: when the camoufox service is missing, prepareNote
        // throws a loud localized error instead of silently falling through
        // to WebsiteParser (which yields a confusing Nonreadable article).
        return this.extractAnswerUrl(clipboardContent) !== null;
    }

    /**
     * Finds the first Zhihu answer/article URL inside the input. Deliberately
     * not anchored: clipboard/paste content may carry surrounding whitespace
     * or text, which `new URL()` tolerates but a `^`-anchored pattern rejects
     * (that mismatch silently fell through to WebsiteParser -> Nonreadable).
     */
    private extractAnswerUrl(content: string): { url: string; kind: 'answer' | 'article' } | null {
        const answerMatch =
            /https?:\/\/(?:[a-z0-9-]+\.)*zhihu\.com\/question\/\d+\/answer\/\d+[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/i.exec(
                content,
            );
        if (answerMatch) {
            return { url: ZhihuParser.cleanUrl(answerMatch[0]), kind: 'answer' };
        }
        const articleMatch =
            /https?:\/\/(?:[a-z0-9-]+\.)*zhihu\.com\/p\/\d+[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/i.exec(content);
        if (articleMatch) {
            return { url: ZhihuParser.cleanUrl(articleMatch[0]), kind: 'article' };
        }
        return null;
    }

    /** Drops prose punctuation glued to the URL ("...answer/123," / "...123。"). */
    private static cleanUrl(url: string): string {
        return url.replace(/[\s)"',.;!?。！？，、）】」』〉]+$/, '');
    }

    async prepareNote(clipboardContent: string): Promise<Note> {
        const createdAt = new Date();
        const client = CamoufoxClient.fromSettings(this.plugin.settings);
        if (client === null) {
            handleError(
                new Error(String(this.plugin.i18n['zhihuCamoufoxDisabled'] ?? 'Camoufox service is disabled.')),
                'Unable to parse Zhihu answer.',
            );
        }
        const found = this.extractAnswerUrl(clipboardContent);
        if (!found) {
            handleError(new Error('No Zhihu answer URL found in input.'), 'Unable to parse Zhihu answer.');
        }
        let data: ZhihuNoteData;
        try {
            data = await this.getNoteData(client, found.url, found.kind, createdAt);
        } catch (error) {
            handleError(error instanceof Error ? error : new Error(String(error)), 'Unable to parse Zhihu answer.');
        }

        const fileNameTemplate = this.templateEngine.render(this.plugin.settings.zhihuNoteTitle, {
            title: data.questionTitle,
            author: data.authorName,
            date: this.getFormattedDateForFilename(createdAt),
        });

        let content = this.templateEngine.render(this.plugin.settings.zhihuNote, data);

        if (this.plugin.settings.downloadZhihuImages) {
            content = await replaceImages(
                this.plugin,
                normalizeFilename(fileNameTemplate),
                content,
                this.getAssetsDir(fileNameTemplate, createdAt),
            );
        }

        return new Note(fileNameTemplate, 'md', content, this.plugin.settings.zhihuContentTypeSlug, createdAt);
    }

    private async getNoteData(
        client: CamoufoxClient,
        url: string,
        kind: 'answer' | 'article',
        createdAt: Date,
    ): Promise<ZhihuNoteData> {
        const isArticle = kind === 'article';
        const page = await client.renderPage<ZhihuPageValues>(url, {
            waitSelector: isArticle ? '.Post-RichText' : '.RichContent',
            htmlSelector: isArticle ? '.Post-RichText' : '.RichContent',
            expressions: {
                title: 'document.title',
                authorName: isArticle
                    ? "document.querySelector('.Post-Author .AuthorInfo-name')?.innerText?.trim() ?? ''"
                    : "document.querySelector('.AnswerItem-authorInfo .AuthorInfo-name a')?.innerText?.trim() ?? ''",
                questionTitle: isArticle
                    ? "document.querySelector('.Post-Title')?.innerText?.trim() ?? document.title.replace(/\\s*-\\s*知乎\\s*$/, '')"
                    : "document.querySelector('.QuestionHeader-title')?.innerText?.trim() ?? document.title.replace(/\\s*-\\s*知乎\\s*$/, '')",
            },
        });

        const answerContent = (await parseHtmlContent(this.stripChrome(page.html))).trim();
        if (answerContent.length === 0) {
            throw new Error('Zhihu answer is empty; the page may require login.');
        }

        const title = typeof page.values.title === 'string' ? page.values.title : '';
        const questionTitle =
            (typeof page.values.questionTitle === 'string' && page.values.questionTitle.trim()) ||
            this.splitTitle(title).questionTitle ||
            title;

        return {
            date: this.getFormattedDateForContent(createdAt),
            questionTitle,
            answerURL: url,
            answerContent,
            authorName: typeof page.values.authorName === 'string' ? page.values.authorName : '',
        };
    }

    /**
     * Drops the in-content chrome (vote/comment/share action bar) so it does
     * not leak into the clipped Markdown as trailing noise.
     */
    private stripChrome(html: string): string {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('.ContentItem-actions, .ContentItem-more, .ContentItem-expandButton').forEach((el) =>
            el.remove(),
        );
        return doc.body.innerHTML;
    }

    /**
     * Fallback for pages without a .QuestionHeader-title element: Jina-style
     * titles look like "<question> - <author> 的回答".
     */
    private splitTitle(title: string): { questionTitle: string; authorName: string } {
        const match = /^(.*)\s+-\s+(.+?)\s*的回答\s*$/.exec(title);
        if (!match) {
            return { questionTitle: title.replace(/\s*-\s*知乎\s*$/, ''), authorName: '' };
        }
        return { questionTitle: match[1].trim(), authorName: match[2].trim() };
    }

    private getAssetsDir(fileName: string, createdAt: Date): string {
        if (this.plugin.settings.downloadZhihuImagesInDir) {
            const assetsDir = this.templateEngine.render(this.plugin.settings.assetsDir, {
                date: '',
                fileName: '',
                contentType: '',
            });
            return `${assetsDir}/${normalizeFilename(fileName)}`;
        }

        return this.templateEngine.render(this.plugin.settings.assetsDir, {
            date: this.getFormattedDateForFilename(createdAt),
            fileName: normalizeFilename(fileName),
            contentType: this.plugin.settings.zhihuContentTypeSlug,
        });
    }
}

export default ZhihuParser;
