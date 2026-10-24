import { showMessage } from 'siyuan';

/**
 * Minimal stand-in for Obsidian's Notice, backed by SiYuan's showMessage.
 * Keeps the `new Notice(message, timeout?)` call sites in shared code untouched.
 * A timeout of 0 keeps the message visible until the user dismisses it.
 */
export class Notice {
    constructor(message: string, timeout: number = 7000) {
        showMessage(message, timeout);
    }
}
