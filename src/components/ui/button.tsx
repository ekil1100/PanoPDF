// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import { cn } from '../../lib/cn';
import type { ButtonRootProps } from '@kobalte/core/button';
import { Button as ButtonPrimitive } from '@kobalte/core/button';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';

export const buttonVariants = cva(
  'ui-base ui:border ui:border-transparent ui:bg-transparent ui:text-foreground ui:gap-1.5 ui:whitespace-nowrap ui:inline-flex ui:items-center ui:justify-center ui:rounded-md ui:text-sm ui:font-medium ui:transition-[color,background-color,box-shadow] ui:focus-visible:outline-hidden ui:focus-visible:ring-[1.5px] ui:focus-visible:ring-ring ui:disabled:pointer-events-none ui:disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'ui:bg-primary ui:text-primary-foreground ui:shadow-sm ui:hover:bg-primary/90',
        destructive:
          'ui:bg-destructive ui:text-destructive-foreground ui:shadow-xs ui:hover:bg-destructive/90',
        outline:
          'ui:border ui:border-input ui:bg-background ui:shadow-xs ui:hover:bg-accent ui:hover:text-accent-foreground',
        secondary:
          'ui:bg-secondary ui:text-secondary-foreground ui:shadow-xs ui:hover:bg-secondary/80',
        ghost: 'ui:hover:bg-accent ui:hover:text-accent-foreground',
        link: 'ui:text-primary ui:underline-offset-4 ui:hover:underline',
      },
      size: {
        default: 'ui:h-8 ui:px-3 ui:py-1',
        sm: 'ui:h-7 ui:rounded-md ui:px-2 ui:text-xs',
        lg: 'ui:h-9 ui:rounded-md ui:px-4',
        icon: 'ui:h-8 ui:w-8 ui:p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps<T extends ValidComponent = 'button'> = ButtonRootProps<T> &
  VariantProps<typeof buttonVariants> & {
    class?: string;
  };

export const Button = <T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, ButtonProps<T>>,
) => {
  const [local, rest] = splitProps(props as ButtonProps, ['class', 'variant', 'size']);

  return (
    <ButtonPrimitive
      class={cn(
        buttonVariants({
          size: local.size,
          variant: local.variant,
        }),
        local.class,
      )}
      {...rest}
    />
  );
};
