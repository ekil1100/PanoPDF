// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import {
  Select as SelectPrimitive,
  type SelectContentProps,
  type SelectItemProps,
  type SelectTriggerProps,
} from '@kobalte/core/select';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { splitProps, type ParentProps, type ValidComponent } from 'solid-js';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';

export const Select = SelectPrimitive;
export const SelectValue = SelectPrimitive.Value;

type TriggerProps<T extends ValidComponent = 'button'> = ParentProps<
  SelectTriggerProps<T> & { class?: string }
>;
export function SelectTrigger<T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, TriggerProps<T>>,
) {
  const [local, rest] = splitProps(props as TriggerProps, ['class', 'children']);
  return (
    <SelectPrimitive.Trigger
      class={cn(
        'ui-base ui-flex ui-h-8 ui-w-full ui-items-center ui-justify-between ui-gap-2 ui-rounded-md ui-border ui-border-input ui-bg-background ui-px-2 ui-py-1 ui-text-sm ui-text-foreground ui-shadow-sm ui-outline-none focus-visible:ui-ring-[1.5px] focus-visible:ui-ring-ring disabled:ui-cursor-not-allowed disabled:ui-opacity-50',
        local.class,
      )}
      {...rest}
    >
      {local.children}
      <SelectPrimitive.Icon class="ui-base ui-flex ui-shrink-0 ui-opacity-50">
        <Icon name="down" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}
type ContentProps<T extends ValidComponent = 'div'> = SelectContentProps<T> & { class?: string };
export function SelectContent<T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, ContentProps<T>>,
) {
  const [local, rest] = splitProps(props as ContentProps, ['class']);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        class={cn(
          'ui-base ui-relative ui-z-50 ui-min-w-[8rem] ui-overflow-hidden ui-rounded-md ui-border ui-border-border ui-bg-popover ui-text-popover-foreground ui-shadow-md',
          local.class,
        )}
        {...rest}
      >
        <SelectPrimitive.Listbox class="ui-base ui-max-h-[min(20rem,var(--kb-popper-content-available-height))] ui-list-none ui-overflow-y-auto ui-p-1 focus-visible:ui-outline-none" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}
type ItemProps<T extends ValidComponent = 'li'> = ParentProps<
  SelectItemProps<T> & { class?: string }
>;
export function SelectItem<T extends ValidComponent = 'li'>(
  props: PolymorphicProps<T, ItemProps<T>>,
) {
  const [local, rest] = splitProps(props as ItemProps, ['class', 'children']);
  return (
    <SelectPrimitive.Item
      class={cn(
        'ui-base ui-relative ui-flex ui-w-full ui-cursor-default ui-select-none ui-items-center ui-rounded-sm ui-py-1.5 ui-pl-2 ui-pr-8 ui-text-sm ui-outline-none data-[highlighted]:ui-bg-accent data-[highlighted]:ui-text-accent-foreground data-[disabled]:ui-pointer-events-none data-[disabled]:ui-opacity-50',
        local.class,
      )}
      {...rest}
    >
      <SelectPrimitive.ItemIndicator class="ui-base ui-absolute ui-right-2 ui-flex ui-h-4 ui-w-4 ui-items-center ui-justify-center">
        <svg aria-hidden="true" viewBox="0 0 24 24" class="ui-h-4 ui-w-4">
          <path
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="m5 12l5 5L20 7"
          />
        </svg>
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemLabel>{local.children}</SelectPrimitive.ItemLabel>
    </SelectPrimitive.Item>
  );
}
