import { Plugin } from 'siyuan';
import { showMessage } from 'siyuan';
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

        this.addTopBar({
            icon: 'iconReadItLater',
            title: 'ReadItLater: Create from clipboard',
            position: 'right',
            callback: () => {
                void this.createFromClipboard();
            },
        });

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

    async getTextClipboardContent(): Promise<string> {
        try {
            return await navigator.clipboard.readText();
        } catch (error) {
            new Notice(String(this.i18n.clipBoardError ?? 'Unable to access the clipboard.'));
            return '';
        }
    }

    /** Runs the image bed connectivity probe and shows the localized result. */
    async checkImageBedConnection(): Promise<void> {
        const t = (key: string): string => String(this.i18n[key] ?? key);
        const result = await checkImageBedConnectivity(this, t);
        showMessage(result.message, result.ok ? 5000 : 10000, result.ok ? 'info' : 'error');
    }

    private async createFromClipboard(): Promise<void> {
        const content = await this.getTextClipboardContent();
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
