import { openTab } from 'siyuan';
import { Note } from 'src/parsers/Note';
import ReadItLaterPlugin from 'src/main';
import TemplateEngine from 'src/template/TemplateEngine';
import { formatDate } from 'src/helpers/date';
import FileExistsError from 'src/error/FileExists';
import FileNotFoundError from 'src/error/FileNotFound';
import { applyFilesystemLimits, getFileSystemLimits } from 'src/helpers/fileutils';
import { listNotebooks, postJSON } from 'src/api/kernel';
import { Notice } from 'src/ui/notice';
import { VaultRepository } from './VaultRepository';

/**
 * Persists notes as SiYuan documents through the kernel API.
 * A note title becomes the last segment of the document human path (hPath),
 * created inside the notebook and inbox directory configured in settings.
 */
export default class DefaultVaultRepository implements VaultRepository {
    private plugin: ReadItLaterPlugin;
    private templateEngine: TemplateEngine;

    constructor(plugin: ReadItLaterPlugin, templateEngine: TemplateEngine) {
        this.plugin = plugin;
        this.templateEngine = templateEngine;
    }

    private resolveNotebook(): Promise<string> {
        const configured = this.plugin.settings.notebook;
        if (configured) {
            return Promise.resolve(configured);
        }
        return listNotebooks().then((notebooks) => {
            const open = notebooks.filter((notebook) => !notebook.closed);
            if (open.length === 0) {
                throw new Error('No open notebook configured. Set the target notebook in the plugin settings.');
            }
            return open[0].id;
        });
    }

    private buildDocPath(note: Note): string {
        const inboxDir = this.plugin.settings.inboxDir
            ? this.templateEngine
                  .render(this.plugin.settings.inboxDir, {
                      date: formatDate(note.createdAt, this.plugin.settings.dateTitleFmt),
                      fileName: note.fileName,
                      contentType: note.contentType,
                  })
                  .replace(/^\/+|\/+$/g, '')
            : '';

        const limits = getFileSystemLimits(this.plugin.settings);
        return applyFilesystemLimits(inboxDir, note.fileName, limits);
    }

    public async saveNote(note: Note): Promise<void> {
        const notebook = await this.resolveNotebook();
        const docPath = this.buildDocPath(note);
        note.filePath = docPath;

        if (await this.exists(docPath)) {
            throw new FileExistsError(`${note.getFullFilename()} already exists!`);
        }

        const docId = await postJSON<string>('/api/filetree/createDocWithMd', {
            notebook,
            path: docPath,
            markdown: note.content,
        });

        if (!docId) {
            throw new Error(`Failed to create document ${docPath}`);
        }

        note.docId = docId;
        new Notice(`${note.getFullFilename()} created successfully`);

        if (this.plugin.settings.openNewNote || this.plugin.settings.openNewNoteInNewTab) {
            await this.openNote(note);
        }
    }

    public async exists(docPath: string): Promise<boolean> {
        const notebook = await this.resolveNotebook();
        const docId = await this.findDocIdByHPath(notebook, docPath);
        return docId !== null;
    }

    public async appendToExistingNote(note: Note): Promise<void> {
        const notebook = await this.resolveNotebook();
        const docId = await this.resolveDocId(notebook, note);
        if (!docId) {
            throw new FileNotFoundError(`Document not found: ${note.filePath}`);
        }

        await postJSON('/api/block/insertBlock', {
            dataType: 'markdown',
            data: note.content,
            parentID: docId,
        });
    }

    public async openNote(note: Note): Promise<void> {
        const notebook = await this.resolveNotebook();
        let docId = note.docId;
        if (!docId) {
            docId = await this.resolveDocId(notebook, note);
        }
        if (!docId) {
            throw new FileNotFoundError(`Document not found: ${note.filePath}`);
        }

        await openTab({
            app: this.plugin.app,
            doc: {
                id: docId,
            },
            openNewTab: this.plugin.settings.openNewNoteInNewTab === true,
            keepCursor: false,
        });
    }

    private async resolveDocId(notebook: string, note: Note): Promise<string | null> {
        if (note.filePath == null) {
            return null;
        }
        return await this.findDocIdByHPath(notebook, note.filePath);
    }

    /**
     * Resolves a document ID from its human path via the SQL index.
     * Note: `/api/filetree/getHPathByPath` maps storage paths to human paths and
     * cannot look documents up by hPath, so the SQL index is the reliable source.
     * The blocks index always stores hPath with a leading slash.
     */
    private async findDocIdByHPath(notebook: string, docPath: string): Promise<string | null> {
        const normalizedPath = docPath.startsWith('/') ? docPath : `/${docPath}`;
        const escapedPath = normalizedPath.replace(/'/g, "''");
        const rows = await postJSON<Array<{ id: string }>>('/api/query/sql', {
            stmt: `SELECT id FROM blocks WHERE type = 'd' AND box = '${notebook}' AND hpath = '${escapedPath}' LIMIT 1`,
        });
        return rows && rows.length > 0 ? rows[0].id : null;
    }
}
