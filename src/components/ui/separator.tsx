// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import { cn } from '../../lib/cn';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import type { SeparatorRootProps } from '@kobalte/core/separator';
import { Separator as SeparatorPrimitive } from '@kobalte/core/separator';
import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';

type separatorProps<T extends ValidComponent = 'hr'> = SeparatorRootProps<T> & {
  class?: string;
};

export const Separator = <T extends ValidComponent = 'hr'>(
  props: PolymorphicProps<T, separatorProps<T>>,
) => {
  const [local, rest] = splitProps(props as separatorProps, ['class']);

  return (
    <SeparatorPrimitive
      class={cn(
        'ui-base',
        'ui-m-0 ui-border-0 ui-shrink-0 ui-bg-border data-[orientation=horizontal]:ui-h-[1px] data-[orientation=vertical]:ui-h-full data-[orientation=horizontal]:ui-w-full data-[orientation=vertical]:ui-w-[1px]',
        local.class,
      )}
      {...rest}
    />
  );
};
