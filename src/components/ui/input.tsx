// Styling adapted from shadcn-solid textfield.tsx; see licenses/shadcn-solid.md.
import { splitProps, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';

export const inputStyles =
  'ui:flex ui:h-8 ui:w-full ui:rounded-md ui:border ui:border-input ui:bg-background ui:text-foreground ui:px-2 ui:py-1 ui:text-sm ui:shadow-xs ui:transition-shadow ui:file:border-0 ui:file:bg-transparent ui:file:text-sm ui:file:font-medium ui:placeholder:text-muted-foreground ui:focus-visible:outline-hidden ui:focus-visible:ring-[1.5px] ui:focus-visible:ring-ring ui:aria-[invalid=true]:border-destructive ui:disabled:cursor-not-allowed ui:disabled:opacity-50';

export type InputProps = ComponentProps<'input'>;

/** Standalone native input. Use TextFieldInput inside TextFieldRoot for linked labels/errors. */
export const Input = (props: InputProps) => {
  const [local, rest] = splitProps(props, ['class']);
  return <input class={cn('ui-base', inputStyles, local.class)} {...rest} />;
};
