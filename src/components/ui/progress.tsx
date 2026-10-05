// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import { Progress as ProgressPrimitive, type ProgressRootProps } from '@kobalte/core/progress';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { splitProps, type ParentProps, type ValidComponent } from 'solid-js';
import { cn } from '../../lib/cn';

type ProgressProps<T extends ValidComponent = 'div'> = ParentProps<
  ProgressRootProps<T> & { class?: string }
>;
export function Progress<T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, ProgressProps<T>>,
) {
  const [local, rest] = splitProps(props as ProgressProps, ['class', 'children']);
  return (
    <ProgressPrimitive
      class={cn('ui-base ui:flex ui:w-full ui:flex-col ui:gap-2', local.class)}
      {...rest}
    >
      {local.children}
      <ProgressPrimitive.Track class="ui-base ui:h-1 ui:overflow-hidden ui:rounded-full ui:bg-primary/20">
        <ProgressPrimitive.Fill class="ui-base ui:h-full ui:w-[var(--kb-progress-fill-width)] ui:bg-primary ui:data-[indeterminate]:w-1/3 ui:data-[indeterminate]:animate-reader-progress ui:motion-reduce:animate-none" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive>
  );
}
