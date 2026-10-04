// Styling adapted from shadcn-solid textfield.tsx; see licenses/shadcn-solid.md.
import { splitProps, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';

export const inputStyles =
  'ui-flex ui-h-8 ui-w-full ui-rounded-md ui-border ui-border-input ui-bg-background ui-text-foreground ui-px-2 ui-py-1 ui-text-sm ui-shadow-sm ui-transition-shadow file:ui-border-0 file:ui-bg-transparent file:ui-text-sm file:ui-font-medium placeholder:ui-text-muted-foreground focus-visible:ui-outline-none focus-visible:ui-ring-[1.5px] focus-visible:ui-ring-ring aria-[invalid=true]:ui-border-destructive disabled:ui-cursor-not-allowed disabled:ui-opacity-50';

export type InputProps = ComponentProps<'input'>;

/** Standalone native input. Use TextFieldInput inside TextFieldRoot for linked labels/errors. */
export const Input = (props: InputProps) => {
  const [local, rest] = splitProps(props, ['class']);
  return <input class={cn('ui-base', inputStyles, local.class)} {...rest} />;
};
