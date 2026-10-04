# shadcn-solid attribution

Repository: https://github.com/hngngn/shadcn-solid
Tag: `shadcn-solid@0.7.7`
Commit: `63291dcef4710c0507f6919d988a49fd4d67f2fe`
License: MIT (upstream notice reproduced verbatim below).
License source: https://github.com/hngngn/shadcn-solid/blob/63291dcef4710c0507f6919d988a49fd4d67f2fe/LICENSE.md

Adapted source paths at that commit:

- `packages/tailwindcss/ui/button.tsx` → `src/components/ui/button.tsx`
- `packages/tailwindcss/ui/textfield.tsx` → `src/components/ui/text-field.tsx`, `input.tsx`, `label.tsx`
- `packages/tailwindcss/ui/separator.tsx` → `src/components/ui/separator.tsx`
- `packages/tailwindcss/ui/tabs.tsx` → `src/components/ui/tabs.tsx`
- `packages/tailwindcss/ui/alert.tsx` → `src/components/ui/alert.tsx`
- `packages/tailwindcss/ui/progress.tsx` → `src/components/ui/progress.tsx`
- `packages/tailwindcss/ui/select.tsx` → `src/components/ui/select.tsx`
- `packages/tailwindcss/ui/dialog.tsx` → `src/components/ui/dialog.tsx`
- `packages/tailwindcss/libs/cn.ts` → `src/lib/cn.ts`
- `packages/tailwindcss/tailwind.config.js` → `tailwind.config.ts` (theme pattern)

Local adaptations: relative imports, prefixed utilities and theme variables, local
base defaults without preflight, compact control sizing, removal of optional
animations, standalone native Input and Label derived from text-field styling,
selected-tab styling without an animated indicator, reduced-motion-aware
indeterminate progress animation, overlay/content prop separation,
viewport-constrained dialog and select
content, and Kobalte highlight-state styling. No React components are included.

## Upstream license notice

Copyright © 2023 shadcn
Copyright © 2023 hngngn

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
