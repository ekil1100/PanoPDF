// Adapted from shadcn-solid; see licenses/shadcn-solid.md.
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const merge = extendTailwindMerge({ prefix: 'ui-' });

export const cn = (...classes: ClassValue[]) => merge(clsx(classes));
