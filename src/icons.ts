const paths = {
  open: '<path d="M3 7V4.5h6l2 2h10v4M3 7h6l2 2h10l-3 11H3Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<path d="M9 5V3h12v12h-2"/><rect x="3" y="9" width="12" height="12" rx="1"/>',
  outline: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  previous: '<path d="m14 5-7 7 7 7"/>',
  next: '<path d="m10 5 7 7-7 7"/>',
  up: '<path d="m5 14 7-7 7 7"/>',
  down: '<path d="m5 10 7 7 7-7"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  document: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h8"/>',
} as const;

export type IconName = keyof typeof paths;

export function icon(name: IconName): string {
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
