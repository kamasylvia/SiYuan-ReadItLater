import { IProtyle } from 'siyuan';
import ParserCreator from './parsers/ParserCreator';
import { VaultRepository } from './repository/VaultRepository';
import { Note } from './parsers/Note';
import FileExistsError from './error/FileExists';
import FileExistsAsk from './modal/FileExistsAsk';
import { FileExistsStrategy } from './enums/fileExistsStrategy';
import ReadItLaterPlugin from './main';
import { getAndCheckUrls } from './helpers/stringUtils';
import { Notice } from './ui/notice';
import { uploadImageBedInBackground } from './helpers/imageBed';

export class NoteService {
    constructor(
        private parserCreator: ParserCreator,
        private plugin: ReadItLaterPlugin,
        private repository: VaultRepository,
    ) {}

    public async createNote(content: string): Promise<void> {
        const note = await this.makeNote(content);
        try {
            await this.repository.saveNote(note);
            // Clip completed; image bed upload runs in the background and
            // swaps local links afterwards. Never awaited here.
            if (this.plugin.pendingImageBed.length > 0 && note.docId) {
                void uploadImageBedInBackground(this.plugin, note.docId);
            }
        } catch (error) {
            if (error instanceof FileExistsError) {
                this.handleFileExistsError([note]);
            }
        }
    }

    public async createNotesFromBatch(contentBatch: string): Promise<void> {
        const urlCheckResult = getAndCheckUrls(contentBatch, this.plugin.settings.batchProcessDelimiter);
        const existingNotes: Note[] = [];

        for (const contentSegment of urlCheckResult.everyLineIsURL ? urlCheckResult.urls : [contentBatch]) {
            const note = await this.makeNote(contentSegment);
            try {
                await this.repository.saveNote(note);
                if (this.plugin.pendingImageBed.length > 0 && note.docId) {
                    void uploadImageBedInBackground(this.plugin, note.docId);
                }
            } catch (error) {
                if (error instanceof FileExistsError) {
                    existingNotes.push(note);
                }
            }
        }

        if (existingNotes.length > 0) {
            this.handleFileExistsError(existingNotes);
        }
    }

    public async insertContentAtEditorCursorPosition(content: string, protyle: IProtyle): Promise<void> {
        const note = await this.makeNote(content);
        // Cursor insert has no saved doc to swap links in; drop the queue.
        this.plugin.pendingImageBed.length = 0;
        protyle.getInstance().insert(note.content, true);
    }

    private async makeNote(content: string): Promise<Note> {
        try {
            const parser = await this.parserCreator.createParser(content);
            return await parser.prepareNote(content);
        } catch (error) {
            new Notice(`ReadItLater: Failed to process content. ${error.message}`);
            throw error;
        }
    }

    private async openNote(note: Note): Promise<void> {
        if (this.plugin.settings.openNewNote || this.plugin.settings.openNewNoteInNewTab) {
            try {
                await this.repository.openNote(note);
            } catch (error) {
                console.error(error);
                new Notice(`Unable to open ${note.getFullFilename()}`);
            }
        }
    }

    private async handleFileExistsError(notes: Note[]): Promise<void> {
        switch (this.plugin.settings.fileExistsStrategy) {
            case FileExistsStrategy.Ask:
                new FileExistsAsk(notes, (strategy, doNotAskAgain) => {
                    this.handleFileAskModalResponse(strategy, doNotAskAgain, notes);
                });
                break;
            case FileExistsStrategy.Nothing:
                this.handleFileExistsStrategyNothing(notes);
                break;
            case FileExistsStrategy.AppendToExisting:
                this.handleFileExistsStrategyAppend(notes);
                break;
        }
    }

    private async handleFileAskModalResponse(
        strategy: FileExistsStrategy,
        doNotAskAgain: boolean,
        notes: Note[],
    ): Promise<void> {
        switch (strategy) {
            case FileExistsStrategy.Nothing:
                this.handleFileExistsStrategyNothing(notes);
                break;
            case FileExistsStrategy.AppendToExisting:
                await this.handleFileExistsStrategyAppend(notes);
                break;
        }

        if (doNotAskAgain) {
            this.plugin.saveSetting('fileExistsStrategy', strategy as FileExistsStrategy);
        }

        if (notes.length === 1) {
            this.openNote(notes.shift());
        }
    }

    private async handleFileExistsStrategyAppend(notes: Note[]): Promise<void> {
        for (const note of notes) {
            try {
                await this.repository.appendToExistingNote(note);
                new Notice(`${note.getFullFilename()} was updated.`);
            } catch (error) {
                console.error(error);
                new Notice(`${note.getFullFilename()} was not updated!`, 0);
            }
        }
    }

    private handleFileExistsStrategyNothing(notes: Note[]): void {
        for (const note of notes) {
            new Notice(`${note.getFullFilename()} already exists.`);
        }
    }
}
