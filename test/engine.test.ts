import type { EditorPosition, Editor } from 'obsidian';
import { test } from 'node:test';
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

test('single line transformation', () => {
	const mockEditor = new MockEditor(`hello world\nthis is a test\nmultiline`);

	const transformer = new TextTransformer();
	transformer.setEditor(mockEditor as unknown as Editor);

	mockEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 }); // "hello"
	transformer.transformText('bold');

	// Verify transformation result
	const expectedText = `**hello** world\nthis is a test\nmultiline`;
	const expectedSelection = { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 7 } };

	assert.strictEqual(mockEditor.getEditorContent(), expectedText);
	assert.deepStrictEqual(mockEditor.listSelections(), [expectedSelection])
});

test('multi line transformation', () => {
	const mockEditor = new MockEditor(`hello world\nthis is a test\nmultiline`);

	const transformer = new TextTransformer();
	transformer.setEditor(mockEditor as unknown as Editor);

	mockEditor.setSelection({ line: 0, ch: 1 }, { line: 1, ch: 4 }); // "ello world" & "this"
	transformer.transformText('bold');

	// Verify transformation result
	const expectedText = `**hello world**\n**this** is a test\nmultiline`;
	const expectedSelection = { anchor: { line: 0, ch: 2 }, head: { line: 1, ch: 6 } };

	assert.strictEqual(mockEditor.getEditorContent(), expectedText);
	assert.deepStrictEqual(mockEditor.listSelections(), [expectedSelection])
});