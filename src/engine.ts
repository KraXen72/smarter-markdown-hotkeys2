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

function escapeRegExp(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}


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
	trimBeforeRegexes: RegExp[] = [];
	trimAfterRegexes: RegExp[] = [];
	
	constructor() {
		this.trimBeforeRegexes = trimBefore.map(x => new RegExp("^" + escapeRegExp(x)));
		this.trimBeforeRegexes.push(/- \[\S\] /); // checked & custom checked checkboxes
		this.trimBeforeRegexes.push(/- \[!\w+\] /); // callouts

		this.trimAfterRegexes = trimAfter.map(x => new RegExp(escapeRegExp(x) + "$"));
	}


	setEditor(editor: Editor) {
		this.editor = editor;
	}

	/** main function to transform text */
	transformText(op: ValidOperations, toggle = true) {
		const checkSel = this.getSmartSelection(false);
		const checkSelInsideOf = this.isInsideAnyStyle(checkSel)
		const selection = this.editor.getSelection();
		const isSelection = !!selection && selection.length > 0;

		if (checkSelInsideOf !== false) {
			this.removeStyle(checkSel, checkSelInsideOf, isSelection);
		} 

		// don't apply the style if we're only toggling and we just removed the style
		if (!toggle || toggle && checkSelInsideOf === false) {
			const sel = this.getSmartSelection(true);
			this.applyStyle(sel, op, isSelection)
		}
	}
	
	/** check if the selection is inside a style (all known styles) */
	isInsideAnyStyle(sel: Range) {
		let wrappedWith: ValidOperations | false = false;
		const start = this.editor.getLine(sel.from.line).slice(0, sel.from.ch);
		const end = this.editor.getLine(sel.to.line).slice(sel.to.ch);

		for (const opkey in this.styleConfig) {
			const operation = this.styleConfig[opkey as ValidOperations];
			if (start.startsWith(operation.start) && end.endsWith(operation.end)) {
				wrappedWith = opkey as ValidOperations;
				break;
			}
		}
		return wrappedWith;
	}

	/** get the Range of the smart selection created by expanding the current one / from cursor*/
	getSmartSelection(trim = true) {
		const selection = this.editor.getSelection();
		if (selection && selection.length > 0) {
			return this.getSmartSelectionRange(trim);
		} else {
			return this.getSmartSelectionBare(trim);
		}
	}
	/** trim the selection to not include stuff we don't want */
	trimSmartSelection(sel: Range) {
		let from = sel.from;
		let to = sel.to;

		const startLine = this.editor.getLine(sel.from.line);
		const endLine = this.editor.getLine(sel.to.line);

		for (const regex of this.trimBeforeRegexes) {
			const match = startLine.slice(
				from.ch, 
				from.line === to.line ? to.ch : startLine.length
			).match(regex);

			if (match) from.ch = from.ch + match[0].length;
		}
		for (const regex of this.trimAfterRegexes) {
			const match = endLine.slice(
				from.line === to.line ? from.ch : 0,
				to.ch, 
			).match(regex);

			if (match) to.ch = to.ch - match[0].length;
		}

		return { from, to } satisfies Range as Range;
	}

	/** get the Range of the smart selection created by expanding from cursor*/
	getSmartSelectionBare(trim: boolean) {
		const cursor = this.editor.getCursor("anchor");
		const lineText = this.editor.getLine(cursor.line);

		// chunks of selection before & after cursor, string value
		let before = (lineText.slice(0, cursor.ch).match(reg_before) || [""])[0];
		let after = (lineText.slice(cursor.ch).match(reg_after) || [""])[0];

		const start = cursor.ch - before.length;
		const end = cursor.ch + after.length;
		
		let sel = {
			from: { line: cursor.line, ch: start },
			to: { line: cursor.line, ch: end },
		} satisfies Range;

		if (trim) sel = this.trimSmartSelection(sel);
		return sel as Range;
	}

	/** get the Range of the smart selection created by expanding the current one*/
	getSmartSelectionRange(trim: boolean) {
		const startCursor = this.editor.getCursor("from");
		const endCursor = this.editor.getCursor("to");

		// chunks of selection before the start cursor & after the end cursor, string value
		const startLine = this.editor.getLine(startCursor.line);
		const endLine = this.editor.getLine(endCursor.line);

		let before = (startLine.slice(0, startCursor.ch).match(reg_before) || [""])[0];
		let after = (endLine.slice(endCursor.ch).match(reg_after) || [""])[0];

		let sel = {
			from: { line: startCursor.line, ch: startCursor.ch - before.length },
			to: { line: endCursor.line, ch: endCursor.ch + after.length },
		} satisfies Range

		if (trim) sel = this.trimSmartSelection(sel);
		return sel as Range;
	}

	applyStyle(sel: Range, op: ValidOperations, isSelection: boolean) {
		const prefix = this.styleConfig[op].start;
		const suffix = this.styleConfig[op].end;

		if (isSelection) {
			const selVal = this.editor.getSelection();
			this.editor.setSelection(sel.from, sel.to);
			this.editor.replaceSelection(prefix + selVal + suffix);
		} else {
			const selVal = this.editor.getRange(sel.from, sel.to)
			this.editor.replaceRange(prefix + selVal + suffix, sel.from, sel.to);
		}
	}

	removeStyle(sel: Range, wrappedWith: ValidOperations, isSelection: boolean) {
		const prefix = this.styleConfig[wrappedWith].start;
		const suffix = this.styleConfig[wrappedWith].end;

		if (isSelection) {
			const selVal = this.editor.getSelection();
			this.editor.setSelection(sel.from, sel.to);
			this.editor.replaceSelection(selVal.replace(prefix, "").replace(suffix, ""));
		} else {
			const selVal = this.editor.getRange(sel.from, sel.to)
			this.editor.replaceRange(selVal.replace(prefix, "").replace(suffix, ""), sel.from, sel.to);
		}
	}
}

