export function createHTMLDiv(html: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = html;
    fragment.appendChild(div);
    return fragment;
}

/**
 * Creates a `<span>` hosting arbitrary HTML, used to inline rich descriptions
 * into setting rows and dialogs.
 */
export function createHTMLElement<T extends keyof HTMLElementTagNameMap>(
    tagName: T,
    options?: { text?: string; html?: string; cls?: string },
): HTMLElementTagNameMap[T] {
    const element = document.createElement(tagName);
    if (options?.cls) {
        element.className = options.cls;
    }
    if (options?.html) {
        element.innerHTML = options.html;
    } else if (options?.text) {
        element.textContent = options.text;
    }
    return element;
}
