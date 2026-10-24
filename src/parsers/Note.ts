import { normalizeFilename } from 'src/helpers/fileutils';

export class Note {
    private _filePath: string | null = null;
    /** SiYuan document ID, set by the repository after the doc has been created. */
    public docId?: string;

    constructor(
        public readonly fileName: string,
        public readonly fileExtension: string,
        public readonly content: string,
        public readonly contentType: string,
        public readonly createdAt: Date,
    ) {
        this.fileName = normalizeFilename(this.fileName);
    }

    /**
     * Display name of the note. SiYuan document titles carry no file extension.
     */
    public getFullFilename(): string {
        return `${this.fileName}`;
    }

    /** Human-readable path (hPath) of the note inside its notebook, set before saving. */
    public get filePath() {
        return this._filePath;
    }

    public set filePath(filePath: string) {
        this._filePath = filePath;
    }
}
