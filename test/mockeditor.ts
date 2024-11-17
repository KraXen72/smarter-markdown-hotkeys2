import { EditorPosition } from "obsidian";
import { EditorView } from "codemirror";
import { EditorState, SelectionRange } from "@codemirror/state";
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://localhost:8080' }) as any;
globalThis.window = window
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;

// WIP implementation (not working) of a fake CodeMirror editor

class MockEditor {
  private view: EditorView;

  constructor(initialText: string) {
    // Use linkedom to create a mock DOM for the plugin's testing environment
    

    // Initialize the CodeMirror instance
    this.view = new EditorView({
      state: EditorState.create({
        doc: initialText,
      }),
      parent: document.body,
    });
  }

  // Selection-related methods
  listSelections(): { anchor: EditorPosition; head: EditorPosition }[] {
    const ranges: readonly SelectionRange[] = this.view.state.selection.ranges;
    return ranges.map((range) => ({
      anchor: this.toEditorPosition(range.anchor),
      head: this.toEditorPosition(range.head),
    }));
  }

  setSelection(from: EditorPosition, to: EditorPosition): void {
    const anchor = this.toCodeMirrorPosition(from);
    const head = this.toCodeMirrorPosition(to);
    this.view.dispatch({
      selection: { anchor, head },
    });
  }

  // Content-related methods
  getEditorContent(): string {
    return this.view.state.doc.toString();
  }

  getLine(lineNo: number): string {
    const line = this.view.state.doc.line(lineNo + 1); // CodeMirror lines are 1-based
    return line.text;
  }

  getSelection(): string {
    const { from, to } = this.view.state.selection.main;
    return this.view.state.sliceDoc(from, to);
  }

  replaceSelection(newText: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: newText },
    });
  }

  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
    const fromPos = this.toCodeMirrorPosition(from);
    const toPos = to ? this.toCodeMirrorPosition(to) : fromPos;
    this.view.dispatch({
      changes: { from: fromPos, to: toPos, insert: replacement },
    });
  }

  setCursor(pos: EditorPosition | number, ch?: number): void {
    const cursor =
      typeof pos === "number"
        ? this.toCodeMirrorPosition({ line: pos, ch: ch! })
        : this.toCodeMirrorPosition(pos);
    this.view.dispatch({
      selection: { anchor: cursor },
    });
  }

  // Conversion helpers
  private toCodeMirrorPosition(pos: EditorPosition): number {
    const line = this.view.state.doc.line(pos.line + 1); // Convert 0-based to 1-based line
    return line.from + pos.ch;
  }

  private toEditorPosition(pos: number): EditorPosition {
    const line = this.view.state.doc.lineAt(pos);
    return { line: line.number - 1, ch: pos - line.from }; // Convert 1-based back to 0-based
  }
}

export { MockEditor };
