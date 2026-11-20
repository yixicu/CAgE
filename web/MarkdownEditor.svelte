<script lang="ts">
  import { onMount } from 'svelte';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
  import { markdown } from '@codemirror/lang-markdown';
  import { editorTheme } from './styles/codemirror';
  let { value = '', readonly = false, label = 'Markdown editor', onchange }: {
    value?: string; readonly?: boolean; label?: string; onchange?: (value: string) => void;
  } = $props();
  let host: HTMLDivElement;
  let editor: EditorView | undefined;
  const editing = new Compartment();
  onMount(() => {
    editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [lineNumbers(), highlightActiveLine(), markdown(), EditorView.lineWrapping,
          editing.of([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) onchange?.(update.state.doc.toString());
          }),
          editorTheme,
        ],
      }),
    });
    return () => { editor?.destroy(); editor = undefined; };
  });
  $effect(() => {
    const text = value;
    if (editor && editor.state.doc.toString() !== text) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  });
  $effect(() => {
    const readOnly = readonly;
    editor?.dispatch({ effects: editing.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  });
</script>
<div class="markdown-editor" bind:this={host}></div>
