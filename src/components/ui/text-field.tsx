// Adapted from hngngn/shadcn-solid@63291dcef4710c0507f6919d988a49fd4d67f2fe.
// See licenses/shadcn-solid.md for the MIT notice and local changes.
import { inputStyles } from './input';
import { cn } from '../../lib/cn';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import type {
  TextFieldDescriptionProps,
  TextFieldErrorMessageProps,
  TextFieldInputProps,
  TextFieldLabelProps,
  TextFieldRootProps,
} from '@kobalte/core/text-field';
import { TextField as TextFieldPrimitive } from '@kobalte/core/text-field';
import { cva } from 'class-variance-authority';
import type { ValidComponent, VoidProps } from 'solid-js';
import { splitProps } from 'solid-js';

type textFieldProps<T extends ValidComponent = 'div'> = TextFieldRootProps<T> & {
  class?: string;
};

export const TextFieldRoot = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, textFieldProps<T>>,
) => {
  const [local, rest] = splitProps(props as textFieldProps, ['class']);

  return <TextFieldPrimitive class={cn('ui-base', 'ui:space-y-1', local.class)} {...rest} />;
};

export const textfieldLabel = cva(
  'ui:text-sm ui:data-[disabled]:cursor-not-allowed ui:data-[disabled]:opacity-70 ui:font-medium',
  {
    variants: {
      label: {
        true: 'ui:data-[invalid]:text-destructive',
      },
      error: {
        true: 'ui:text-destructive ui:text-xs',
      },
      description: {
        true: 'ui:font-normal ui:text-muted-foreground',
      },
    },
    defaultVariants: {
      label: true,
    },
  },
);

type textFieldLabelProps<T extends ValidComponent = 'label'> = TextFieldLabelProps<T> & {
  class?: string;
};

export const TextFieldLabel = <T extends ValidComponent = 'label'>(
  props: PolymorphicProps<T, textFieldLabelProps<T>>,
) => {
  const [local, rest] = splitProps(props as textFieldLabelProps, ['class']);

  return (
    <TextFieldPrimitive.Label class={cn('ui-base', textfieldLabel(), local.class)} {...rest} />
  );
};

type textFieldErrorMessageProps<T extends ValidComponent = 'div'> =
  TextFieldErrorMessageProps<T> & {
    class?: string;
  };

export const TextFieldErrorMessage = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, textFieldErrorMessageProps<T>>,
) => {
  const [local, rest] = splitProps(props as textFieldErrorMessageProps, ['class']);

  return (
    <TextFieldPrimitive.ErrorMessage
      class={cn('ui-base', textfieldLabel({ error: true }), local.class)}
      {...rest}
    />
  );
};

type textFieldDescriptionProps<T extends ValidComponent = 'div'> = TextFieldDescriptionProps<T> & {
  class?: string;
};

export const TextFieldDescription = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, textFieldDescriptionProps<T>>,
) => {
  const [local, rest] = splitProps(props as textFieldDescriptionProps, ['class']);

  return (
    <TextFieldPrimitive.Description
      class={cn('ui-base', textfieldLabel({ description: true, label: false }), local.class)}
      {...rest}
    />
  );
};

type textFieldInputProps<T extends ValidComponent = 'input'> = VoidProps<
  TextFieldInputProps<T> & {
    class?: string;
  }
>;

export const TextFieldInput = <T extends ValidComponent = 'input'>(
  props: PolymorphicProps<T, textFieldInputProps<T>>,
) => {
  const [local, rest] = splitProps(props as textFieldInputProps, ['class']);

  return <TextFieldPrimitive.Input class={cn('ui-base', inputStyles, local.class)} {...rest} />;
};
