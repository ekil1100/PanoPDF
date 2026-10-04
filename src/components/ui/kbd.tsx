import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

/** Non-interactive keycap for platform-formatted shortcut labels. */
export function Kbd(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <kbd
      data-slot="kbd"
      class={cn(
        'ui-base ui-inline-flex ui-h-5 ui-min-w-5 ui-items-center ui-justify-center ui-rounded ui-bg-muted ui-px-1 ui-font-sans ui-text-xs ui-font-medium ui-text-muted-foreground ui-whitespace-nowrap',
        local.class,
      )}
      {...rest}
    />
  );
}
