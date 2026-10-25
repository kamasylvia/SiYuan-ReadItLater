# ReadItLater Plugin for SiYuan

A SiYuan note plugin ported from the Obsidian plugin [obsidian-ReadItLater](https://github.com/DominikPieper/obsidian-ReadItLater) by Dominik Pieper.

## Table of contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Usage](#usage)
- [Template engine](#template-engine)
- [Inbox directory and assets](#inbox-directory-and-assets)
- [Content Types](#content-types)
- [API](#api)
- [Differences from the Obsidian version](#differences-from-the-obsidian-version)
- [Development](#development)

## Introduction

Save the web with ReadItLater for SiYuan. Archive web pages for reading later, referencing in your second brain or for other flexible use case SiYuan provides.

ReadItLater can do a lot more than converting web pages to markdown. For every content type there is specific template with carefully selected variables to ease up your archiving process.

### What makes ReadItLater plugin great?

- Simple, but powerful template engine
- Carefully selected predefined template variables to straightforward archiving process
- Compatibility with SiYuan desktop, mobile and browser frontends
- Downloading images from articles to your workspace assets
- Batch processing of URLs list

## Installation

Download the latest release package from the release page, then in SiYuan open `Settings - Marketplace` and use `Import plugin` to install the package manually. Enable the plugin afterwards.

## Usage

To create a single note, click the ReadItLater icon in the left dock bar or run the command `Create from clipboard` from the command palette. You can also create multiple notes from a batch of URLs, delimited by the delimiter selected in plugin settings, using the `Create from batch in clipboard` command.

If you want to add content to an existing note, focus the editor and run the command `Insert at the cursor position` to insert content at the current cursor position.

Before saving notes, select the target notebook in the plugin settings (`Settings - Plugins - ReadItLater`). Notes are created as documents inside `Inbox directory` of that notebook; the document title is the rendered note title template.

## Template engine

ReadItLater provides for every content type dedicated template that can be edited in plugin settings.

### Variables

Variables are rendered in template using familiar syntax `{{ content }}`. Nested data types can be accessed using dot notation `{{ author.name }}`.

### Filters

Variables output can be modified using filters. Filters are separated by `|` symbol. Filters can be chained, so output of the previous is passed to the next.

<details>
<summary>blockquote</summary>

Adds quote prefix to each line of value.
</details>

<details>
<summary>capitalize</summary>

Converts the first letter to uppercase.
</details>

<details>
<summary>upper</summary>

Converts all letters to uppercase.
</details>

<details>
<summary>lower</summary>

Converts all letters to lowercase.
</details>

<details>
<summary>replace(search, replacement)</summary>

Replaces all occurrences of `search` in value with `replacement`.
</details>

<details>
<summary>join(separator)</summary>

Joins an array of strings into a single string separated by `separator`.
</details>

<details>
<summary>striptags</summary>

Removes HTML tags from value.
</details>

<details>
<summary>map(key)</summary>

Extracts `key` from each object in an array, producing an array of extracted values.
</details>

<details>
<summary>numberLexify</summary>

Formats numbers lexically: `1234567` becomes `1.2M`.
</details>

### Loops

Templates can iterate arrays:

```
{% for chapter in videoChapters %}
{{ chapter }}
{% endfor %}
```

## Inbox directory and assets

You can use template variables in `Inbox directory` and `Assets directory` settings to better distribute content in your workspace.

| Directory template variable | Description                                        |
| --------------------------- | -------------------------------------------------- |
| date                        | Current date in format from plugin settings         |
| fileName                    | Title of new note                                   |
| contentType                 | Slug of detected content type from plugin settings  |

Downloaded images are uploaded into the workspace assets directory (default `assets`). The kernel creates missing directories automatically, so nested template paths such as `assets/ReadItLater/{{ date }}` work as well.

### Image bed

Instead of the workspace assets directory, resources can be uploaded to a self-hosted image bed (Sanyue-ImgHub / [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) compatible: `POST /upload`, optional Bearer token, `[{src: "/file/..."}]` response).

Enable **Use image bed** in the settings, then fill in:

- **Image bed upload URL** (required) — base URL the plugin uploads to, e.g. `https://imgbed.example.com`
- **Image bed link URL** (optional) — prefix used for the `/file/...` links written into notes, for setups where the upload origin and the public origin differ (e.g. internal HTTP upload vs public HTTPS). Empty falls back to the upload URL.
- **Image bed Access Token** (optional) — sent as `Authorization: Bearer <token>`
- **Resources uploaded to the image bed** — multi-select: images, videos, files, custom (comma-separated extensions uploaded regardless of category). Defaults: images + videos.

A **Test** button next to the settings rows uploads a probe file through the regular channel and cleans it up afterwards, verifying the image bed is reachable from the current frontend.

Resources whose extension matches a selected category (or one of the custom extensions) are uploaded to the image bed and referenced by its returned URL; everything else keeps the local-assets behavior. WeChat-style URLs without a path extension (`?wx_fmt=png`) are recognized too.

Uploaded links are deduplicated: the source URL → link mapping is persisted in the plugin storage (`imgbed-links.json`), so re-clipping the same article reuses the stored links instead of uploading duplicate files to the image bed. If you switch to a different image bed, clear that storage file (`data/storage/petal/siyuan-read-it-later/imgbed-links.json`) so old links stop being reused.

## Content Types

Structure of note content is determined by URL. Currently the plugin supports saving content of websites and embedding content from multiple services. Each content type has a title and note template with replaceable variables, which can be edited in plugin settings.

Available content types are ordered by URL detection priority.

### Website Article

Will be parsed to readable form using [Mozilla Readability](https://github.com/mozilla/readability) and then converted to markdown. In case website content is marked by [Readability](https://github.com/mozilla/readability) as not readable, an empty note with the URL will be created.

If enabled, images will be downloaded to the assets directory configured in plugin settings.

### Youtube

Embeds the video player; with a configured Youtube Data API v3 key it also fetches metadata, chapters and more.

### Youtube Channel

Saves channel title, avatar, videos URL and subscribers count. Requires a Youtube Data API v3 key.

### Twitter / X.com

Saves tweet content as markdown.

### Bluesky

Saves post content and optionally embedded content and replies.

### Stack Exchange

Saves the question, the top answer and remaining answers.

### Pinterest

Saves the pin image and description.

### Mastodon

Saves toot content and optionally media attachments and replies.

### Vimeo

Embeds the video player and video chapters.

### Bilibili

Embeds the video player.

### TikTok

Saves video description and embeds the player.

### Text Snippet

Fallback for non-URL clipboard content: saves the raw clipboard text as a note.

## API

To invoke functionality from other plugins you can access the API via:

```ts
const readItLater = siyuan.ws.app.plugins.find((p) => p.name === 'siyuan-read-it-later');
await readItLater.api.processContent('https://example.com/some-article');
```

`api` is an instance of the `ReadItLaterApi` class defined in [src/ReadtItLaterApi.ts](src/ReadtItLaterApi.ts) providing:

- `processContent(content: string)` — create a single note
- `processContentBatch(contentBatch: string)` — create multiple notes from a delimited list
- `insertContentAtEditorCursorPosition(content: string, protyle: IProtyle)` — insert at cursor

## Differences from the Obsidian version

- Notes are stored as SiYuan documents (kernel API) instead of plain markdown files; the note title becomes the document title.
- A target notebook must be selected in settings before notes can be saved.
- The `extendShareMenu` setting and the share menu / link context menu entries have no SiYuan equivalent and were removed.
- Web requests are routed through the SiYuan kernel forward proxy, which avoids CORS issues on every frontend.
- Image download works on all frontends (desktop, mobile, browser), not only on desktop.
- Date formatting uses dayjs instead of moment; format strings from the Obsidian version remain compatible.

## Development

```bash
npm install
npm run dev      # development build with watch mode
npm run build    # production build (index.js)
npm run lint     # ESLint with auto-fix
```

The build output is a single `index.js` bundled by esbuild in CommonJS format, loaded by SiYuan together with `plugin.json`, `index.css` and the `i18n/` language files (a root `i18n.json` is kept for older SiYuan releases). `npm run build && zip -r package.zip index.js index.css plugin.json i18n.json i18n icon.png preview.png README.md README.zh-CN.md` produces the installable package. To try the plugin locally, unzip it into `<workspace>/data/plugins/siyuan-read-it-later/` and reload the SiYuan interface.

## License

MIT — see [LICENSE](LICENSE). Original Obsidian plugin by Dominik Pieper; the SiYuan port keeps the same license.
