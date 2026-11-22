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
 * the user's self-hosted camofox-browser REST service (global setting), which drives
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
        // Guard against degenerate rendered names ('.' / whitespace): fall back
        // to the question title, then to a dated constant. The same safe name
        // feeds the assets dir so downloads never land in '.' either.
        const safeName =
            fileNameTemplate.trim().replace(/^[.\s]+$/, '').trim() ||
            data.questionTitle.trim() ||
            'Zhihu clip ' + this.getFormattedDateForFilename(createdAt);

        let content = this.templateEngine.render(this.plugin.settings.zhihuNote, data);

        if (this.plugin.settings.downloadZhihuImages) {
            content = await replaceImages(
                this.plugin,
                normalizeFilename(safeName),
                content,
                this.getAssetsDir(safeName, createdAt),
            );
        }

        return new Note(safeName, 'md', content, this.plugin.settings.zhihuContentTypeSlug, createdAt);
    }

    private async getNoteData(
        client: CamoufoxClient,
        url: string,
        kind: 'answer' | 'article',
        createdAt: Date,
    ): Promise<ZhihuNoteData> {
        const isArticle = kind === 'article';
        // Cookie bridge first: a logged-in session makes gated UGC articles
        // deterministic through the browser render (the browser jar persists
        // it with the session profile).
        const cookie = String(this.plugin.settings.zhihuCookie ?? '').trim();
        if (cookie) {
            await client.importCookieHeader(cookie);
        }
        // Percent/stage roll inside the pinned 'Clipping...' toast, wording
        // localized via the same i18n table as every other message.
        const onStage = (percent: number, stageKey: string): void => {
            const pattern = String(this.plugin.i18n['clippingProgressPattern'] ?? 'Clipping - {percent}%: {stage}');
            const stage = String(this.plugin.i18n[stageKey] ?? stageKey);
            this.plugin.showClippingProgress(pattern.replace('{percent}', String(percent)).replace('{stage}', stage));
        };
        // waitSelector targets the TITLE element: Zhihu's SPA writes
        // document.title only after the route settles, and waiting on the body
        // selector alone raced it - clips came out titled '.'. The title
        // element is server-rendered, so its presence means text is readable.
        const page = await client.renderPage<ZhihuPageValues>(url, {
            waitSelector: isArticle ? '.Post-Title' : '.QuestionHeader-title',
            htmlSelector: isArticle ? '.Post-RichText' : '.RichContent',
            expressions: {
                title: isArticle
                    ? "document.querySelector('.Post-Title')?.innerText?.trim() || document.title.replace(/\\s*-\\s*知乎\\s*$/, '')"
                    : "document.querySelector('.QuestionHeader-title')?.innerText?.trim() || document.title.replace(/\\s*-\\s*知乎\\s*$/, '')",
                authorName: isArticle
                    ? "document.querySelector('.Post-Author .AuthorInfo-name')?.innerText?.trim() ?? ''"
                    : "document.querySelector('.AnswerItem-authorInfo .AuthorInfo-name a')?.innerText?.trim() ?? ''",
                questionTitle: isArticle
                    ? "document.querySelector('.Post-Title')?.innerText?.trim() || document.title.replace(/\\s*-\\s*知乎\\s*$/, '')"
                    : "document.querySelector('.QuestionHeader-title')?.innerText?.trim() || document.title.replace(/\\s*-\\s*知乎\\s*$/, '')",
            },
        }, onStage);

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
