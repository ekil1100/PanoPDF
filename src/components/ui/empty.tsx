import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

/** Solid composition of the shadcn Empty pattern; file handling belongs to the app. */
export function Empty(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="empty"
      class={cn(
        'ui-base ui-flex ui-flex-col ui-items-center ui-justify-center ui-gap-6 ui-border ui-border-dashed ui-border-border ui-rounded-lg ui-p-6 ui-text-center',
        local.class,
      )}
      {...rest}
    />
  );
}
