// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import { cn } from '../../lib/cn';
import type {
  DialogContentProps,
  DialogDescriptionProps,
  DialogTitleProps,
} from '@kobalte/core/dialog';
import { Dialog as DialogPrimitive } from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import type { ComponentProps, ParentProps, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';

export const Dialog = DialogPrimitive;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.CloseButton;

type dialogContentProps<T extends ValidComponent = 'div'> = ParentProps<
  DialogContentProps<T> & {
    class?: string;
  }
>;

export const DialogContent = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, dialogContentProps<T>>,
) => {
  const [local, rest] = splitProps(props as dialogContentProps, ['class', 'children']);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        class={cn('ui-base', 'ui:fixed ui:inset-0 ui:z-50 ui:bg-black/40')}
      />
      <DialogPrimitive.Content
        class={cn(
          'ui-base',
          'ui:fixed ui:left-[50%] ui:top-[50%] ui:z-50 ui:grid ui:w-full ui:max-w-[min(32rem,calc(100vw-2rem))] ui:translate-x-[-50%] ui:translate-y-[-50%] ui:gap-3 ui:rounded-lg ui:border ui:border-border ui:bg-background ui:text-foreground ui:p-4 ui:shadow-lg',
          local.class,
        )}
        {...rest}
      >
        {local.children}
        <DialogPrimitive.CloseButton
          aria-label="关闭对话框"
          class="ui-base ui:border-0 ui:bg-transparent ui:p-0 ui:text-foreground ui:absolute ui:right-4 ui:top-4 ui:rounded-sm ui:opacity-70 ui:ring-offset-background ui:transition-[opacity,box-shadow] ui:hover:opacity-100 ui:focus:outline-hidden ui:focus:ring-[1.5px] ui:focus:ring-ring ui:focus:ring-offset-2 ui:disabled:pointer-events-none"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="ui:h-4 ui:w-4">
            <path
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M18 6L6 18M6 6l12 12"
            />
            <title>关闭对话框</title>
          </svg>
        </DialogPrimitive.CloseButton>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
};

type dialogTitleProps<T extends ValidComponent = 'h2'> = DialogTitleProps<T> & {
  class?: string;
};

export const DialogTitle = <T extends ValidComponent = 'h2'>(
  props: PolymorphicProps<T, dialogTitleProps<T>>,
) => {
  const [local, rest] = splitProps(props as dialogTitleProps, ['class']);

  return (
    <DialogPrimitive.Title
      class={cn('ui-base', 'ui:text-lg ui:font-semibold ui:text-foreground', local.class)}
      {...rest}
    />
  );
};

type dialogDescriptionProps<T extends ValidComponent = 'p'> = DialogDescriptionProps<T> & {
  class?: string;
};

export const DialogDescription = <T extends ValidComponent = 'p'>(
  props: PolymorphicProps<T, dialogDescriptionProps<T>>,
) => {
  const [local, rest] = splitProps(props as dialogDescriptionProps, ['class']);

  return (
    <DialogPrimitive.Description
      class={cn('ui-base', 'ui:text-sm ui:text-muted-foreground', local.class)}
      {...rest}
    />
  );
};

export const DialogHeader = (props: ComponentProps<'div'>) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      class={cn(
        'ui-base',
        'ui:flex ui:flex-col ui:space-y-2 ui:text-center ui:sm:text-left',
        local.class,
      )}
      {...rest}
    />
  );
};

export const DialogFooter = (props: ComponentProps<'div'>) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      class={cn(
        'ui-base',
        'ui:flex ui:flex-col-reverse ui:sm:flex-row ui:sm:justify-end ui:sm:space-x-2',
        local.class,
      )}
      {...rest}
    />
  );
};
