import { validOperationMarkers, ValidOperations } from "./main";
import { Editor, EditorPosition } from "obsidian";


interface StyleConfig {
	start: string;
	end: string;
}

interface Range {
	from: EditorPosition;
	to: EditorPosition;
}


export class TextTransformer {
	editor: Editor;
	styleConfigs: Record<ValidOperations, StyleConfig> = {
		bold: { start: '**', end: '**' },
		highlight: { start: '==', end: '==' },
		italics: { start: '*', end: '*' },
		inlineCode: { start: '`', end: '`' },
		comment: { start: '%%', end: '%%' },
		strikethrough: { start: '~~', end: '~~' },
		// underscore: { start: '<u>', end: '</u>' },
		// inlineMath: { start: '$', end: '$' },
	};
	currentOperation: ValidOperations;

	constructor() { }

	setEditor(editor: Editor) {
		this.editor = editor;
	}

	transformText(op: ValidOperations): void {
		const selection = this.editor.getSelection();
		this.currentOperation = op;
		console.log(selection)

		if (selection && selection.length > 0) {
			this.handleSelection(selection);
		} else {
			this.handleBareCursor(this.editor.getCursor("anchor"));
		}
	}

	handleBareCursor(cursor: EditorPosition): void {
		if (this.isInsideStyle()) {
			const sel: Range = this.getSmartSelection();
			this.removeStyle(cursor, op);
		} else {
			this.expandAndApplyStyle(cursor, op);
		}
	}

	handleSelection(selection: string): void {
		const from = this.editor.posToOffset(this.editor.getCursor('from'));
		const to = this.editor.posToOffset(this.editor.getCursor('to'));

		if (this.isInsideStyle()) {
			this.removeStyle(from, to, op);
		} else {
			this.applyStyle(from, to, op);
		}
	}
	
	isInsideStyle() {
		// TODO
	}

	/** get the Range of the smart selection created by expanding the current one / from cursor*/
	getSmartSelection() {
		const selection = this.editor.getSelection();
		if (selection && selection.length > 0) {
			return this.getSmartSelectionRange();
		} else {
			return this.getSmartSelectionBare();
		}
	}
	/** get the Range of the smart selection created by expanding from cursor*/
	getSmartSelectionBare() {
		const cursor = this.editor.getCursor("anchor");
		const lineText = this.editor.getLine(cursor.line);
		

		return { } satisfies Range;
	}
	/** get the Range of the smart selection created by expanding the current one*/
	getSmartSelectionRange() {
		return { } satisfies Range;
	}

	applyStyle(from: number, to: number, op: ValidOperations): void {
		// TODO
	}

	removeStyle(from: number, to: number, op: ValidOperations): void {
		// TODO
	}
}

