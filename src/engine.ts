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


// for now, you have to manually update these
const reg_marker_bare = "\\*|(?:==)|`|(?:%%)|(?:~~)|<u>|<\\/u>" // markers
const reg_char = `([a-zA-Z0-9]|${reg_marker_bare}|\\(|\\))`; // characters considered word

const reg_before = new RegExp(`${reg_char}*$`);
const reg_after = new RegExp(`^${reg_char}*`);
const reg_marker_before = new RegExp(`(${reg_marker_bare})+$`);
const reg_marker_after = new RegExp(`^(${reg_marker_bare})+`);

function escapeRegExp(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export class TextTransformer {
	/** dynamically created array of regexes to trim from the start of our selection */
	trimBeforeRegexes: RegExp[] = [];
	/** dynamically created array of regexes to trim from the end of our selection */
	trimAfterRegexes: RegExp[] = [];
	
	// state:
	editor: Editor;
	// if we trim in trimSmartSelection, we need to accout for that
	// when restoring the selection position, so restored selection looks proper
	trimmedBeforeLength: number = 0;
	trimmedAfterLength: number = 0;

	/** regex to get markers (only this operation type) before a selection */
	startMarkerRegex: RegExp;
	/** regex to get markers (only this operation type) after a selection */
	endMarkerRegex: RegExp;
	
	constructor() {
		// the order of the regexes matters, since longer ones should be checked first (- [ ] before -)
		this.trimBeforeRegexes = trimBefore.map(x => new RegExp("^" + escapeRegExp(x)));
		this.trimBeforeRegexes.splice(8, 0, /- \[\S\] /); // checked & custom checked checkboxes
		this.trimBeforeRegexes.splice(6, 0, /> \[!\w+\] /); // callouts 
		console.log(this.trimBeforeRegexes);
		// console.log(reg_before, reg_after)

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
			const { from, to } = this.swapCursorsIfNeeded(
				{ line: _sel.anchor.line, ch: _sel.anchor.ch }, 
				{ line: _sel.head.line, ch: _sel.head.ch }
			);
			return { from: {...from}, to: {...to} } satisfies Range as Range;
		});
		console.log(selections)

		for (let i = 0; i < selections.length; i++) {
			const sel = selections[i];
			this.trimmedBeforeLength = 0;
			this.trimmedAfterLength = 0;
			this.startMarkerRegex = new RegExp(`^${escapeRegExp(styleConfig[op].start)}*`);
			this.endMarkerRegex = new RegExp(`${escapeRegExp(styleConfig[op].end)}*$`);

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
	
			// try removing styles first
			let stylesRemoved = false;
			if (this.insideStyle(checkSel, op) !== false) {
				this.removeStyle(sel, checkSel, op, isSelection);
				stylesRemoved = true;
			} 
			if (this.insideStyle(smartSel, op) !== false) {
				this.removeStyle(sel, smartSel, op, isSelection);
				stylesRemoved = true;
			}
	
			// don't apply the style if we're only toggling and we just removed the style
			if (!toggle || toggle && !stylesRemoved) {
				const smartSel = this.getSmartSelection(sel, true);
				this.applyStyle(sel, smartSel, op, isSelection)
			}

			// adjust cursor positions if they're on the same line
			for (let j = i + 1; j < selections.length; j++) {
				const sel2 = selections[j];
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
				this.trimmedBeforeLength += match[0].length; // keep count of how many chars we trimmed
			}
		}
		for (const regex of this.trimAfterRegexes) {
			const match = endLine.slice(
				from.line === to.line ? from.ch : 0,
				to.ch, 
			).match(regex);

			if (match) {
				to.ch = to.ch - match[0].length;
				this.trimmedAfterLength += match[0].length; // keep count of how many chars we trimmed
			}
		}
		// console.log("after trimming", `'${this.editor.getRange(from, to)}'`);
		return { from, to } satisfies Range as Range;
	}

	/** 
	 * get 3 parts of a string: 
	 * - stuff that would be trimmed before
	 * - the actual selection
	 * - stuff that would be trimmed after
	 * 
	 * used when applying/removing a style on multiple lines
	 */
	#trimStringWithParts(sel: string, trimWhitespace = true) {
		let sel2 = sel;
		let trimmedBefore = "";
		let trimmedAfter = "";

		// if we are trimming whitespace, we need to add whitespace trimming regexes
		const preTrimRegexes = [...this.trimBeforeRegexes]
		const postTrimRegexes = [...this.trimAfterRegexes]
		if (trimWhitespace) {
			preTrimRegexes.splice(0, 0, new RegExp("^\\s+"));
			postTrimRegexes.splice(0, 0, new RegExp("\\s+$"));
		}

		for (const regex of preTrimRegexes) { // trim before & remember
			const match = sel2.match(regex);
			if (match) trimmedBefore += match[0];
			sel2 = sel2.replace(regex, "");
		}

		for (const regex of postTrimRegexes) { // trim after & remember
			const match = sel2.match(regex);
			if (match) trimmedAfter += match[0];
			sel2 = sel2.replace(regex, "");
		}

		return { trimmedBefore, result: sel2, trimmedAfter };
	}
	
	/** trim a selection (string) to not include stuff we don't want */
	trimString(sel: string) {
		return this.#trimStringWithParts(sel, false).result;
	}

	// pre-trim whitespace (correct selection lmao)
	whitespacePretrim(sel: Range) {
		const selection = this.trimString(this.editor.getRange(sel.from, sel.to));
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
		const { from, to } = this.swapCursorsIfNeeded({...original.from}, {...original.to});
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
		if (offsetValue > this.editor.getLine(cursor.line).length) {
			return { line: cursor.line, ch: this.editor.getLine(cursor.line).length }
		};
		return { line: cursor.line, ch: offsetValue };
	}

	/** calculate the offset when restoring the cursor / selection */
	calculateOffsets(sel: Range, modification: 'apply' | 'remove', prefix: string, suffix: string) {
		const selection = this.editor.getRange(sel.from, sel.to)

		const multiline = sel.from.line !== sel.to.line;
		const includesMarkersStart = this.startMarkerRegex.test(selection)
		const includesMarkersEnd = this.endMarkerRegex.test(selection);
		const modifMultiplier = modification === 'remove' ? -1 : 1;
		
		let pre = 0;
		let post = 0;
		
		// see rules for restoring cursor position in my obsidian note for this plugin
		if (!includesMarkersStart && !includesMarkersEnd) {
			pre = prefix.length * modifMultiplier;
			post = prefix.length * modifMultiplier;
		} else {
			if (includesMarkersStart && includesMarkersEnd) { // both markers included in selection
				post = multiline ? -suffix.length : -(suffix.length + prefix.length)
			} else if (includesMarkersStart && !includesMarkersEnd) { // only start (left) marker included in selection
				post = multiline ? 0 : -prefix.length;
			} else if (!includesMarkersStart && includesMarkersEnd) { // only end (right) marker included in selection
				pre = prefix.length * modifMultiplier;
				post = multiline ? -suffix.length : -(suffix.length + prefix.length)
			}
		}

		console.table({
			selection, pre,post,
			includesMarkersStart, includesMarkersEnd,
			multiline,
			bl: this.trimmedBeforeLength,
			al: this.trimmedAfterLength,
		});

		pre -= this.trimmedBeforeLength;
		post += this.trimmedAfterLength;
		return { pre, post };
	}

	/** either add apply or remove a style for a given string */
	#modifyLine(selVal: string, prefix: string, suffix: string, modification: 'apply' | 'remove', trim = false) {
		const { trimmedBefore, result, trimmedAfter } = this.#trimStringWithParts(selVal);
		if (trim) selVal = result;

		let newVal = modification === 'apply'
			? prefix + selVal + suffix // add style
			: selVal
				.replace(new RegExp("^" + escapeRegExp(prefix)), "")
				.replace(new RegExp(escapeRegExp(suffix) + "$"), "");
			
		if (trim) newVal = trimmedBefore + newVal + trimmedAfter;
		return newVal;
	}

	/** either apply or remove a style for a given Range */
	#modifySelection(original: Range, smartSel: Range, op: ValidOperations, modification: 'apply' | 'remove', isSelection: boolean) {
		// "fix" user's selection lmao (remove whitespaces) so it doesen't look goofy afterwards
		const sel2 = this.whitespacePretrim(original);
		console.log("modify - original:", this.editor.getRange(original.from, original.to))
		console.log("modify - posttrim:", this.editor.getRange(sel2.from, sel2.to))

		const prefix = styleConfig[op].start;
		const suffix = styleConfig[op].end;

		// used when restoring previous cursor / selection position
		// account for any whitespace we trimmed in cursor position
		const offsets = this.calculateOffsets(sel2, modification, prefix, suffix);

		if (isSelection) {
			this.editor.setSelection(smartSel.from, smartSel.to); // set to expanded selection
			const selVal = this.editor.getSelection(); // get new content
			const multiline = sel2.from.line !== sel2.to.line;

			const newVal = multiline
				? selVal.split("\n").map(line => this.#modifyLine(line, prefix, suffix, modification, true)).join("\n")
				: this.#modifyLine(selVal, prefix, suffix, modification);

			this.editor.replaceSelection(newVal); // replace the actual string in the editor

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