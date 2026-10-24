import TurndownService from 'turndown';
import * as turndownPluginGfm from '@guyplusplus/turndown-plugin-gfm';

export async function parseHtmlContent(content: string) {
    const gfm = turndownPluginGfm.gfm;
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
    });

    turndownService.use(gfm);

    turndownService.addRule('torchlightCodeBlock', {
        filter: (node) => {
            return (
                node.nodeName === 'PRE' &&
                node.firstChild.nodeName === 'CODE' &&
                node.firstChild.firstChild.nodeName === 'P'
            );
        },
        replacement: function (_content, node, options) {
            node.querySelectorAll('p').forEach((codeLine) => {
                codeLine.innerHTML = codeLine.innerHTML + '\n';
            });
            return (
                //eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                '\n\n' +
                options.fence +
                //eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                node.firstChild.getAttribute('data-lang') +
                '\n' +
                node.firstChild.textContent +
                '\n' +
                options.fence +
                '\n\n'
            );
        },
    });

    turndownService.addRule('fencedCodeLangBlock', {
        filter: (node) => {
            return (
                node.nodeName == 'PRE' &&
                (!node.firstChild || node.firstChild.nodeName != 'CODE') &&
                !node.querySelector('img')
            );
        },
        replacement: function (_content, node, options) {
            //eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            node.innerHTML = node.innerHTML.replaceAll('<br-keep></br-keep>', '<br>');
            //eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            const langMatch = node.id?.match(/code-lang-(.+)/);
            const language = langMatch?.length > 0 ? langMatch[1] : '';
            const code = node.textContent;

            const fenceChar = options.fence.charAt(0);
            let fenceSize = 3;
            const fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');

            let match;
            while ((match = fenceInCodeRegex.exec(code))) {
                if (match[0].length >= fenceSize) {
                    fenceSize = match[0].length + 1;
                }
            }

            const fence = Array(fenceSize + 1).join(fenceChar);

            return '\n\n' + fence + language + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n';
        },
    });

    turndownService.addRule('fencedCodeLangFromId', {
        // Readability strips class attributes, so the language survives only in the
        // `code-lang-<lang>` id set by the parser DOM optimizations (markdownload trick).
        filter: (node) => {
            const firstChild = node.firstChild as HTMLElement | null;
            return (
                node.nodeName === 'PRE' &&
                firstChild != null &&
                firstChild.nodeName === 'CODE' &&
                /code-lang-(.+)/.test(firstChild.id ?? '')
            );
        },
        replacement: function (_content, node, options) {
            const codeElement = node.firstChild as HTMLElement;
            const language = codeElement.id.match(/code-lang-(.+)/)?.[1] ?? '';
            const code = codeElement.textContent ?? '';
            const fenceChar = options.fence.charAt(0);
            let fenceSize = 3;
            const fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');
            let match;
            while ((match = fenceInCodeRegex.exec(code))) {
                if (match[0].length >= fenceSize) {
                    fenceSize = match[0].length + 1;
                }
            }
            const fence = Array(fenceSize + 1).join(fenceChar);
            return '\n\n' + fence + language + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n';
        },
    });

    const articleContent = turndownService.turndown(content);

    // Turndown emits heading anchor links as `[](#anchor)` or — once Readability
    // resolved them against the <base> href — `[](https://page#anchor)` before the
    // heading text. Empty-text links are invisible noise; strip them (the lookbehind
    // keeps `![](image)` intact).
    return articleContent.replace(/(?<!!)\[\s*\]\([^)]*\)/g, '');
}
