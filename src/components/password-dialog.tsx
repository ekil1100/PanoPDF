import { createEffect, createSignal, untrack } from 'solid-js';
import type { AppState } from '../app-controller';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

export function PasswordDialog(props: {
  request: AppState['password'];
  resolve(value: string | null): void;
  focusFallback(): void;
}) {
  let input: HTMLInputElement | undefined;
  let previousFocus: HTMLElement | null = null;
  let requestId: number | undefined;
  const [value, setValue] = createSignal('');
  const [invalid, setInvalid] = createSignal<boolean | undefined>(undefined);
  createEffect(() => {
    const request = props.request;
    untrack(() => {
      if (request && request.requestId !== requestId) {
        if (requestId === undefined)
          previousFocus =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        requestId = request.requestId;
        setValue('');
        setInvalid(request.incorrect);
        input?.focus();
      } else if (!request) {
        requestId = undefined;
        setValue('');
        if (input) input.value = '';
        input = undefined;
      }
    });
  });
  return (
    <Dialog
      open={!!props.request}
      onOpenChange={(open) => {
        if (!open) props.resolve(null);
      }}
    >
      <DialogContent
        id="passwordDialog"
        class="ui-max-w-[min(400px,calc(100vw-48px))] ui-p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus?.isConnected && previousFocus.checkVisibility()) previousFocus.focus();
          else props.focusFallback();
          previousFocus = null;
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <form
          id="passwordForm"
          onSubmit={(event) => {
            event.preventDefault();
            props.resolve(value());
          }}
        >
          <DialogTitle id="passwordTitle">此 PDF 需要密码</DialogTitle>
          <DialogDescription id="passwordDescription" class="ui-mt-2 ui-mb-5">
            输入文档密码以继续打开。
          </DialogDescription>
          <Label class="field-label" for="passwordInput">
            文档密码
          </Label>
          <Input
            ref={(node) => {
              input = node;
            }}
            id="passwordInput"
            type="password"
            autocomplete="off"
            aria-describedby="passwordError"
            value={value()}
            aria-invalid={invalid()}
            onInput={(event) => {
              setValue(event.currentTarget.value);
              setInvalid(undefined);
            }}
          />
          <Alert
            id="passwordError"
            variant="destructive"
            class="ui-mt-2 ui-border-0 ui-p-0"
            hidden={!invalid()}
          >
            <AlertDescription>密码不正确，请重试。</AlertDescription>
          </Alert>
          <div class="dialog-actions">
            <Button
              id="cancelPassword"
              variant="outline"
              type="button"
              onClick={() => props.resolve(null)}
            >
              取消
            </Button>
            <Button id="submitPassword" type="submit">
              打开文档
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
