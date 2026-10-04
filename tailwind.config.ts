import type { Config } from 'tailwindcss';

const color = (name: string) => `hsl(var(--ui-${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  prefix: 'ui-',
  // Explicitly opted-in utilities take precedence over existing native-control rules.
  important: true,
  corePlugins: { preflight: false },
  theme: {
    extend: {
      keyframes: {
        'reader-progress': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: { 'reader-progress': 'reader-progress 1.2s ease-in-out infinite' },
      colors: Object.fromEntries(
        [
          'background',
          'foreground',
          'border',
          'input',
          'ring',
          'primary',
          'primary-foreground',
          'secondary',
          'secondary-foreground',
          'destructive',
          'destructive-foreground',
          'muted',
          'muted-foreground',
          'accent',
          'accent-foreground',
          'popover',
          'popover-foreground',
        ].map((name) => [name, color(name)]),
      ),
      fontSize: { sm: ['13px', '20px'], xs: ['12px', '16px'] },
      borderRadius: { sm: '2px', md: 'var(--ui-radius)', lg: '6px' },
    },
  },
} satisfies Config;
