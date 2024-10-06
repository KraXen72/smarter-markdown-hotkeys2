import type { ValidOperations } from "./main";
import { Editor, EditorPosition } from "obsidian";


interface StyleConfig {
	start: string;
	end: string;
}

interface Range {
	from: EditorPosition;
	to: EditorPosition;
}

const trimBefore = [
	"###### ",
	"##### ",
	"#### ",
	"### ",
	"## ",
	"# ",
	"- [ ] ",
	"- [x] ",
	"- ",
	'"',
	// "(",
	"[",
	">",
];

// ]( to not break markdown links
// :: preseve dataview inline fields
const trimAfter = [
	'"', 
	// ")", 
	"](", 
	"::", 
	"]"
];

// for now, you have to manually update these
const reg_char = "([a-zA-Z0-9]|\\*|(?:==)|`|(?:%%)|(?:~~)|\\(|\\))"; // characters considered word
const reg_before = new RegExp(reg_char + "*$");
const reg_after = new RegExp("^" + reg_char + "*");

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
		underscore: { start: '<u>', end: '</u>' },
		inlineMath: { start: '$', end: '$' },
	};
	/** dynamically created array of regexes to trim from the start of our selection */
	trimBeforeRegexes: RegExp[] = [];
	/** dynamically created array of regexes to trim from the end of our selection */
	trimAfterRegexes: RegExp[] = [];

	// if we trim in trimSmartSelection, we need to accout for that
	// when restoring the selection position, so restored selection looks proper
	trimmedBeforeLength: number = 0;
	trimmedAfterLength: number = 0;
	
	constructor() {
		// the order of the regexes matters, since longer ones should be checked first (- [ ] before -)
		this.trimBeforeRegexes = trimBefore.map(x => new RegExp("^" + escapeRegExp(x)));
		this.trimBeforeRegexes.splice(8, 0, /- \[\S\] /); // checked & custom checked checkboxes
		this.trimBeforeRegexes.splice(6, 0, /> \[!\w+\] /); // callouts 
		// console.log(reg_before, reg_after)
		// console.log(this.trimBeforeRegexes);

		this.trimAfterRegexes = trimAfter.map(x => new RegExp(escapeRegExp(x) + "$"));
	}

	setEditor(editor: Editor) {
		this.editor = editor;
	}

	/** main function to transform text */
	transformText(op: ValidOperations, toggle = true) {
		const trimmedSel = this.getSmartSelection();
		const checkSel = this.getSmartSelection(false);
		const selection = this.editor.getSelection();
		const isSelection = !!selection && selection.length > 0;

		this.trimmedBeforeLength = 0;
		this.trimmedAfterLength = 0;

		let stylesRemoved = false;
		if (this.insideStyle(checkSel, op) !== false) {
			this.removeStyle(checkSel, op, isSelection);
			console.log("removing styles: checkSel");
			stylesRemoved = true;
		} 
		if (this.insideStyle(trimmedSel, op) !== false) {
			this.removeStyle(trimmedSel, op, isSelection);
			console.log("removing styles: trimmedSel");
			stylesRemoved = true;
		}

		// don't apply the style if we're only toggling and we just removed the style
		if (!toggle || toggle && !stylesRemoved) {
			const sel = this.getSmartSelection(true);
			this.applyStyle(sel, op, isSelection)
		}
	}
	
	/** check if the selection is inside a style (all known styles) */
	// isInsideAnyStyle(sel: Range) {
	// 	let wrappedWith: ValidOperations | false = false;
	// 	const start = this.editor.getLine(sel.from.line).slice(0, sel.from.ch);
	// 	const end = this.editor.getLine(sel.to.line).slice(sel.to.ch);

	// 	for (const opkey in this.styleConfig) {
	// 		const operation = this.styleConfig[opkey as ValidOperations];
	// 		if (start.startsWith(operation.start) && end.endsWith(operation.end)) {
	// 			wrappedWith = opkey as ValidOperations;
	// 			break;
	// 		}
	// 	}
	// 	return wrappedWith;
	// }

	insideStyle(sel: Range, op: ValidOperations) {
		const value = this.editor.getRange(sel.from, sel.to);
		return value.startsWith(this.styleConfig[op].start) && value.endsWith(this.styleConfig[op].end);
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

	/** trim the selection (Range) to not include stuff we don't want */
	trimSmartSelection(sel: Range) {
		let from = sel.from;
		let to = sel.to;

		const startLine = this.editor.getLine(sel.from.line);
		const endLine = this.editor.getLine(sel.to.line);
		// console.log("before", this.editor.getRange(from, to));

		for (const regex of this.trimBeforeRegexes) {
			const match = startLine.slice(
				from.ch, 
				from.line === to.line ? to.ch : startLine.length
			).match(regex);
			
			if (match) {
				from.ch = from.ch + match[0].length;
				//  keep count of how many chars we trimmed
				this.trimmedBeforeLength += match[0].length; 
			}
		}
		for (const regex of this.trimAfterRegexes) {
			const match = endLine.slice(
				from.line === to.line ? from.ch : 0,
				to.ch, 
			).match(regex);

			if (match) {
				to.ch = to.ch - match[0].length;
				//  keep count of how many chars we trimmed
				this.trimmedAfterLength += match[0].length;
			}
		}
		// console.log("after", this.editor.getRange(from, to));
		return { from, to } satisfies Range as Range;
	}
	
	/** trim a selection (string) to not include stuff we don't want */
	trimNormalSelection(sel: string) {
		let sel2 = sel;
		for (const regex of this.trimBeforeRegexes) {
			sel2 = sel2.replace(regex, "");
		}
		for (const regex of this.trimAfterRegexes) {
			sel2 = sel2.replace(regex, "");
		}
		return sel2
	}

	// pre-trim whitespace (correct selection lmao)
	whitespacePretrim(sel: Range) {
		const selection = this.trimNormalSelection(this.editor.getRange(sel.from, sel.to));
		const whitespaceBefore = (selection.match(/^\s+/) || [""])[0];
		const whitespaceAfter = (selection.match(/\s+$/) || [""])[0];

		return {
			from: { line: sel.from.line, ch: sel.from.ch + whitespaceBefore.length },
			to: { line: sel.to.line, ch: sel.to.ch - whitespaceAfter.length },
		} satisfies Range as Range;
	}

	/** get the Range of the smart selection created by expanding from cursor*/
	getSmartSelectionBare(trim: boolean) {
		const cursor = this.editor.getCursor("anchor");
		const lineText = this.editor.getLine(cursor.line);

		// chunks of selection before & after cursor, string value
		const before = (lineText.slice(0, cursor.ch).match(reg_before) || [""])[0];
		const after = (lineText.slice(cursor.ch).match(reg_after) || [""])[0];
		
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
		let startCursor = this.editor.getCursor("from");
		let endCursor = this.editor.getCursor("to");
		
		// chunks of selection before the start cursor & after the end cursor, string value
		const startLine = this.editor.getLine(startCursor.line);
		const endLine = this.editor.getLine(endCursor.line);

		// pre-trim whitespace (fix up selection)
		const corrected = this.whitespacePretrim({ from: startCursor, to: endCursor });
		startCursor = corrected.from;
		endCursor = corrected.to;
		
		// find parts where the selection should be expanded to
		const before = (startLine.slice(0, startCursor.ch).match(reg_before) || [""])[0];
		const after = (endLine.slice(endCursor.ch).match(reg_after) || [""])[0];

		let sel = {
			from: { line: startCursor.line, ch: startCursor.ch - before.length},
			to: { line: endCursor.line, ch: endCursor.ch + after.length },
		} satisfies Range

		// post-trim
		// trim selection of any whitespace on the start & end
		const selection2 = this.editor.getRange(sel.from, sel.to);
		const post_whitespaceBefore = (selection2.match(/^\s+/) || [""])[0];
		const post_whitespaceAfter = (selection2.match(/\s+$/) || [""])[0];
		sel.from.ch += post_whitespaceBefore.length;
		sel.to.ch -= post_whitespaceAfter.length;
		
		// trim selection of stuff we don't want, if trim is true
		if (trim) sel = this.trimSmartSelection(sel);
		return sel as Range;
	}

	/** get an offset cursor */
	offsetCursor(cursor: EditorPosition, offset: number) {
		const offsetValue = cursor.ch + offset;
		if (offsetValue < 0) return { line: cursor.line, ch: 0 };
		if (offsetValue > this.editor.getLine(cursor.line).length) return { line: cursor.line, ch: this.editor.getLine(cursor.line).length };
		return { line: cursor.line, ch: offsetValue };
	}

	/** calculate the offset when restoring the cursor / selection */
	calculateOffsets(sel: Range, modification: 'apply' | 'remove', prefix: string, suffix: string, customBase?: number) {
		// usually, we want the offset to be prefix/suffix, but for some special cases we might want to provide a custom base
		let pre = customBase ?? prefix.length;
		let post = customBase ?? suffix.length;

		if (modification === 'remove') {
			pre = pre * -1;
			post = post * -1;
		}
		pre -= this.trimmedBeforeLength;
		post += this.trimmedAfterLength;
		return { pre, post };
	}

	/** either apply or remove a style */
	#modifySelection(sel: Range, op: ValidOperations, modification: 'apply' | 'remove', isSelection: boolean) {
		const prefix = this.styleConfig[op].start;
		const suffix = this.styleConfig[op].end;

		// used when restoring previous cursor / selection position
		// account for any whitespace we trimmed in cursor position
		const offsets = this.calculateOffsets(sel, modification, prefix, suffix);

		if (isSelection) {
			// "fix" user's selection lmao (remove whitespaces) so it doesen't look goofy afterwards
			const selection: Range = this.whitespacePretrim({ 
				from: this.editor.getCursor('from'), 
				to: this.editor.getCursor('to') 
			});

			const originalSel = this.editor.getSelection();
			this.editor.setSelection(sel.from, sel.to); // set to expanded selection
			const selVal = this.editor.getSelection(); // get new content

			const newVal = modification === 'apply'
				? prefix + selVal + suffix // add style
				: selVal // remove style
					.replace(new RegExp("^" + escapeRegExp(suffix)), "")
					.replace(new RegExp(escapeRegExp(prefix) + "$"), "");

			this.editor.replaceSelection(newVal); // replace the actual string in the editor
			
			// cleanly restore a 'remove' selection like |**bold**| to |bold|
			if (originalSel === selVal && modification === 'remove') {
				const offsets2 = this.calculateOffsets(sel, modification, prefix, suffix, 0);
				offsets2.post -= (prefix.length + suffix.length);
				Object.assign(offsets, offsets2);
			}

			// where should the new selection be?
			const restoreSel = {
				from: this.offsetCursor(selection.from, offsets.pre),
				to: this.offsetCursor(selection.to, offsets.post),
			}

			this.editor.setSelection(restoreSel.from, restoreSel.to); 

		} else {
			const cursor = this.editor.getCursor("anchor"); // save cursor
			const selVal = this.editor.getRange(sel.from, sel.to)

			const newVal = modification === 'apply'
				? prefix + selVal + suffix
				: selVal.replace(prefix, "").replace(suffix, "");
			this.editor.replaceRange(newVal, sel.from, sel.to);

			this.editor.setCursor(this.offsetCursor(cursor, offsets.pre)); // restore cursor (offset by prefix)
		}
	}

	applyStyle(sel: Range, op: ValidOperations, isSelection: boolean) {
		this.#modifySelection(sel, op, 'apply', isSelection);
	}

	removeStyle(sel: Range, wrappedWith: ValidOperations, isSelection: boolean) {
		this.#modifySelection(sel, wrappedWith, 'remove', isSelection);
	}
}
