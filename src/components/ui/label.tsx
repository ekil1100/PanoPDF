// Adapted from shadcn-solid textfield.tsx label styling; see licenses/shadcn-solid.md.
import { splitProps, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';

/** Standalone label for controls outside a Kobalte TextField context. */
export function Label(props: ComponentProps<'label'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <label class={cn('ui-base ui-text-sm ui-font-medium ui-leading-none', local.class)} {...rest} />
  );
}
