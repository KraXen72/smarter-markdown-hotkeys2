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

	listSelections() { return this.selections; }
	setSelection(from: EditorPosition, to: EditorPosition) {
		this.selections = [{ anchor: from, head: to }];
	}
	getLine(lineNo: number) {
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

// describe('TextTransformer', () => {
// 	// Create a single transformer instance to be used across all tests
// 	const transformer = new TextTransformer();

// 	// Helper function to setup test with shared transformer
// 	function setupTest(content: string) {
// 			const mockEditor = new MockEditor(content);
// 			transformer.setEditor(mockEditor as unknown as Editor);
// 			return mockEditor;
// 	}

// 	describe('Bare Cursor Operations', () => {
// 			it('should handle cursor between style markers', () => {
// 					const editor = setupTest("word **** text");
// 					editor.setSelection({ line: 0, ch: 7 }, { line: 0, ch: 7 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "word  text");
// 			});

// 			it('should expand cursor inside word', () => {
// 					const editor = setupTest("wo|rd");
// 					editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 2 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "**word**");
// 			});

// 			it('should expand cursor at word boundary with space after', () => {
// 					const editor = setupTest("word| another");
// 					editor.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 4 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "**word** another");
// 			});

// 			it('should expand cursor at word boundary with space before', () => {
// 					const editor = setupTest("word |another");
// 					editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 5 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "word **another**");
// 			});

// 			it('should create empty style when cursor between spaces', () => {
// 					const editor = setupTest("word  ");
// 					editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 5 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "word **|**");
// 			});
// 	});

// 	describe('Selection Operations', () => {
// 			it('should handle pure non-whitespace chunk selection', () => {
// 					const editor = setupTest("hello there");
// 					editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 7 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "he**llo th**ere");
// 			});

// 			it('should expand selection inside non-whitespace to word boundaries', () => {
// 					const editor = setupTest("extraterrestrial");
// 					editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 9 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "**extraterrestrial**");
// 			});

// 			it('should trim whitespace from selection ends', () => {
// 					const editor = setupTest("   hello there   ");
// 					editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 16 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "   **hello there**   ");
// 			});

// 			it('should keep pure whitespace selection unchanged', () => {
// 					const editor = setupTest("word    word");
// 					editor.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 8 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "word    word");
// 			});
// 	});

// 	describe('Multi-line Operations', () => {
// 			it('should handle multi-line selection with proper trimming', () => {
// 					const editor = setupTest("first line\nsecond line\nthird line");
// 					editor.setSelection(
// 							{ line: 0, ch: 6 },
// 							{ line: 2, ch: 5 }
// 					);
// 					transformer.transformText('bold');
// 					assert.equal(
// 							editor.getEditorContent(),
// 							"first **line\nsecond line\nthird** line"
// 					);
// 			});

// 			it('should handle bullet points and checkboxes', () => {
// 					const editor = setupTest("- [ ] first item\n- [x] second item");
// 					editor.setSelection(
// 							{ line: 0, ch: 0 },
// 							{ line: 1, ch: 18 }
// 					);
// 					transformer.transformText('bold');
// 					assert.equal(
// 							editor.getEditorContent(),
// 							"- [ ] **first item**\n- [x] **second item**"
// 					);
// 			});
// 	});

// 	describe('Style Removal', () => {
// 			it('should remove style when selection matches exactly', () => {
// 					const editor = setupTest("**hello** there");
// 					editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 8 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "hello there");
// 			});

// 			it('should handle nested styles', () => {
// 					const editor = setupTest("**hello ==world==**");
// 					editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 17 });
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "hello ==world==");
// 			});
// 	});

// 	describe('Edge Cases', () => {
// 			it('should handle empty lines', () => {
// 					const editor = setupTest("\n\ntext\n\n");
// 					editor.setSelection(
// 							{ line: 0, ch: 0 },
// 							{ line: 4, ch: 0 }
// 					);
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "\n\n**text**\n\n");
// 			});

// 			it('should handle special markdown syntax', () => {
// 					const editor = setupTest("> [!note] Some text");
// 					editor.setSelection(
// 							{ line: 0, ch: 0 },
// 							{ line: 0, ch: 17 }
// 					);
// 					transformer.transformText('bold');
// 					assert.equal(editor.getEditorContent(), "> [!note] **Some text**");
// 			});
// 	});
// });