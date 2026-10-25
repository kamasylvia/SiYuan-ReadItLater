import { Dialog, Plugin, Custom as SiYuanCustom } from 'siyuan';
import { showMessage } from 'siyuan';

declare global {
    interface Window {
        require?: (moduleId: string) => unknown;
    }
}
import { DEFAULT_SETTINGS, ReadItLaterSettingValue, ReadItLaterSettings } from './settings';
import { ReadItLaterSettingsTab } from './views/settings-tab';
import YoutubeParser from './parsers/YoutubeParser';
import VimeoParser from './parsers/VimeoParser';
import BilibiliParser from './parsers/BilibiliParser';
import TwitterParser from './parsers/TwitterParser';
import StackExchangeParser from './parsers/StackExchangeParser';
import WebsiteParser from './parsers/WebsiteParser';
import TextSnippetParser from './parsers/TextSnippetParser';
import MastodonParser from './parsers/MastodonParser';
import TikTokParser from './parsers/TikTokParser';
import ParserCreator from './parsers/ParserCreator';
import { HTTPS_PROTOCOL, HTTP_PROTOCOL } from './constants/urlProtocols';
import GithubParser from './parsers/GithubParser';
import WikipediaParser from './parsers/WikipediaParser';
import TemplateEngine from './template/TemplateEngine';
import { FilesystemLimits, getFileSystemLimits, isValidUrl } from './helpers/fileutils';
import YoutubeChannelParser from './parsers/YoutubeChannelParser';
import { VaultRepository } from './repository/VaultRepository';
import DefaultVaultRepository from './repository/DefaultVaultRepository';
import { NoteService } from './NoteService';
import { ReadItLaterApi } from './ReadtItLaterApi';
import { BlueskyParser } from './parsers/BlueskyParser';
import { PinterestParser } from './parsers/PinterestParser';
import { checkImageBedConnectivity } from './helpers/imageBed';
import { Notice } from './ui/notice';

export default class ReadItLaterPlugin extends Plugin {
    public api: ReadItLaterApi;
    public settings: ReadItLaterSettings;
    /** Image bed link dedup map: source resource URL -> uploaded link. */
    public imageBedLinks: Record<string, string> = {};

    private fileSystemLimits: FilesystemLimits;
    private noteService: NoteService;
    private parserCreator: ParserCreator;
    private templateEngine: TemplateEngine;
    private vaultRepository: VaultRepository;

    getFileSystemLimits(): FilesystemLimits {
        return this.fileSystemLimits;
    }

    getVaultRepository(): VaultRepository {
        return this.vaultRepository;
    }

    async onload(): Promise<void> {
        await this.loadSettings();

        this.fileSystemLimits = getFileSystemLimits(this.settings);
        this.templateEngine = new TemplateEngine();
        this.parserCreator = new ParserCreator([
            new YoutubeParser(this.app, this, this.templateEngine),
            new YoutubeChannelParser(this.app, this, this.templateEngine),
            new VimeoParser(this.app, this, this.templateEngine),
            new BilibiliParser(this.app, this, this.templateEngine),
            new TwitterParser(this.app, this, this.templateEngine),
            new StackExchangeParser(this.app, this, this.templateEngine),
            new TikTokParser(this.app, this, this.templateEngine),
            new GithubParser(this.app, this, this.templateEngine),
            new WikipediaParser(this.app, this, this.templateEngine),
            new BlueskyParser(this.app, this, this.templateEngine),
            new PinterestParser(this.app, this, this.templateEngine),
            new MastodonParser(this.app, this, this.templateEngine),
            new WebsiteParser(this.app, this, this.templateEngine),
            new TextSnippetParser(this.app, this, this.templateEngine),
        ]);
        this.vaultRepository = new DefaultVaultRepository(this, this.templateEngine);
        this.noteService = new NoteService(this.parserCreator, this, this.vaultRepository);
        this.api = new ReadItLaterApi(this.noteService);

        this.addIcons(readItLaterIcon);

        // Entry lives in the left dock; the top bar entry was removed in favor of it.
        const plugin = this;
        this.addDock({
            id: 'readItLaterDock',
            config: {
                position: 'LeftBottom',
                size: { width: 240, height: 0 },
                icon: 'iconReadItLater',
                title: String(this.i18n.pluginName ?? 'ReadItLater'),
                hotkey: '',
            },
            data: {},
            type: 'readItLaterPanel',
            init(this: SiYuanCustom) {
                const t = (key: string): string => String(plugin.i18n[key] ?? key);
                const el = this.element as HTMLElement;
                el.innerHTML = `
<div class="b3-label">
    <div class="fn__flex-1">
        <div>${t('dockTitle')}</div>
        <div class="b3-label__text">${t('dockDesc')}</div>
    </div>
</div>
<div style="padding: 0 16px 8px; display: flex; flex-direction: column; gap: 8px;">
    <button id="readItLaterDockCreate" class="b3-button b3-button--outline fn__block">${t('createNote')}</button>
    <button id="readItLaterDockBatch" class="b3-button b3-button--outline fn__block">${t('createNoteBatch')}</button>
</div>`;

                el.querySelector('#readItLaterDockCreate')?.addEventListener('click', () => {
                    void plugin.createFromClipboard();
                });
                el.querySelector('#readItLaterDockBatch')?.addEventListener('click', () => {
                    void plugin
                        .getTextClipboardContent()
                        .then((content) => plugin.api.processContentBatch(content))
                        .catch((error) => console.warn('ReadItLater: batch clip failed', error));
                });
            },
            destroy() {},
        });

        // Clicking the dock icon clips immediately instead of toggling the panel
        // (the host uses dock clicks to expand/minimize). Intercepted in the
        // capture phase on document via delegation, so it works no matter when
        // the dock item enters the DOM. Right-click stays the position menu;
        // the panel content remains as a fallback visible through the host UI.
        const dockItemType = `${this.name}readItLaterPanel`;
        document.addEventListener(
            'click',
            (event) => {
                const target = event.target as HTMLElement | null;
                if (!target || event.button !== 0) {
                    return;
                }
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                    return;
                }
                const dockItem = target.closest(`[data-type="${dockItemType}"]`);
                if (!dockItem) {
                    return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                void plugin.createFromClipboard();
            },
            true,
        );

        this.addCommand({
            langKey: 'createNote',
            hotkey: '',
            callback: async () => {
                await this.createFromClipboard();
            },
        });

        this.addCommand({
            langKey: 'createNoteBatch',
            hotkey: '',
            callback: async () => {
                await this.api.processContentBatch(await this.getTextClipboardContent());
            },
        });

        this.addCommand({
            langKey: 'insertAtCursor',
            hotkey: '',
            editorCallback: async (protyle) => {
                await this.api.insertContentAtEditorCursorPosition(await this.getTextClipboardContent(), protyle);
            },
        });

        // openSetting() is provided by ReadItLaterSettingsTab below
    }

    async openSetting(): Promise<void> {
        const settingsTab = new ReadItLaterSettingsTab(this);
        settingsTab.open();
    }

    async loadSettings(): Promise<void> {
        // loadData resolves to "" when the storage file does not exist yet, to a JSON
        // string or an already parsed object afterwards; never let a parse failure
        // kill onload or the whole plugin stays dead (settings page won't open).
        let storedSettings: Partial<ReadItLaterSettings> | undefined;
        try {
            const storedData = await this.loadData('settings.json');
            if (typeof storedData === 'string') {
                storedSettings = storedData.trim() !== '' ? JSON.parse(storedData) : undefined;
            } else {
                storedSettings = storedData;
            }
        } catch (error) {
            console.warn('ReadItLater: stored settings are unreadable, falling back to defaults', error);
        }
        this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings ?? {});

        // Persisted image bed links (source URL -> uploaded link) so re-clipping the
        // same article reuses the stored links instead of uploading duplicates.
        this.imageBedLinks = {};
        try {
            const storedLinks = await this.loadData('imgbed-links.json');
            if (storedLinks && typeof storedLinks === 'object' && !Array.isArray(storedLinks)) {
                this.imageBedLinks = storedLinks as Record<string, string>;
            } else if (typeof storedLinks === 'string' && storedLinks.trim() !== '') {
                this.imageBedLinks = JSON.parse(storedLinks);
            }
        } catch (error) {
            console.warn('ReadItLater: stored image bed links are unreadable, starting fresh', error);
        }
    }

    /** Persists the image bed link dedup map (source URL -> uploaded link). */
    async persistImageBedLinks(): Promise<void> {
        try {
            await this.saveData('imgbed-links.json', this.imageBedLinks);
        } catch (error) {
            console.warn('ReadItLater: failed to persist image bed links', error);
        }
    }

    async saveSetting(setting: string, value: ReadItLaterSettingValue): Promise<void> {
        this.settings[setting] = value;
        await this.saveSettings();
    }

    async saveSettings(): Promise<void> {
        await this.saveData('settings.json', this.settings);
    }

    /**
     * Reads the clipboard text with a fallback chain:
     * 1. `navigator.clipboard.readText()` — works when the document is focused
     *    and the permission is granted (browser frontends, focused desktop).
     * 2. Electron native clipboard via `window.require('electron')` — the desktop
     *    renderer has node integration, and the native clipboard has no
     *    permission gate or focus requirement. Covers the common "user copied
     *    in another app, then clicked the dock icon" case where Chromium
     *    rejects the async clipboard API.
     * Shows the localized error notice only when both paths fail.
     */
    async getTextClipboardContent(): Promise<string> {
        const result = await this.readClipboardText();
        if (result.errorName) {
            new Notice(
                `${String(this.i18n.clipBoardError ?? 'Unable to access the clipboard.')} [${result.errorName}]`,
            );
            this.openPasteFallbackDialog(result.errorName);
            return '';
        }
        return result.text;
    }

    /**
     * Clipboard read with a fallback chain:
     * 1. `navigator.clipboard.readText()` — requires document focus + a granted
     *    clipboard-read permission; this is the flaky path when the user switches
     *    from another app and clicks the dock icon right away.
     * 2. one retry after the focus settles (300ms).
     * 3. Electron native clipboard via `window.require('electron')` — the desktop
     *    renderer runs with node integration per app/electron/window.js, no
     *    permission gate; skipped on browser/mobile frontends.
     * When everything fails, returns the error name and opens the manual paste
     * dialog — the paste event carries the clipboard natively and always works.
     */
    private async readClipboardText(): Promise<{ text: string; errorName?: string }> {
        let errorName = 'Unknown';
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                return { text: await navigator.clipboard.readText() };
            } catch (error) {
                errorName = (error as Error)?.name ?? 'Unknown';
                console.warn(`ReadItLater: navigator.clipboard read failed (attempt ${attempt + 1})`, error);
            }
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        try {
            const electron = window.require?.('electron') as { clipboard?: { readText?: () => string } } | undefined;
            const text = electron?.clipboard?.readText?.();
            if (typeof text === 'string') {
                return { text };
            }
            errorName = 'ElectronClipboardUnavailable';
        } catch (error) {
            console.warn('ReadItLater: Electron clipboard unavailable', error);
        }
        return { text: '', errorName };
    }

    /**
     * Manual paste fallback: when the clipboard cannot be read programmatically,
     * open a dialog where the user pastes (Ctrl/Cmd+V) and confirms. The paste
     * event carries the clipboard natively, so this always works.
     */
    private openPasteFallbackDialog(errorName: string): void {
        const t = (key: string): string => String(this.i18n[key] ?? key);
        const dialog = new Dialog({
            title: t('pasteFallbackTitle'),
            content: `
<div class="b3-dialog__content">
    <div class="b3-label">
        <div class="fn__flex-1">
            <div>${t('pasteFallbackDesc')}</div>
            <div class="b3-label__text">${t('pasteFallbackError').replace('{error}', errorName)}</div>
        </div>
    </div>
    <div style="padding: 0 16px 8px;">
        <textarea id="readItLaterPasteArea" class="b3-text-field fn__block" rows="6" placeholder="${t(
            'pasteFallbackPlaceholder',
        )}"></textarea>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${t('pasteFallbackCancel')}</button>
    <div class="fn__space"></div>
    <button id="readItLaterPasteClip" class="b3-button b3-button--text">${t('pasteFallbackClip')}</button>
</div>`,
            width: '520px',
            height: '340px',
        });

        const area = dialog.element.querySelector('#readItLaterPasteArea') as HTMLTextAreaElement;
        const clipButton = dialog.element.querySelector('#readItLaterPasteClip') as HTMLButtonElement;
        const cancelButton = dialog.element.querySelector('.b3-button--cancel') as HTMLButtonElement;

        let pasted = '';
        area.addEventListener('paste', (event) => {
            const clipboardData = (event as ClipboardEvent).clipboardData;
            if (clipboardData) {
                pasted = clipboardData.getData('text/plain');
                event.preventDefault();
                area.value = pasted;
            }
        });

        const clip = (): void => {
            const content = (area.value || pasted).trim();
            if (content === '') {
                return;
            }
            dialog.destroy();
            void this.api.processContentBatch(content);
        };

        clipButton.addEventListener('click', clip);
        area.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                clip();
            }
        });
        cancelButton.addEventListener('click', () => dialog.destroy());
        area.focus();
    }

    /** Runs the image bed connectivity probe and shows the localized result. */
    async checkImageBedConnection(): Promise<void> {
        const t = (key: string): string => String(this.i18n[key] ?? key);
        const result = await checkImageBedConnectivity(this, t);
        showMessage(result.message, result.ok ? 5000 : 10000, result.ok ? 'info' : 'error');
    }

    private async createFromClipboard(): Promise<void> {
        const result = await this.readClipboardText();
        if (result.errorName) {
            // Clipboard cannot be read programmatically — hand the user a paste
            // dialog (the paste event always carries the clipboard natively).
            this.openPasteFallbackDialog(result.errorName);
            return;
        }
        const content = result.text;
        if (content.trim() === '') {
            return;
        }
        await this.api.processContent(content);
    }
}

const readItLaterIcon = `
<symbol id="iconReadItLater" viewBox="0 0 512 512">
<g fill="currentColor" stroke="currentColor">
<path d="m365.9,144.9c-12.3,0-24.2,1.8-35.4,5.2v-114.7h-96.9l7.3-35.4h-150.2l6.8,35.4h-97.5v454.6h330.5v-102.1c11.2,3.4 23.1,5.2 35.4,5.2 68.8-0.1 124.1-56.4 124.1-124.1 0-67.8-55.3-124.1-124.1-124.1zm-150.1-124l-10.4,50h-79.2l-9.4-50h99zm93.8,448.2h-288.7v-412.8h80.7l6.8,35.4h113.6l7.3-35.4h80.3v102.2c-27.3,14-48.8,37.9-59.7,66.7h-200.9v20.8h195c-1.4,7.4-2.2,15.1-2.2,22.9 0,13.4 2.2,26.4 6.2,38.6h-199v20.9h208.1c12,21.8 30.3,39.7 52.5,51.1v89.6zm56.3-98c-57.3,0-103.2-46.9-103.2-103.2s46.9-103.2 103.2-103.2c57.3,0 103.2,46.9 103.2,103.2s-45.8,103.2-103.2,103.2z"/>
<polygon points="426.4,223.1 346.1,303.4 313.8,271.1 299.2,285.7 346.1,332.6 441,237.7"/>
<rect width="233.5" x="49" y="143.9" height="20.9"/>
<rect width="233.5" x="49" y="388.9" height="20.9"/>
</g>
</symbol>`;
