import { validOperationMarkers, ValidOperations } from "./main";
import { base64ToArrayBuffer, Editor, EditorPosition } from "obsidian";


interface StyleConfig {
	start: string;
	end: string;
}

interface Range {
	from: EditorPosition;
	to: EditorPosition;
}

const trimBefore = [
	'"',
	"(",
	"[",
	"###### ",
	"##### ",
	"#### ",
	"### ",
	"## ",
	"# ",
	"- [ ] ",
	"- [x] ",
	"- ",
	">",
	" ",
	"\n",
	"\t",
];

// ]( to not break markdown links
// :: preseve dataview inline fields
const trimAfter = ['"', ")", "](", "::", "]", "\n", "\t", " "];

const reg_before: RegExp = /[A-Za-z0-9]*$/;
const reg_after: RegExp = /^[A-Za-z0-9]*/;


export class TextTransformer {
	editor: Editor;
	styleConfig: Record<ValidOperations, StyleConfig> = {
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

	/** main function to transform text */
	transformText(op: ValidOperations) {
		const selection = this.editor.getSelection();
		this.currentOperation = op;
		console.log(selection)

		if (selection && selection.length > 0) {
			this.handleSelection(selection);
		} else {
			this.handleBareCursor();
		}
	}

	handleBareCursor() {
		const sel = this.getSmartSelection()
		// const selText = this.editor.getRange(sel.from, sel.to);
		if (this.isInsideStyle()) {
			const sel: Range = this.getSmartSelection();
			this.removeStyle(cursor, op);
		} else {
			this.expandAndApplyStyle(cursor, op);
		}
	}

	handleSelection(selection: string) {
		const from = this.editor.posToOffset(this.editor.getCursor('from'));
		const to = this.editor.posToOffset(this.editor.getCursor('to'));

		if (this.isInsideStyle()) {
			this.removeStyle(from, to, op);
		} else {
			this.applyStyle(from, to, op);
		}
	}
	
	/** check if the selection is inside a style (all known styles) */
	isInsideStyle(sel: Range) {
		let isInside = false;
		const start = this.editor.getLine(sel.from.line).slice(0, sel.from.ch);
		const end = this.editor.getLine(sel.to.line).slice(sel.to.ch);

		for (const opkey in this.styleConfig) {
			const operation = this.styleConfig[opkey as ValidOperations];
			if (start.startsWith(operation.start) && end.endsWith(operation.end)) {
				isInside = true;
				break;
			}
		}
		return isInside;
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

		// chunks of selection before & after cursor, string value
		let before = (lineText.slice(0, cursor.ch).match(reg_before) || [""])[0];
		let after = (lineText.slice(cursor.ch).match(reg_after) || [""])[0];

		const start = cursor.ch - before.length;
		const end = cursor.ch + after.length;
		
		return {
			from: { line: cursor.line, ch: start },
			to: { line: cursor.line, ch: end },
		} satisfies Range as Range;
	}
	
	/** get the Range of the smart selection created by expanding the current one*/
	getSmartSelectionRange() {
		const startCursor = this.editor.getCursor("from");
		const endCursor = this.editor.getCursor("to");

		const startLine = this.editor.getLine(startCursor.line);
		const endLine = this.editor.getLine(endCursor.line);

		let before = (startLine.slice(0, startCursor.ch).match(reg_before) || [""])[0];
		let after = (endLine.slice(endCursor.ch).match(reg_after) || [""])[0];
		return {
			from: { line: startCursor.line, ch: startCursor.ch - before.length },
			to: { line: endCursor.line, ch: endCursor.ch + after.length },
		} satisfies Range as Range;
	}

	applyStyle(from: number, to: number, op: ValidOperations) {
		// TODO
	}

	removeStyle(from: number, to: number, op: ValidOperations) {
		// TODO
	}
}

