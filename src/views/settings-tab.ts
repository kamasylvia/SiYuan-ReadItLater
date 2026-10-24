import { Setting as SettingDialog } from 'siyuan';
import { Delimiter, getDelimiterOptions } from 'src/enums/delimiter';
import { FileExistsStrategy, getFileExistStrategyOptions } from 'src/enums/fileExistsStrategy';
import { getDefaultFilesystenLimits } from 'src/helpers/fileutils';
import { listNotebooks } from 'src/api/kernel';
import ReadItLaterPlugin from 'src/main';
import { DEFAULT_SETTINGS } from 'src/settings';

type I18n = Record<string, string>;

enum DetailsItem {
    ReadableArticle = 'readableArticle',
    Youtube = 'youtube',
    YoutubeChannel = 'youtubeChannel',
    X = 'x',
    Bluesky = 'bluesky',
    StackExchange = 'stackExchange',
    Pinterest = 'pinterest',
    Mastodon = 'mastodon',
    Vimeo = 'vimeo',
    Bilibili = 'bilibili',
    TikTok = 'tikTok',
    NonReadableArticle = 'nonReadableArticle',
    TextSnippet = 'textSnippet',
}

export class ReadItLaterSettingsTab {
    private plugin: ReadItLaterPlugin;

    private i18n: I18n;
    private activeDetails: string[] = [];

    constructor(plugin: ReadItLaterPlugin) {
        this.plugin = plugin;
        this.i18n = (plugin.i18n ?? {}) as I18n;
    }

    open(): void {
        const dialog = new SettingDialog({
            width: '860px',
            height: '80vh',
            confirmCallback: () => {
                // Settings persist on change; nothing to flush on close.
            },
        });

        // direction "row" stacks the section title above a full-width action container;
        // "column" would force the container into fn__size200 (200px) and crush the layout.
        dialog.addItem({
            title: this.t('settingsGeneral'),
            direction: 'row',
            actionElement: this.createGeneralSection(),
        });

        dialog.addItem({
            title: this.t('settingsContentTypes'),
            direction: 'row',
            actionElement: this.createContentTypesSection(),
        });

        dialog.addItem({
            title: this.t('settingsAdvanced'),
            direction: 'row',
            actionElement: this.createAdvancedSection(),
        });

        dialog.open(this.plugin.displayName || 'ReadItLater');
    }

    private t(key: string): string {
        return this.i18n[key] ?? key;
    }

    // ---------------------------------------------------------------- sections

    private createGeneralSection(): HTMLElement {
        const container = this.createSectionContainer();

        const notebookRow = this.createSettingRow(this.t('settingsNotebook'), this.t('settingsNotebookDesc'));
        const notebookSelect = document.createElement('select');
        notebookSelect.className = 'b3-select fn__size200';

        const fillNotebooks = () => {
            notebookSelect.innerHTML = '';
            listNotebooks()
                .then((notebooks) => {
                    const open = notebooks.filter((notebook) => !notebook.closed);
                    if (open.length === 0) {
                        const option = document.createElement('option');
                        option.value = '';
                        option.textContent = this.t('settingsNoNotebooks');
                        notebookSelect.appendChild(option);
                        return;
                    }

                    for (const notebook of open) {
                        const option = document.createElement('option');
                        option.value = notebook.id;
                        option.textContent = notebook.name;
                        notebookSelect.appendChild(option);
                    }
                    notebookSelect.value =
                        this.plugin.settings.notebook && open.some((n) => n.id === this.plugin.settings.notebook)
                            ? (this.plugin.settings.notebook as string)
                            : open[0].id;
                })
                .catch((error) => console.error(error));
        };
        fillNotebooks();

        notebookSelect.addEventListener('change', () => {
            void this.plugin.saveSetting('notebook', notebookSelect.value);
        });
        notebookRow.appendChild(notebookSelect);
        container.appendChild(notebookRow);

        this.addTextSetting(container, this.t('settingsInboxDir'), this.t('settingsInboxDirDesc'), 'inboxDir', {
            placeholder: 'ReadItLater Inbox',
        });
        this.addTextSetting(container, this.t('settingsAssetsDir'), this.t('settingsAssetsDirDesc'), 'assetsDir', {
            placeholder: DEFAULT_SETTINGS.assetsDir as string,
        });

        const imageBedContainer = document.createElement('div');
        container.appendChild(imageBedContainer);
        this.renderImageBedSettings(imageBedContainer);

        this.addToggleSetting(
            container,
            this.t('settingsOpenNewNote'),
            this.t('settingsOpenNewNoteDesc'),
            'openNewNote',
            (value) => {
                if (value === true) {
                    this.plugin.settings.openNewNoteInNewTab = false;
                }
            },
        );
        this.addToggleSetting(
            container,
            this.t('settingsOpenNewNoteInNewTab'),
            this.t('settingsOpenNewNoteInNewTabDesc'),
            'openNewNoteInNewTab',
            (value) => {
                if (value === true) {
                    this.plugin.settings.openNewNote = false;
                }
            },
        );

        this.addSelectSetting(
            container,
            this.t('settingsFileExistsStrategy'),
            this.t('settingsFileExistsStrategyDesc'),
            'fileExistsStrategy',
            getFileExistStrategyOptions().map((option) => ({ label: option.label, value: option.option })),
        );

        this.addSelectSetting(
            container,
            this.t('settingsBatchDelimiter'),
            this.t('settingsBatchDelimiterDesc'),
            'batchProcessDelimiter',
            getDelimiterOptions().map((option) => ({ label: option.label, value: option.option })),
        );

        this.addTextSetting(container, this.t('settingsDateFormat'), this.t('settingsDateFormatDesc'), 'dateTitleFmt', {
            placeholder: DEFAULT_SETTINGS.dateTitleFmt as string,
        });
        this.addTextSetting(
            container,
            this.t('settingsDateFormatContent'),
            this.t('settingsDateFormatContentDesc'),
            'dateContentFmt',
            { placeholder: DEFAULT_SETTINGS.dateContentFmt as string },
        );
        this.addTextSetting(
            container,
            this.t('settingsYoutubeApiKey'),
            this.t('settingsYoutubeApiKeyDesc'),
            'youtubeApiKey',
            { placeholder: '' },
        );

        return container;
    }

    private createContentTypesSection(): HTMLElement {
        const container = this.createSectionContainer();
        const info = document.createElement('div');
        info.className = 'b3-label__text';
        info.style.marginBottom = '8px';
        info.textContent = this.t('settingsTemplateVarsRef');
        container.appendChild(info);

        // Readable Article
        const articleDetails = this.createDetailsElement(container, DetailsItem.ReadableArticle, 'Readable Article');
        this.addTextSetting(articleDetails, this.slugName(), this.templateDesc(), 'parseableArticleContentType', {
            placeholder: DEFAULT_SETTINGS.parseableArticleContentType as string,
        });
        this.addTextSetting(articleDetails, this.titleName(), this.templateDesc(), 'parseableArticleNoteTitle', {
            placeholder: DEFAULT_SETTINGS.parseableArticleNoteTitle as string,
        });
        this.addTextareaSetting(articleDetails, this.noteName(), this.templateDesc(), 'parsableArticleNote');
        this.addDownloadImagesSettings(articleDetails, 'downloadImages', 'downloadImagesInArticleDir');

        // YouTube
        const youtubeDetails = this.createDetailsElement(container, DetailsItem.Youtube, 'YouTube');
        this.addTextSetting(youtubeDetails, this.slugName(), this.templateDesc(), 'youtubeContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.youtubeContentTypeSlug as string,
        });
        this.addTextSetting(youtubeDetails, this.titleName(), this.templateDesc(), 'youtubeNoteTitle', {
            placeholder: DEFAULT_SETTINGS.youtubeNoteTitle as string,
        });
        this.addTextareaSetting(youtubeDetails, this.noteName(), this.templateDesc(), 'youtubeNote');
        this.addTextareaSetting(youtubeDetails, this.t('chapterTemplate'), this.templateDesc(), 'youtubeChapter');
        this.addTextSetting(youtubeDetails, this.t('embedWidth'), '', 'youtubeEmbedWidth', {
            placeholder: DEFAULT_SETTINGS.youtubeEmbedWidth as string,
        });
        this.addTextSetting(youtubeDetails, this.t('embedHeight'), '', 'youtubeEmbedHeight', {
            placeholder: DEFAULT_SETTINGS.youtubeEmbedHeight as string,
        });
        this.addToggleSetting(
            youtubeDetails,
            this.t('embedPrivacy'),
            this.t('embedPrivacyDesc'),
            'youtubeUsePrivacyEnhancedEmbed',
        );

        // YouTube channel
        const channelDetails = this.createDetailsElement(container, DetailsItem.YoutubeChannel, 'YouTube channel');
        this.addTextSetting(channelDetails, this.slugName(), this.templateDesc(), 'youtubeChannelContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.youtubeChannelContentTypeSlug as string,
        });
        this.addTextSetting(channelDetails, this.titleName(), this.templateDesc(), 'youtubeChannelNoteTitle', {
            placeholder: DEFAULT_SETTINGS.youtubeChannelNoteTitle as string,
        });
        this.addTextareaSetting(channelDetails, this.noteName(), this.templateDesc(), 'youtubeChannelNote');

        // X.com
        const xDetails = this.createDetailsElement(container, DetailsItem.X, 'X.com');
        this.addTextSetting(xDetails, this.slugName(), this.templateDesc(), 'twitterContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.twitterContentTypeSlug as string,
        });
        this.addTextSetting(xDetails, this.titleName(), this.templateDesc(), 'twitterNoteTitle', {
            placeholder: DEFAULT_SETTINGS.twitterNoteTitle as string,
        });
        this.addTextareaSetting(xDetails, this.noteName(), this.templateDesc(), 'twitterNote');

        // Bluesky
        const blueskyDetails = this.createDetailsElement(container, DetailsItem.Bluesky, 'Bluesky');
        this.addTextSetting(blueskyDetails, this.slugName(), this.templateDesc(), 'blueskyContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.blueskyContentTypeSlug as string,
        });
        this.addTextSetting(blueskyDetails, this.titleName(), this.templateDesc(), 'blueskyNoteTitle', {
            placeholder: DEFAULT_SETTINGS.blueskyNoteTitle as string,
        });
        this.addTextareaSetting(blueskyDetails, this.noteName(), this.templateDesc(), 'blueskyNote');
        this.addDownloadImagesSettings(blueskyDetails, 'downloadBlueskyEmbeds', 'downloadBlueskyEmbedsInDir', true);
        this.addToggleSetting(
            blueskyDetails,
            this.t('saveReplies'),
            this.t('saveRepliesDesc'),
            'saveBlueskyPostReplies',
        );
        this.addTextareaSetting(blueskyDetails, this.t('replyTemplate'), '', 'blueskyPostReply');

        // Stack Exchange
        const stackExchangeDetails = this.createDetailsElement(container, DetailsItem.StackExchange, 'Stack Exchange');
        this.addTextSetting(stackExchangeDetails, this.slugName(), this.templateDesc(), 'stackExchangeContentType', {
            placeholder: DEFAULT_SETTINGS.stackExchangeContentType as string,
        });
        this.addTextSetting(stackExchangeDetails, this.titleName(), '', 'stackExchangeNoteTitle', {
            placeholder: DEFAULT_SETTINGS.stackExchangeNoteTitle as string,
        });
        this.addTextareaSetting(stackExchangeDetails, this.noteName(), this.templateDesc(), 'stackExchangeNote');
        this.addTextareaSetting(
            stackExchangeDetails,
            'Stack Exchange answer template',
            this.templateDesc(),
            'stackExchangeAnswer',
        );
        this.addDownloadImagesSettings(
            stackExchangeDetails,
            'downloadStackExchangeAssets',
            'downloadStackExchangeAssetsInDir',
        );

        // Pinterest
        const pinterestDetails = this.createDetailsElement(container, DetailsItem.Pinterest, 'Pinterest');
        this.addTextSetting(pinterestDetails, this.slugName(), this.templateDesc(), 'pinterestContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.pinterestContentTypeSlug as string,
        });
        this.addTextSetting(pinterestDetails, this.titleName(), this.templateDesc(), 'pinterestNoteTitle', {
            placeholder: DEFAULT_SETTINGS.pinterestNoteTitle as string,
        });
        this.addTextareaSetting(pinterestDetails, this.noteName(), this.templateDesc(), 'pinterestNote');
        this.addDownloadImagesSettings(pinterestDetails, 'downloadPinterestImage', null);

        // Mastodon
        const mastodonDetails = this.createDetailsElement(container, DetailsItem.Mastodon, 'Mastodon');
        this.addTextSetting(mastodonDetails, this.slugName(), this.templateDesc(), 'mastodonContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.mastodonContentTypeSlug as string,
        });
        this.addTextSetting(mastodonDetails, this.titleName(), this.templateDesc(), 'mastodonNoteTitle', {
            placeholder: DEFAULT_SETTINGS.mastodonNoteTitle as string,
        });
        this.addTextareaSetting(mastodonDetails, this.noteName(), this.templateDesc(), 'mastodonNote');
        this.addDownloadImagesSettings(
            mastodonDetails,
            'downloadMastodonMediaAttachments',
            'downloadMastodonMediaAttachmentsInDir',
        );
        this.addToggleSetting(mastodonDetails, this.t('saveReplies'), this.t('saveRepliesDesc'), 'saveMastodonReplies');
        this.addTextareaSetting(mastodonDetails, this.t('replyTemplate'), '', 'mastodonReply');

        // Vimeo
        const vimeoDetails = this.createDetailsElement(container, DetailsItem.Vimeo, 'Vimeo');
        this.addTextSetting(vimeoDetails, this.slugName(), this.templateDesc(), 'vimeoContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.vimeoContentTypeSlug as string,
        });
        this.addTextSetting(vimeoDetails, this.titleName(), this.templateDesc(), 'vimeoNoteTitle', {
            placeholder: DEFAULT_SETTINGS.vimeoNoteTitle as string,
        });
        this.addTextareaSetting(vimeoDetails, this.noteName(), this.templateDesc(), 'vimeoNote');
        this.addTextSetting(vimeoDetails, this.t('embedWidth'), '', 'vimeoEmbedWidth', {
            placeholder: DEFAULT_SETTINGS.vimeoEmbedWidth as string,
        });
        this.addTextSetting(vimeoDetails, this.t('embedHeight'), '', 'vimeoEmbedHeight', {
            placeholder: DEFAULT_SETTINGS.vimeoEmbedHeight as string,
        });

        // Bilibili
        const bilibiliDetails = this.createDetailsElement(container, DetailsItem.Bilibili, 'Bilibili');
        this.addTextSetting(bilibiliDetails, this.slugName(), this.templateDesc(), 'bilibiliContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.bilibiliContentTypeSlug as string,
        });
        this.addTextSetting(bilibiliDetails, this.titleName(), this.templateDesc(), 'bilibiliNoteTitle', {
            placeholder: DEFAULT_SETTINGS.bilibiliNoteTitle as string,
        });
        this.addTextareaSetting(bilibiliDetails, this.noteName(), this.templateDesc(), 'bilibiliNote');
        this.addTextSetting(bilibiliDetails, this.t('embedWidth'), '', 'bilibiliEmbedWidth', {
            placeholder: DEFAULT_SETTINGS.bilibiliEmbedWidth as string,
        });
        this.addTextSetting(bilibiliDetails, this.t('embedHeight'), '', 'bilibiliEmbedHeight', {
            placeholder: DEFAULT_SETTINGS.bilibiliEmbedHeight as string,
        });

        // TikTok
        const tikTokDetails = this.createDetailsElement(container, DetailsItem.TikTok, 'TikTok');
        this.addTextSetting(tikTokDetails, this.slugName(), this.templateDesc(), 'tikTokContentTypeSlug', {
            placeholder: DEFAULT_SETTINGS.tikTokContentTypeSlug as string,
        });
        this.addTextSetting(tikTokDetails, this.titleName(), this.templateDesc(), 'tikTokNoteTitle', {
            placeholder: DEFAULT_SETTINGS.tikTokNoteTitle as string,
        });
        this.addTextareaSetting(tikTokDetails, this.noteName(), this.templateDesc(), 'tikTokNote');
        this.addTextSetting(tikTokDetails, this.t('embedWidth'), '', 'tikTokEmbedWidth', {
            placeholder: DEFAULT_SETTINGS.tikTokEmbedWidth as string,
        });
        this.addTextSetting(tikTokDetails, this.t('embedHeight'), '', 'tikTokEmbedHeight', {
            placeholder: DEFAULT_SETTINGS.tikTokEmbedHeight as string,
        });

        // Nonreadable article
        const nonReadableDetails = this.createDetailsElement(
            container,
            DetailsItem.NonReadableArticle,
            'Nonreadable Article',
        );
        this.addTextSetting(
            nonReadableDetails,
            this.slugName(),
            this.templateDesc(),
            'notParseableArticleContentType',
            {
                placeholder: DEFAULT_SETTINGS.notParseableArticleContentType as string,
            },
        );
        this.addTextSetting(nonReadableDetails, this.titleName(), this.templateDesc(), 'notParseableArticleNoteTitle', {
            placeholder: DEFAULT_SETTINGS.notParseableArticleNoteTitle as string,
        });
        this.addTextareaSetting(nonReadableDetails, this.noteName(), this.templateDesc(), 'notParsableArticleNote');

        // Text snippet
        const textSnippetDetails = this.createDetailsElement(container, DetailsItem.TextSnippet, 'Text Snippet');
        this.addTextSetting(textSnippetDetails, this.slugName(), this.templateDesc(), 'textSnippetContentType', {
            placeholder: DEFAULT_SETTINGS.textSnippetContentType as string,
        });
        this.addTextSetting(textSnippetDetails, this.titleName(), this.templateDesc(), 'textSnippetNoteTitle', {
            placeholder: DEFAULT_SETTINGS.textSnippetNoteTitle as string,
        });
        this.addTextareaSetting(textSnippetDetails, this.noteName(), this.templateDesc(), 'textSnippetNote');

        return container;
    }

    private createAdvancedSection(): HTMLElement {
        const container = this.createSectionContainer();
        const defaults = getDefaultFilesystenLimits();

        const pathRow = this.createSettingRow(
            this.t('settingsFsLimitPath'),
            this.t('settingsFsLimitPathDesc').replace('{default}', String(defaults.path)),
        );
        const pathInput = document.createElement('input');
        pathInput.className = 'b3-text-field fn__size200';
        pathInput.placeholder = String(defaults.path);
        pathInput.value =
            this.plugin.settings.filesystemLimitPath == null ? '' : String(this.plugin.settings.filesystemLimitPath);
        pathInput.addEventListener('change', () => {
            this.saveNumericSetting('filesystemLimitPath', pathInput.value);
        });
        pathRow.appendChild(pathInput);
        container.appendChild(pathRow);

        const fileNameRow = this.createSettingRow(
            this.t('settingsFsLimitFileName'),
            this.t('settingsFsLimitFileNameDesc').replace('{default}', String(defaults.fileName)),
        );
        const fileNameInput = document.createElement('input');
        fileNameInput.className = 'b3-text-field fn__size200';
        fileNameInput.placeholder = String(defaults.fileName);
        fileNameInput.value =
            this.plugin.settings.filesystemLimitFileName == null
                ? ''
                : String(this.plugin.settings.filesystemLimitFileName);
        fileNameInput.addEventListener('change', () => {
            this.saveNumericSetting('filesystemLimitFileName', fileNameInput.value);
        });
        fileNameRow.appendChild(fileNameInput);
        container.appendChild(fileNameRow);

        return container;
    }

    // ---------------------------------------------------------------- builders

    /**
     * Image bed settings group. Re-renders itself on the master toggle so the
     * URL / token / resource-category rows only appear when the image bed is on.
     */
    private renderImageBedSettings(host: HTMLElement): void {
        host.innerHTML = '';

        this.addToggleSetting(
            host,
            this.t('settingsImageBedToggle'),
            this.t('settingsImageBedToggleDesc'),
            'useImageBed',
            () => {
                this.renderImageBedSettings(host);
            },
        );

        if (this.plugin.settings.useImageBed !== true) {
            return;
        }

        this.addTextSetting(host, this.t('settingsImageBedUrl'), this.t('settingsImageBedUrlDesc'), 'imageBedUrl', {
            placeholder: 'https://imgbed.example.com',
        });
        this.addTextSetting(
            host,
            this.t('settingsImageBedLinkUrl'),
            this.t('settingsImageBedLinkUrlDesc'),
            'imageBedLinkUrl',
            { placeholder: 'https://imgbed.example.com' },
        );
        this.addTextSetting(
            host,
            this.t('settingsImageBedToken'),
            this.t('settingsImageBedTokenDesc'),
            'imageBedToken',
            { placeholder: '' },
        );

        // Right-aligned with the control column of the rows above (URL / token
        // inputs); b3-label rows inset their content by 24px on the right.
        const checkRow = document.createElement('div');
        checkRow.className = 'fn__flex';
        checkRow.style.justifyContent = 'flex-end';
        checkRow.style.paddingRight = '24px';
        checkRow.style.marginTop = '-14px';
        const checkButton = document.createElement('button');
        checkButton.className = 'b3-button b3-button--outline';
        checkButton.textContent = this.t('settingsImageBedCheck');
        checkButton.addEventListener('click', () => {
            checkButton.disabled = true;
            checkButton.textContent = this.t('imgbedCheckRunning');
            void this.plugin.checkImageBedConnection().finally(() => {
                checkButton.disabled = false;
                checkButton.textContent = this.t('settingsImageBedCheck');
            });
        });
        checkRow.appendChild(checkButton);
        host.appendChild(checkRow);

        const resourcesRow = this.createSettingRow(
            this.t('settingsImageBedResources'),
            this.t('settingsImageBedResourcesDesc'),
        );
        const checkboxGroup = document.createElement('div');
        checkboxGroup.className = 'fn__flex';
        checkboxGroup.style.gap = '12px';
        checkboxGroup.style.flexWrap = 'wrap';

        const categories: Array<{ key: string; labelKey: string; onChange?: (checked: boolean) => void }> = [
            { key: 'imageBedUploadImages', labelKey: 'settingsImageBedResImages' },
            { key: 'imageBedUploadVideos', labelKey: 'settingsImageBedResVideos' },
            { key: 'imageBedUploadFiles', labelKey: 'settingsImageBedResFiles' },
            {
                key: 'imageBedUploadCustom',
                labelKey: 'settingsImageBedResCustom',
                onChange: () => this.renderImageBedSettings(host),
            },
        ];
        for (const category of categories) {
            const item = document.createElement('label');
            item.className = 'fn__flex fn__flex-center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'b3-switch';
            checkbox.checked = this.plugin.settings[category.key] === true;
            checkbox.addEventListener('change', () => {
                void this.plugin.saveSetting(category.key, checkbox.checked);
                category.onChange?.(checkbox.checked);
            });
            const label = document.createElement('span');
            label.textContent = this.t(category.labelKey);
            label.style.marginLeft = '4px';
            item.append(checkbox, label);
            checkboxGroup.appendChild(item);
        }
        resourcesRow.appendChild(checkboxGroup);
        host.appendChild(resourcesRow);

        if (this.plugin.settings.imageBedUploadCustom === true) {
            this.addTextSetting(
                host,
                this.t('settingsImageBedCustomExt'),
                this.t('settingsImageBedCustomExtDesc'),
                'imageBedCustomExtensions',
                { placeholder: 'apk, zip, psd' },
            );
        }
    }

    private createSectionContainer(): HTMLElement {
        const container = document.createElement('div');
        container.style.padding = '8px 16px';
        return container;
    }

    private createSettingRow(name: string, description: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'b3-label fn__flex';

        const textBlock = document.createElement('div');
        textBlock.className = 'fn__flex-1';

        const nameElement = document.createElement('div');
        nameElement.textContent = name;
        textBlock.appendChild(nameElement);

        if (description) {
            const descriptionElement = document.createElement('div');
            descriptionElement.className = 'b3-label__text';
            descriptionElement.textContent = description;
            textBlock.appendChild(descriptionElement);
        }

        row.appendChild(textBlock);
        row.appendChild(document.createElement('span')).className = 'fn__space';
        return row;
    }

    private addTextSetting(
        container: HTMLElement,
        name: string,
        description: string,
        settingKey: string,
        options: { placeholder?: string } = {},
    ): void {
        const row = this.createSettingRow(name, description);
        const input = document.createElement('input');
        input.className = 'b3-text-field fn__size200';
        input.placeholder = options.placeholder ?? '';
        const storedValue = this.plugin.settings[settingKey];
        input.value = storedValue == null ? '' : String(storedValue);
        input.addEventListener('change', () => {
            void this.plugin.saveSetting(settingKey, input.value);
        });
        row.appendChild(input);
        container.appendChild(row);
    }

    private addTextareaSetting(container: HTMLElement, name: string, description: string, settingKey: string): void {
        // Stacked layout: title and description above the full-width textarea,
        // matching how SiYuan renders multiline template settings.
        const row = document.createElement('div');
        row.className = 'b3-label';

        const nameElement = document.createElement('div');
        nameElement.textContent = name;
        row.appendChild(nameElement);

        if (description) {
            const descriptionElement = document.createElement('div');
            descriptionElement.className = 'b3-label__text';
            descriptionElement.textContent = description;
            row.appendChild(descriptionElement);
        }

        const textarea = document.createElement('textarea');
        textarea.className = 'b3-text-field fn__block';
        textarea.rows = 8;
        textarea.style.marginTop = '4px';
        const storedValue = this.plugin.settings[settingKey];
        textarea.value = storedValue == null ? '' : String(storedValue);
        textarea.addEventListener('change', () => {
            void this.plugin.saveSetting(settingKey, textarea.value);
        });
        row.appendChild(textarea);
        container.appendChild(row);
    }

    private addToggleSetting(
        container: HTMLElement,
        name: string,
        description: string,
        settingKey: string,
        beforeSave?: (value: boolean) => void,
    ): void {
        const row = this.createSettingRow(name, description);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'b3-switch fn__flex-center';
        checkbox.checked = this.plugin.settings[settingKey] === true;
        checkbox.addEventListener('change', () => {
            beforeSave?.(checkbox.checked);
            void this.plugin.saveSetting(settingKey, checkbox.checked);
        });
        row.appendChild(checkbox);
        container.appendChild(row);
    }

    private addSelectSetting(
        container: HTMLElement,
        name: string,
        description: string,
        settingKey: string,
        options: { label: string; value: string }[],
    ): void {
        const row = this.createSettingRow(name, description);
        const select = document.createElement('select');
        select.className = 'b3-select fn__size200';
        for (const option of options) {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            select.appendChild(optionElement);
        }
        const storedValue = this.plugin.settings[settingKey];
        select.value = storedValue == null ? '' : String(storedValue);
        select.addEventListener('change', () => {
            void this.plugin.saveSetting(settingKey, select.value);
        });
        row.appendChild(select);
        container.appendChild(row);
    }

    private addDownloadImagesSettings(
        container: HTMLElement,
        mainKey: string,
        dirKey: string | null,
        embeddedLabel = false,
    ): void {
        const mainLabel = embeddedLabel ? this.t('downloadEmbedded') : this.t('downloadImages');
        const mainDirLabel = embeddedLabel ? this.t('downloadEmbeddedInDir') : this.t('downloadImagesInDir');
        const mainDirDesc = embeddedLabel ? this.t('downloadEmbeddedInDirDesc') : this.t('downloadImagesInDirDesc');

        this.addToggleSetting(
            container,
            mainLabel,
            embeddedLabel ? this.t('downloadImagesDesc') : this.t('downloadImagesDesc'),
            mainKey,
            (value) => {
                if (dirKey && value === false) {
                    this.plugin.settings[dirKey] = false;
                    void this.plugin.saveSetting(dirKey, false);
                }
            },
        );

        if (dirKey) {
            this.addToggleSetting(container, mainDirLabel, mainDirDesc, dirKey, (value) => {
                if (value === true) {
                    this.plugin.settings[mainKey] = true;
                    void this.plugin.saveSetting(mainKey, true);
                }
            });
        }
    }

    private saveNumericSetting(settingKey: string, value: string): void {
        const trimmedValue = value.trim();
        if (trimmedValue === '') {
            void this.plugin.saveSetting(settingKey, null);
            return;
        }
        const numeric = Number(trimmedValue);
        if (Number.isNaN(numeric)) {
            return;
        }
        void this.plugin.saveSetting(settingKey, numeric);
    }

    private createDetailsElement(parentElement: HTMLElement, itemId: DetailsItem, title: string): HTMLElement {
        const details = document.createElement('details');
        details.addEventListener('toggle', () => {
            if (details.open) {
                this.activeDetails.push(itemId);
            } else {
                this.activeDetails = this.activeDetails.filter((item) => item !== itemId);
            }
        });

        if (this.activeDetails.includes(itemId)) {
            details.setAttribute('open', '');
        }

        const summary = document.createElement('summary');
        summary.textContent = title;
        summary.style.fontWeight = 'bold';
        summary.style.margin = '12px 0 4px';
        details.appendChild(summary);

        parentElement.appendChild(details);
        return details;
    }

    private slugName(): string {
        return this.t('contentTypeSlug');
    }

    private titleName(): string {
        return this.t('noteTemplateTitle');
    }

    private noteName(): string {
        return this.t('noteTemplate');
    }

    private templateDesc(): string {
        return this.t('settingsTemplateVarsRef');
    }
}
