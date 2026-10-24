/**
 * Recovers code blocks on Notion-style server-rendered pages (e.g. NotionNext).
 * Those pages ship the full block tree as JSON in `script#__NEXT_DATA__`, but block
 * code is rendered client-side only — the static DOM has text, headings, lists, yet
 * no code at all, so Readability+turndown would silently drop every code block.
 *
 * The DOM anchors the rendered blocks with `notion-block-<id>` classes while code
 * blocks have no element at all, so we walk the blockMap in document order and
 * insert a `<pre><code>` after the last anchored sibling for each code block.
 */

interface INotionRichTextSegment {
    0: string;
}

interface INotionBlockValue {
    id?: string;
    type?: string;
    properties?: {
        title?: INotionRichTextSegment[] | unknown;
        language?: INotionRichTextSegment[] | unknown;
    };
    content?: string[];
}

interface INotionBlockWrapper {
    value?: INotionBlockValue;
}

function richTextToText(richText: unknown): string {
    if (!Array.isArray(richText)) {
        return '';
    }
    return richText
        .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? '') : String(segment ?? '')))
        .join('');
}

export function recoverClientRenderedCodeBlocks(document: Document): void {
    const nextDataScript = document.querySelector('script#__NEXT_DATA__');
    if (!nextDataScript?.textContent) {
        return;
    }

    let blockMap: Record<string, INotionBlockWrapper>;
    try {
        const data = JSON.parse(nextDataScript.textContent);
        blockMap = data?.props?.pageProps?.post?.blockMap?.block;
    } catch (error) {
        console.warn('ReadItLater: failed to parse __NEXT_DATA__, skipping code block recovery', error);
        return;
    }
    if (!blockMap) {
        return;
    }

    // The post root block carries the ordered top-level children; code blocks can
    // also be nested, so walk depth-first while tracking the last anchored element.
    const postId = Object.keys(blockMap).find((id) => blockMap[id]?.value?.type === 'page');
    const rootContent = postId ? blockMap[postId]?.value?.content : undefined;
    if (!rootContent) {
        return;
    }

    let lastAnchor: Element | null = null;
    let inserted = 0;

    const insertCodeBlock = (value: INotionBlockValue): void => {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        const language = richTextToText(value.properties?.language).trim().toLowerCase();
        // Notion calls unstyled code blocks "plain text"; keep those unlabelled.
        if (language && language !== 'plain text' && /^[a-z0-9+#-]+$/.test(language)) {
            code.className = `language-${language}`;
        }
        code.textContent = richTextToText(value.properties?.title);
        pre.appendChild(code);

        if (lastAnchor?.parentElement) {
            lastAnchor.parentElement.insertBefore(pre, lastAnchor.nextSibling);
        } else {
            const pageRoot = document.querySelector('.notion-page') ?? document.body;
            pageRoot.prepend(pre);
        }
        inserted++;
        lastAnchor = pre;
    };

    const walk = (id: string): void => {
        const value = blockMap[id]?.value;
        if (!value) {
            return;
        }
        if (value.type === 'code') {
            insertCodeBlock(value);
            return;
        }
        const anchor =
            document.querySelector(`.notion-block-${id}`) ??
            // NotionNext renders block ids without dashes in the DOM classes.
            document.querySelector(`.notion-block-${id.replace(/-/g, '')}`);
        if (anchor) {
            lastAnchor = anchor;
        }
        for (const childId of value.content ?? []) {
            walk(childId);
        }
    };

    for (const id of rootContent) {
        walk(id);
    }

    if (inserted > 0) {
        console.info(`ReadItLater: recovered ${inserted} client-rendered code block(s) from __NEXT_DATA__`);
    }
}
