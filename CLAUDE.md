# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Development build with watch mode
npm run build    # Production build (minified index.js)
npm run lint     # ESLint with auto-fix (src/ only)
npx tsc --noEmit # Typecheck
```

There are no automated tests. The build output is a single `index.js` file bundled by esbuild (CommonJS format, `siyuan` marked external — the host injects it).

## Platform

This is a **SiYuan** plugin, ported from the Obsidian plugin obsidian-ReadItLater. It loads via `plugin.json` + `index.js` + `index.css` + `i18n/<lang>.json` from `<workspace>/data/plugins/siyuan-read-it-later/` (a root `i18n.json` is kept for legacy SiYuan releases; the kernel only reads the `i18n/` dir).

## Architecture

**ReadItLater** saves web content as SiYuan documents. It supports 14 content types via a parser chain pattern.

### Data Flow

1. User triggers action (top bar icon or command) → clipboard content
2. `ReadItLaterApi.processContent()` → `NoteService.createNote()`
3. `ParserCreator` iterates registered parsers calling `parser.test(content)` until one matches
4. Matched parser's `prepareNote()` fetches metadata and returns a `Note` object
5. `TemplateEngine` renders note title and body using per-content-type templates from settings
6. `DefaultVaultRepository` creates a SiYuan document via kernel API (`/api/filetree/createDocWithMd`, hPath = inbox dir + note title)

### Key Components

- **`src/main.ts`** — Plugin entry (extends siyuan `Plugin`); registers parsers in priority order, top bar icon, commands, settings dialog
- **`src/NoteService.ts`** — Core business logic: note creation, batch processing, file conflict handling (Ask/Append/Nothing strategies), cursor insertion via `protyle.getInstance().insert()`
- **`src/parsers/Parser.ts`** — Abstract base: `test(content): boolean` and `prepareNote(content): Promise<Note>`
- **`src/parsers/ParserCreator.ts`** — Factory selecting the right parser; specific parsers before `WebsiteParser`, with `TextSnippetParser` as catch-all
- **`src/parsers/Note.ts`** — Data model returned by parsers (fileName = doc title, content, contentType, docId)
- **`src/api/http.ts`** — `requestUrl`/`request` clones backed by the kernel forward proxy (`/api/network/forwardProxy`), avoiding CORS on all frontends
- **`src/api/kernel.ts`** — Thin `postJSON` wrapper over kernel endpoints + notebook listing
- **`src/repository/DefaultVaultRepository.ts`** — Persistence: createDocWithMd, SQL-index doc lookup (`blocks.hpath`), append via `insertBlock`, open via `openTab`
- **`src/template/TemplateEngine.ts`** — Custom template engine: `{{ variable }}`, `{{ value | filter }}`, `{% for item in array %}...{% endfor %}`
- **`src/views/settings-tab.ts`** — Settings dialog (siyuan `Setting` class) with per-content-type templates
- **`src/settings.ts`** — 80+ settings; per-content-type title template, note template, and content slug; also defines available template filters

### Platform adapters (replacing Obsidian APIs)

| Concern | Adapter |
|---|---|
| HTTP requests | `src/api/http.ts` (kernel forward proxy; text + base64 response encodings) |
| Notices | `src/ui/notice.ts` (`Notice` class → siyuan `showMessage`) |
| Dates | `dayjs` (was Obsidian `moment`; format tokens compatible) |
| Filesystem limits | `applyFilesystemLimits` (title/path length, no real FS involved) |
| Asset storage | `/api/asset/upload` multipart (kernel dedupes/renames files, returns markdown path) |

Note: `/api/filetree/getHPathByPath` maps **storage** paths to human paths — it cannot look docs up by hPath. Doc existence/ID resolution uses `/api/query/sql` against `blocks.hpath`.

### Adding a New Parser

1. Create `src/parsers/MyParser.ts` extending `Parser`
2. Implement `test()` to identify matching URLs/content
3. Implement `prepareNote()` to fetch metadata and return a `Note`
4. Register in `src/main.ts` before `WebsiteParser` in the parser list
5. Add corresponding settings and defaults in `src/settings.ts` + settings tab entry + i18n keys

### Template Engine

Templates use `{{ variableName }}` syntax. Filters chain with `|`:
- `blockquote`, `capitalize`, `upper`, `lower`
- `replace(search, replacement)`, `join(separator)`, `striptags`, `map(key)`, `numberLexify`

Loops: `{% for item in array %}...{% endfor %}`

### Code Style

- TypeScript strict mode (`noImplicitAny`), skipLibCheck on
- Single quotes, 4-space indent, 120-char line width, trailing commas
- Target: ES2022, ESNext modules; esbuild target es2018, CJS output
- `siyuan` is the only external module (types from the `siyuan` npm package)
- UI text comes from `i18n.json` (`en_US` + `zh_CN`); DOM built with SiYuan b3-* CSS classes
