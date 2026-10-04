import { createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import type { AppState } from '../app-controller';

export function PasswordDialog(props: {
  request: AppState['password'];
  resolve(value: string | null): void;
  focusMenu(): void;
}) {
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  let previousFocus: HTMLElement | null = null;
  let requestId: number | undefined;
  const [value, setValue] = createSignal('');
  const [invalid, setInvalid] = createSignal<boolean | undefined>(undefined);
  const [mounted, setMounted] = createSignal(false);
  function restoreFocus() {
    if (previousFocus?.isConnected && previousFocus.checkVisibility()) previousFocus.focus();
    else props.focusMenu();
    previousFocus = null;
  }
  createEffect(() => {
    const request = props.request;
    if (!mounted()) return;
    untrack(() => {
      if (request && request.requestId !== requestId) {
        requestId = request.requestId;
        if (!dialog.open)
          previousFocus =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setValue('');
        setInvalid(request.incorrect);
        if (!dialog.open) dialog.showModal();
        input.focus();
      } else if (!request && requestId !== undefined) {
        requestId = undefined;
        if (dialog.open) dialog.close();
        setValue('');
        restoreFocus();
      }
    });
  });
  onMount(() => setMounted(true));
  onCleanup(() => {
    // The shared application disposer settles the controller's password promise.
    if (dialog.open) dialog.close();
    input.value = '';
    previousFocus = null;
  });
  return (
    <dialog
      ref={(node) => {
        dialog = node;
      }}
      id="passwordDialog"
      aria-labelledby="passwordTitle"
      aria-describedby="passwordDescription"
      onCancel={(event) => {
        event.preventDefault();
        props.resolve(null);
      }}
      onClose={() => {
        if (!dialog.open && props.request) props.resolve(null);
      }}
    >
      <form
        id="passwordForm"
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          props.resolve(value());
        }}
      >
        <h2 id="passwordTitle">此 PDF 需要密码</h2>
        <p id="passwordDescription">输入文档密码以继续打开。</p>
        <label class="field-label" for="passwordInput">
          文档密码
        </label>
        <input
          ref={(node) => {
            input = node;
          }}
          id="passwordInput"
          type="password"
          autocomplete="off"
          aria-describedby="passwordError"
          autofocus
          value={value()}
          aria-invalid={invalid()}
          onInput={(event) => {
            setValue(event.currentTarget.value);
            setInvalid(undefined);
          }}
        />
        <p id="passwordError" class="password-error" role="alert" hidden={!invalid()}>
          密码不正确，请重试。
        </p>
        <div class="dialog-actions">
          <button id="cancelPassword" type="button" onClick={() => props.resolve(null)}>
            取消
          </button>
          <button id="submitPassword" class="primary-button" type="submit">
            打开文档
          </button>
        </div>
      </form>
    </dialog>
  );
}
