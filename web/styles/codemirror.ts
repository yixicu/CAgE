import { EditorView } from '@codemirror/view';

// The editor owns its DOM. Its supported theme extension reads the same tokens
// as Tailwind, so changing a theme does not recreate the editor or lose edits.
export const editorTheme = EditorView.theme({
  '&': { minHeight: '220px', fontSize: 'var(--text-sm)', color: 'var(--color-ink)', backgroundColor: 'var(--color-surface)' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: 'calc(var(--spacing) * 4) 0', caretColor: 'var(--color-accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: 'var(--color-canvas)', color: 'var(--color-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--color-selected)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--color-hover)' },
});
