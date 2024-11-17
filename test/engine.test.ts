import type { EditorPosition, Editor } from 'obsidian';
import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { TextTransformer } from '../src/engine';

class MockEditor {
	selections: { anchor: EditorPosition; head: EditorPosition }[] = [];
	editorContent: string[] = [];

	constructor(initialText: string, initialSelections?: { anchor: EditorPosition; head: EditorPosition }[]) {
		this.editorContent = initialText.split('\n');
		if (initialSelections) this.selections = initialSelections;
	}
	private getLinesRange(from: EditorPosition, to: EditorPosition): string[] {
		return this.editorContent.slice(from.line, to.line + 1);
	}
	private rebuildContent(before: string[], replacement: string[], after: string[]) {
		this.editorContent = [...before, ...replacement, ...after];
	}

	listSelections() { return this.selections; }
	setSelection(from: EditorPosition, to: EditorPosition) {
		this.selections = [{ anchor: from, head: to }];
	}
	getLine(lineNo: number) {
		console.log("getting line: ", lineNo, this.editorContent)
		return this.editorContent[lineNo].toString();
	}
	getSelection() {
		if (!this.selections.length) return '';
		const { anchor, head } = this.selections[0];
		return this.getRange(anchor, head);
	}
	getRange(from: EditorPosition, to: EditorPosition) {
		if (from.line === to.line) {
			return this.editorContent[from.line].slice(from.ch, to.ch);
		}

		const start = this.editorContent[from.line].slice(from.ch);
		const middle = this.editorContent.slice(from.line + 1, to.line)
		const end = this.editorContent[to.line].slice(0, to.ch);

		return [start, middle.length > 0 ? middle : false, end].filter(Boolean).join('\n');
	}
	replaceSelection(newText: string) {
		if (!this.selections.length) return;
		const { anchor, head } = this.selections[0];

		// Handle the case where the selection spans a single line
		if (anchor.line === head.line) {
			const line = this.editorContent[anchor.line];
			const before = line.slice(0, anchor.ch); // Text before the selection
			const after = line.slice(head.ch); // Text after the selection
			this.editorContent[anchor.line] = before + newText + after;

			// Update the selection to reflect the new text's position
			const newAnchorCh = anchor.ch + newText.length;
			this.selections[0] = { anchor: { ...anchor, ch: newAnchorCh }, head: { ...head, ch: newAnchorCh } };
		} else {
			// Handle multi-line selection
			const startLine = this.editorContent[anchor.line].slice(0, anchor.ch); // Text before selection in the start line
			const endLine = this.editorContent[head.line].slice(head.ch); // Text after selection in the end line

			// Replace content between the selected lines
			this.editorContent.splice(anchor.line, head.line - anchor.line + 1, startLine + newText + endLine);

			// Update the selection based on the newText length and position
			const newAnchorCh = anchor.ch + newText.length;
			const newHeadCh = newAnchorCh; // Since we're replacing the entire selection, new `anchor` and `head` should be equal
			this.selections[0] = { anchor: { ...anchor, ch: newAnchorCh }, head: { ...head, ch: newHeadCh } };
		}
	}
	// FIXME
	replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
		if (!to) to = from;

		// Get the lines before, within, and after the range
		const before = this.editorContent.slice(0, from.line);
		const after = this.editorContent.slice(to.line + 1);
		const rangeLines = this.getLinesRange(from, to);

		// Single-line replacement
		if (from.line === to.line) {
			const line = rangeLines[0];
			const newLine =
				line.slice(0, from.ch) + replacement + line.slice(to.ch);
			this.rebuildContent(before, [newLine], after);
		} else {
			// Multi-line replacement
			const startLine = rangeLines[0].slice(0, from.ch);
			const endLine = rangeLines[rangeLines.length - 1].slice(to.ch);
			this.rebuildContent(before, [startLine + replacement + endLine], after);
		}
	}
	
	setCursor(pos: EditorPosition | number, ch?: number): void {
		let cursor: EditorPosition;

		if (typeof pos === 'number') {
			// If `pos` is a number, treat it as the line number
			if (ch === undefined) {
				throw new Error("Column (ch) must be provided when 'pos' is a number.");
			}
			cursor = { line: pos, ch: ch };
		} else {
			// If `pos` is an EditorPosition, use it directly
			cursor = pos;
		}

		// Validate line and column
		if (
			cursor.line < 0 ||
			cursor.line >= this.editorContent.length ||
			cursor.ch < 0 ||
			cursor.ch > this.editorContent[cursor.line].length
		) {
			throw new Error("Invalid cursor position");
		}

		// Set the cursor (zero-length selection)
		this.selections = [{ anchor: cursor, head: cursor }];
	}
	getEditorContent() { return this.editorContent.join('\n') }
}

const transformer = new TextTransformer();

// Helper function to setup test with shared transformer
function setupTest(content: string) {
	const mockEditor = new MockEditor(content);
	transformer.setEditor(mockEditor as unknown as Editor);
	return mockEditor;
}

describe("simple transformations & restoration of selection", () => {
	test('bold: single line transformation', () => {
		const mockEditor = setupTest(`hello world\nthis is a test\nmultiline`);
		mockEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 }); // "hello"
		transformer.transformText('bold');

		const expectedText = `**hello** world\nthis is a test\nmultiline`;
		const expectedSelection = { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 7 } };

		assert.strictEqual(mockEditor.getEditorContent(), expectedText);
		assert.deepStrictEqual(mockEditor.listSelections(), [expectedSelection])
	});

	test('bold: multi line transformation', () => {
		const mockEditor = setupTest(`hello world\nthis is a test\nmultiline`);
		mockEditor.setSelection({ line: 0, ch: 1 }, { line: 1, ch: 4 }); // "ello world" & "this"
		transformer.transformText('bold');

		const expectedText = `**hello world**\n**this** is a test\nmultiline`;
		const expectedSelection = { anchor: { line: 0, ch: 3 }, head: { line: 1, ch: 6 } };

		assert.strictEqual(mockEditor.getEditorContent(), expectedText);
		assert.deepStrictEqual(mockEditor.listSelections(), [expectedSelection])
	});
})

describe('bare cursor operations', () => {
	it('should handle cursor between style markers', () => {
		const editor = setupTest("with v1 **** monker");
		editor.setSelection({ line: 0, ch: 10 }, { line: 0, ch: 10 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "with v1  monker");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 8 }, head: { line: 0, ch: 8 } });
	});

	it('should expand cursor inside word', () => {
		const editor = setupTest("word");
		editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 2 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "**word**");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 4 } });
	});

	it('should expand cursor at word boundary with space after', () => {
		const editor = setupTest("word another");
		editor.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 4 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "**word** another");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 6 } });
	});

	it('should expand cursor at word boundary with space before', () => {
		const editor = setupTest("word another");
		editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 5 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "word **another**");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 7 }, head: { line: 0, ch: 7 } });
	});

	it('should create empty style when cursor between spaces', () => {
		const editor = setupTest("word  ");
		editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 5 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "word **** ");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 7 }, head: { line: 0, ch: 7 } });
	});
});

describe('selection operations', () => {
	it('should handle a selection inside a pure non-whitespace chunk', () => {
		const editor = setupTest("hellothere");
		editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 7 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "**hellothere**");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 9 } })
	});

	it('should properly highlight perfect selection (boundary-to-boundary)', () => {
		const editor = setupTest("monker");
		editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 6 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "**monker**");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 8 } })
	});

	it('should trim whitespace from selection ends & properly set cursor', () => {
		const editor = setupTest("   hello there  ");
		editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 16 });
		transformer.transformText('bold');
		assert.strictEqual(editor.getEditorContent(), "   **hello there**  ");
		assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 16 } })
	});

	// it('should keep pure whitespace selection unchanged', () => {
	// 	const editor = setupTest("word    word");
	// 	editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 7 });
	// 	transformer.transformText('bold');
	// 	assert.strictEqual(editor.getEditorContent(), "word    word");
	// 	assert.deepStrictEqual(editor.listSelections()[0], { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 7 } })
	// });
});

describe('Multi-line Operations', () => {
	// it('should handle multi-line (sloppy) selection', () => {
	// 	const editor = setupTest("firstTestML1 line\nsecond line\nthird line");
	// 	editor.setSelection(
	// 		{ line: 0, ch: 7 },
	// 		{ line: 2, ch: 4 }
	// 	);
	// 	transformer.transformText('bold');
	// 	assert.strictEqual(
	// 		editor.getEditorContent(),
	// 		"firstTestML1 **line\nsecond line\nthird** line"
	// 	);
	// });

	// it('should handle multi-line (precise) selection', () => {
	// 	const editor = setupTest("firstTestML2 line\nsecond line\nthird line");
	// 	editor.setSelection(
	// 		{ line: 0, ch: 6 },
	// 		{ line: 2, ch: 5 }
	// 	);
	// 	transformer.transformText('bold');
	// 	assert.strictEqual(
	// 		editor.getEditorContent(),
	// 		"firstTestML2 **line\nsecond line\nthird** line"
	// 	);
	// });

	// it('everything selected: should handle bullet points and checkboxes', () => {
	// 	const editor = setupTest("- [ ] first item\n- [x] second item");
	// 	editor.setSelection(
	// 		{ line: 0, ch: 0 },
	// 		{ line: 1, ch: 17 }
	// 	);
	// 	transformer.transformText('bold');
	// 	assert.strictEqual(
	// 		editor.getEditorContent(),
	// 		"- [ ] **first item**\n- [x] **second item**"
	// 	);
	// });
});

// describe('Style Removal', () => {
// 	it('should remove style when selection matches exactly', () => {
// 		const editor = setupTest("**hello** there");
// 		editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 8 });
// 		transformer.transformText('bold');
// 		assert.strictEqual(editor.getEditorContent(), "hello there");
// 	});

// 	it('should handle nested styles', () => {
// 		const editor = setupTest("**hello ==world==**");
// 		editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 17 });
// 		transformer.transformText('bold');
// 		assert.strictEqual(editor.getEditorContent(), "hello ==world==");
// 	});
// });

// describe('Edge Cases', () => {
// 	it('should handle empty lines', () => {
// 		const editor = setupTest("\n\ntext\n\n");
// 		editor.setSelection(
// 			{ line: 0, ch: 0 },
// 			{ line: 4, ch: 0 }
// 		);
// 		transformer.transformText('bold');
// 		assert.strictEqual(editor.getEditorContent(), "\n\n**text**\n\n");
// 	});

// 	it('should handle special markdown syntax', () => {
// 		const editor = setupTest("> [!note] Some text");
// 		editor.setSelection(
// 			{ line: 0, ch: 0 },
// 			{ line: 0, ch: 17 }
// 		);
// 		transformer.transformText('bold');
// 		assert.strictEqual(editor.getEditorContent(), "> [!note] **Some text**");
// 	});
// });