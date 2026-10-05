// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import {
  Tabs as TabsPrimitive,
  type TabsRootProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentProps,
} from '@kobalte/core/tabs';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { splitProps, type ValidComponent } from 'solid-js';
import { cn } from '../../lib/cn';

type TabsProps<T extends ValidComponent = 'div'> = TabsRootProps<T> & { class?: string };
export function Tabs<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, TabsProps<T>>) {
  const [local, rest] = splitProps(props as TabsProps, ['class']);
  return <TabsPrimitive class={cn('ui-base ui:w-full', local.class)} {...rest} />;
}
type ListProps<T extends ValidComponent = 'div'> = TabsListProps<T> & { class?: string };
export function TabsList<T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, ListProps<T>>,
) {
  const [local, rest] = splitProps(props as ListProps, ['class']);
  return (
    <TabsPrimitive.List
      class={cn(
        'ui-base ui:inline-flex ui:items-center ui:rounded-lg ui:bg-muted ui:p-1 ui:text-muted-foreground',
        local.class,
      )}
      {...rest}
    />
  );
}
type TriggerProps<T extends ValidComponent = 'button'> = TabsTriggerProps<T> & { class?: string };
export function TabsTrigger<T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, TriggerProps<T>>,
) {
  const [local, rest] = splitProps(props as TriggerProps, ['class']);
  return (
    <TabsPrimitive.Trigger
      class={cn(
        'ui-base ui:inline-flex ui:h-7 ui:items-center ui:justify-center ui:whitespace-nowrap ui:rounded-md ui:bg-transparent ui:px-3 ui:py-1 ui:text-sm ui:font-medium ui:text-muted-foreground ui:outline-hidden ui:focus-visible:ring-[1.5px] ui:focus-visible:ring-ring ui:disabled:pointer-events-none ui:disabled:opacity-50 ui:data-[selected]:bg-background ui:data-[selected]:text-foreground ui:data-[selected]:shadow-xs',
        local.class,
      )}
      {...rest}
    />
  );
}
type ContentProps<T extends ValidComponent = 'div'> = TabsContentProps<T> & { class?: string };
export function TabsContent<T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, ContentProps<T>>,
) {
  const [local, rest] = splitProps(props as ContentProps, ['class']);
  return (
    <TabsPrimitive.Content
      class={cn(
        'ui-base ui:focus-visible:outline-hidden ui:focus-visible:ring-[1.5px] ui:focus-visible:ring-ring',
        local.class,
      )}
      {...rest}
    />
  );
}
