import { Note } from 'src/parsers/Note';

export interface VaultRepository {
    saveNote(note: Note): Promise<void>;

    exists(docPath: string): Promise<boolean>;

    appendToExistingNote(note: Note): Promise<void>;

    /** Opens the note in the workspace; resolves the document ID from the note if needed. */
    openNote(note: Note): Promise<void>;
}
