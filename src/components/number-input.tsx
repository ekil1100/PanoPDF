import { createEffect, createMemo, createSignal, untrack } from 'solid-js';

export function NumberInput(props: {
  id: string;
  class: string;
  value: string;
  disabled: boolean;
  type?: 'text' | 'number';
  inputmode?: 'numeric' | 'decimal';
  label?: string;
  min?: number;
  max?: number;
  error: string;
  valid(value: number): boolean;
  commit(value: number): void;
  status(message: string): void;
  focusReader(): void;
  inputRef?(node: HTMLInputElement): void;
}) {
  // Resolve reactive prop getters under this owner, never in a DOM event handler.
  const committed = createMemo(() => props.value);
  const [draft, setDraft] = createSignal(committed());
  const [editing, setEditing] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);
  let input!: HTMLInputElement;
  let composing = false;
  createEffect(() => {
    const value = committed();
    if (!editing()) setDraft(value);
  });
  function apply() {
    if (composing) return;
    const text = input.value.trim().replace(/%$/, '').trim();
    const value = Number(text);
    if (text && Number.isFinite(value) && props.valid(value)) {
      setInvalid(false);
      props.commit(value);
    } else {
      setInvalid(true);
      props.status(props.error);
    }
    setDraft(committed());
    // A rejected edit can equal the previous signal value after native change.
    input.value = untrack(draft);
  }
  return (
    <input
      ref={(node) => {
        input = node;
        props.inputRef?.(node);
      }}
      id={props.id}
      class={props.class}
      type={props.type ?? 'text'}
      inputmode={props.inputmode}
      min={props.min}
      max={props.max}
      step={props.type === 'number' ? 1 : undefined}
      aria-label={props.label}
      autocomplete="off"
      data-reader
      disabled={props.disabled}
      value={draft()}
      aria-invalid={invalid() ? 'true' : undefined}
      onFocus={() => {
        setEditing(true);
        input.select();
      }}
      onBlur={() => setEditing(false)}
      onInput={() => {
        setDraft(input.value);
        setInvalid(false);
      }}
      onChange={apply}
      onCompositionStart={() => {
        composing = true;
      }}
      onCompositionEnd={() => {
        composing = false;
      }}
      onKeyDown={(event) => {
        if (event.isComposing || composing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
          props.focusReader();
        } else if (event.key === 'Escape') {
          setDraft(committed());
          input.value = committed();
          setInvalid(false);
        }
      }}
    />
  );
}
