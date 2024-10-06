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

const styleConfig: Record<ValidOperations, StyleConfig> = {
	bold: { start: '**', end: '**' },
	highlight: { start: '==', end: '==' },
	italics: { start: '*', end: '*' },
	inlineCode: { start: '`', end: '`' },
	comment: { start: '%%', end: '%%' },
	strikethrough: { start: '~~', end: '~~' },
	underscore: { start: '<u>', end: '</u>' },
	// inlineMath: { start: '$', end: '$' },
};

const debug = true;

// for now, you have to manually update these
const reg_marker_bare = "\\*|(?:==)|`|(?:%%)|(?:~~)|<u>|<\\/u>" // markers
const reg_char = `([a-zA-Z0-9]|${reg_marker_bare}|\\(|\\))`; // characters considered word

const reg_before = new RegExp(`${reg_char}*$`);
const reg_after = new RegExp(`^${reg_char}*`);
const reg_marker_before = new RegExp(`(${reg_marker_bare})*$`);
const reg_marker_after = new RegExp(`^(${reg_marker_bare})*`);

function escapeRegExp(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export class TextTransformer {
	editor: Editor;
	/** dynamically created array of regexes to trim from the start of our selection */
	trimBeforeRegexes: RegExp[] = [];
	/** dynamically created array of regexes to trim from the end of our selection */
	trimAfterRegexes: RegExp[] = [];

	// if we trim in trimSmartSelection, we need to accout for that
	// when restoring the selection position, so restored selection looks proper
	trimmedBeforeLength: number = 0;
	trimmedAfterLength: number = 0;

	/** if we're currently handling a multi-selection */
	multiSelection: boolean = false;
	
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

	swapCursorsIfNeeded(from: EditorPosition, to: EditorPosition) {
		// selection was started from the back - reverse it
		if (from.line > to.line || from.line === to.line && from.ch > to.ch) {
			const tmp = from;
			from = to;
			to = tmp;
		}
		return { from, to } satisfies Range as Range;
	}

	/** main function to transform text */
	transformText(op: ValidOperations, toggle = true) {
		// get & copy all selections for multi-cursor/multi-selection operations
		const selections = this.editor.listSelections().map(_sel => {
			let sel = {
				from: { line: _sel.anchor.line, ch: _sel.anchor.ch },
				to: { line: _sel.head.line, ch: _sel.head.ch },
			};

			// selection was started from the back - reverse it
			const { from, to } = this.swapCursorsIfNeeded(sel.from, sel.to);
			sel.from = from;
			sel.to = to;
			return sel
		});

		for (const sel of selections) {
			// remember original line lengths, so we can adjust the following selections
			const originalFromLineLength = this.editor.getLine(sel.from.line).length;
			const originalToLineLength = this.editor.getLine(sel.to.line).length;

			const checkSel = this.getSmartSelection(sel, false);
			const smartSel = this.getSmartSelection(sel);
			const selection = this.editor.getRange(sel.from, sel.to);
			const isSelection = !!selection && selection.length > 0;
	
			// console.log("processing:", sel, 
			// 	"value:", selection, smartSel, 
			// 	"smartSelVal:", this.editor.getRange(smartSel.from, smartSel.to)
			// );
	
			this.trimmedBeforeLength = 0;
			this.trimmedAfterLength = 0;
			
			let stylesRemoved = false;
			if (this.insideStyle(checkSel, op) !== false) {
				this.removeStyle(sel, checkSel, op, isSelection);
				// console.log("removing styles: checkSel");
				stylesRemoved = true;
			} 
			if (this.insideStyle(smartSel, op) !== false) {
				this.removeStyle(sel, smartSel, op, isSelection);
				// console.log("removing styles: trimmedSel");
				stylesRemoved = true;
			}
	
			// don't apply the style if we're only toggling and we just removed the style
			if (!toggle || toggle && !stylesRemoved) {
				const smartSel = this.getSmartSelection(sel, true);
				// console.log("applying styles: " + op);
				this.applyStyle(sel, smartSel, op, isSelection)
			}

			// adjust cursor offsets if they're on the same line
			for (const sel2 of selections) {
				this.updateSelectionOffsets(sel, sel2, sel.to, originalFromLineLength, originalToLineLength);
			}
		}
	}

	/** Update remaining selections after a style has been applied or removed, accounting for length changes */
	updateSelectionOffsets(currentSel: Range, adjustSel: Range, modifiedTo: EditorPosition, originalFromLineLength: number, originalToLineLength: number) {
		// if either the starting line or the ending line was modified, adjust the selection

		if (adjustSel.from.line === currentSel.from.line) { // the 'from' line was modified, adjust it
			const newLineLength = this.editor.getLine(adjustSel.from.line).length;
			const diff = newLineLength - originalFromLineLength;
			adjustSel.from.ch += diff;
		}
		 if (adjustSel.to.line === currentSel.to.line) { // the 'to' line was modified, adjust it
			const newLineLength = this.editor.getLine(adjustSel.to.line).length;
			const diff = newLineLength - originalToLineLength;
			adjustSel.to.ch += diff;
		}
	}
	
	/** check if the selection is inside a style (all known styles) */
	// isInsideAnyStyle(sel: Range) {
	// 	let wrappedWith: ValidOperations | false = false;
	// 	const start = this.editor.getLine(sel.from.line).slice(0, sel.from.ch);
	// 	const end = this.editor.getLine(sel.to.line).slice(sel.to.ch);

	// 	for (const opkey in styleConfig) {
	// 		const operation = styleConfig[opkey as ValidOperations];
	// 		if (start.startsWith(operation.start) && end.endsWith(operation.end)) {
	// 			wrappedWith = opkey as ValidOperations;
	// 			break;
	// 		}
	// 	}
	// 	return wrappedWith;
	// }

	insideStyle(sel: Range, op: ValidOperations) {
		const value = this.editor.getRange(sel.from, sel.to);
		return value.startsWith(styleConfig[op].start) && value.endsWith(styleConfig[op].end);
	}

	/** get the Range of the smart selection created by expanding the current one / from cursor*/
	getSmartSelection(sel: Range, trim = true) {
		const selection = this.editor.getRange(sel.from, sel.to);
		if (selection && selection.length > 0) {
			return this.getSmartSelectionRange(sel,trim);
		} else {
			return this.getSmartSelectionBare(sel, trim);
		}
	}

	/** trim the selection (Range) to not include stuff we don't want */
	trimSmartSelection(sel: Range) {
		let from = sel.from;
		let to = sel.to;

		const startLine = this.editor.getLine(sel.from.line);
		const endLine = this.editor.getLine(sel.to.line);
		// console.log("before trimming:", `'${this.editor.getRange(from, to)}'`);

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
		// console.log("after trimming", `'${this.editor.getRange(from, to)}'`);
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
	getSmartSelectionBare(original: Range, trim: boolean) {
		const cursor = original.to;
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
	getSmartSelectionRange(original: Range, trim: boolean) {
		const { from, to } = this.swapCursorsIfNeeded(original.from, original.to);
		let startCursor = from;
		let endCursor = to;
		
		// chunks of selection before the start cursor & after the end cursor, string value
		const startLine = this.editor.getLine(startCursor.line);
		const endLine = this.editor.getLine(endCursor.line);

		// 1. grow selection by markers
		const before_markers = (startLine.slice(0, startCursor.ch).match(reg_marker_before) || [""])[0];
		const after_markers = (endLine.slice(endCursor.ch).match(reg_marker_after) || [""])[0];
		startCursor.ch -= before_markers.length;
		endCursor.ch += after_markers.length;
		
		// 2. trim whitespace ('fix up selection')
		const corrected = this.whitespacePretrim({ from: startCursor, to: endCursor });
		startCursor = corrected.from;
		endCursor = corrected.to;
		
		// 3. grow selection by words (including markers)
		const before = (startLine.slice(0, startCursor.ch).match(reg_before) || [""])[0];
		const after = (endLine.slice(endCursor.ch).match(reg_after) || [""])[0];

		// console.log(startLine.slice(0, startCursor.ch).match(reg_before), endLine.slice(endCursor.ch).match(reg_after))
		// if (debug) console.log(startCursor, endCursor, `b: '${before}'`, `a: '${after}'`);

		let sel = {
			from: { line: startCursor.line, ch: startCursor.ch - before.length},
			to: { line: endCursor.line, ch: endCursor.ch + after.length },
		} satisfies Range
		
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
	calculateOffsets(modification: 'apply' | 'remove', prefix: string, suffix: string, customBase?: number) {
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
	#modifySelection(original: Range, smartSel: Range, op: ValidOperations, modification: 'apply' | 'remove', isSelection: boolean) {
		// "fix" user's selection lmao (remove whitespaces) so it doesen't look goofy afterwards
		const sel2 = this.whitespacePretrim(original);

		const prefix = styleConfig[op].start;
		const suffix = styleConfig[op].end;

		// used when restoring previous cursor / selection position
		// account for any whitespace we trimmed in cursor position
		const offsets = this.calculateOffsets(modification, prefix, suffix);

		if (isSelection) {
			const originalSel = this.editor.getRange(sel2.from, sel2.to);
			this.editor.setSelection(smartSel.from, smartSel.to); // set to expanded selection
			const selVal = this.editor.getSelection(); // get new content

			const newVal = modification === 'apply'
				? prefix + selVal + suffix // add style
				: selVal // remove style
					.replace(new RegExp("^" + escapeRegExp(prefix)), "")
					.replace(new RegExp(escapeRegExp(suffix) + "$"), "");

			console.log(modification, prefix, suffix, originalSel, selVal, newVal);

			this.editor.replaceSelection(newVal); // replace the actual string in the editor
			
			// cleanly restore a 'remove' selection like |**bold**| to |bold|
			if (originalSel === selVal && modification === 'remove') {
				const offsets2 = this.calculateOffsets(modification, prefix, suffix, 0);
				offsets2.post -= suffix.length;

				// if the whole selection is on the same line, and we selected |**bold**|, shorten 'to' by both prefix and suffix
				if (smartSel.from.line === smartSel.to.line) offsets2.post -= prefix.length;
				Object.assign(offsets, offsets2);
			}
			console.log(sel2.from, sel2.to, offsets)

			// where should the new selection be?
			const restoreSel = {
				from: this.offsetCursor(sel2.from, offsets.pre),
				to: this.offsetCursor(sel2.to, offsets.post),
			}

			this.editor.setSelection(restoreSel.from, restoreSel.to); 

		} else {
			const cursor = sel2.to; // save cursor
			const selVal = this.editor.getRange(smartSel.from, smartSel.to)

			const newVal = modification === 'apply'
				? prefix + selVal + suffix
				: selVal.replace(prefix, "").replace(suffix, "");
			this.editor.replaceRange(newVal, smartSel.from, smartSel.to);

			this.editor.setCursor(this.offsetCursor(cursor, offsets.pre)); // restore cursor (offset by prefix)
		}
	}

	applyStyle(sel: Range, smartSel: Range, op: ValidOperations, isSelection: boolean) {
		this.#modifySelection(sel, smartSel, op, 'apply', isSelection);
	}

	removeStyle(sel: Range, smartSel: Range, wrappedWith: ValidOperations, isSelection: boolean) {
		this.#modifySelection(sel, smartSel, wrappedWith, 'remove', isSelection);
	}
}