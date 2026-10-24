import { Dialog } from 'siyuan';
import { FileExistsStrategy } from 'src/enums/fileExistsStrategy';
import { createHTMLDiv } from 'src/helpers/setting';
import { Note } from 'src/parsers/Note';

/**
 * Ask dialog shown when notes with duplicate titles already exist.
 * Replaces the Obsidian Modal; offers append / nothing plus a "do not ask again" switch.
 */
export default class FileExistsAsk {
    constructor(notes: Note[], onSubmit: (strategy: FileExistsStrategy, doNotAskAgain: boolean) => void) {
        let doNotAskAgain = false;

        const dialog = new Dialog({
            title: 'Duplicate notes detected',
            content: '<div class="b3-dialog__content" id="readitlater-file-exists-content"></div>',
            width: '420px',
        });

        const contentElement = dialog.element.querySelector('#readitlater-file-exists-content') as HTMLElement;

        const fileNames = notes.map((note) => `<li>${note.fileName}</li>`).join('');
        contentElement.appendChild(createHTMLDiv(`<ul>${fileNames}</ul>`));

        const switchRow = document.createElement('label');
        switchRow.className = 'b3-label fn__flex';
        switchRow.innerHTML =
            '<span class="fn__flex-1">Do not ask again</span><input type="checkbox" class="b3-switch">';
        const switchInput = switchRow.querySelector('input') as HTMLInputElement;
        switchInput.addEventListener('change', () => {
            doNotAskAgain = switchInput.checked;
        });
        contentElement.appendChild(switchRow);

        const buttonRow = document.createElement('div');
        buttonRow.className = 'b3-dialog__action';

        const appendButton = document.createElement('button');
        appendButton.className = 'b3-button b3-button--text';
        appendButton.textContent = 'Append to existing';
        appendButton.addEventListener('click', () => {
            dialog.destroy();
            onSubmit(FileExistsStrategy.AppendToExisting, doNotAskAgain);
        });

        const nothingButton = document.createElement('button');
        nothingButton.className = 'b3-button b3-button--cancel';
        nothingButton.textContent = 'Nothing';
        nothingButton.addEventListener('click', () => {
            dialog.destroy();
            onSubmit(FileExistsStrategy.Nothing, doNotAskAgain);
        });

        buttonRow.append(appendButton, nothingButton);
        contentElement.appendChild(buttonRow);
    }
}
