// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import { Alert as AlertPrimitive, type AlertRootProps } from '@kobalte/core/alert';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cva, type VariantProps } from 'class-variance-authority';
import { splitProps, type ComponentProps, type ValidComponent } from 'solid-js';
import { cn } from '../../lib/cn';

const alertVariants = cva(
  'ui-base ui-relative ui-w-full ui-rounded-lg ui-border ui-px-4 ui-py-3 ui-text-sm',
  {
    variants: {
      variant: {
        default: 'ui-border-border ui-bg-background ui-text-foreground',
        destructive: 'ui-border-destructive/50 ui-bg-background ui-text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
type AlertProps<T extends ValidComponent = 'div'> = AlertRootProps<T> &
  VariantProps<typeof alertVariants> & { class?: string };
export function Alert<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, AlertProps<T>>) {
  const [local, rest] = splitProps(props as AlertProps, ['class', 'variant']);
  return (
    <AlertPrimitive class={cn(alertVariants({ variant: local.variant }), local.class)} {...rest} />
  );
}
export function AlertDescription(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return <div class={cn('ui-base ui-text-sm ui-leading-relaxed', local.class)} {...rest} />;
}
