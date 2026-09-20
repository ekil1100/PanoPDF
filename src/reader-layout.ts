import type { LayoutMode, ReadingPosition, ScrollInput } from './contracts.ts';

export const PAGE_GAP = 16;
export const VIEW_PADDING = 16;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 25;

export function clampScale(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) : 1;
}

export function positiveInteger(value: number, fallback = 1): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

export function normalizePosition(position?: ReadingPosition): ReadingPosition {
  return {
    page: positiveInteger(position?.page ?? 1),
    scale: clampScale(position?.scale ?? 1),
    layout: position?.layout === 'vertical' ? 'vertical' : 'horizontal',
    columns: positiveInteger(position?.columns ?? 1),
    zoomMode: position?.zoomMode === 'custom' || position?.zoomMode === 'pages' ? position.zoomMode : 'height',
    fitPages: positiveInteger(position?.fitPages ?? 1),
    scrollInput: position?.scrollInput === 'page' || position?.scrollInput === 'smooth' ? position.scrollInput : 'auto',
    ...(Number.isFinite(position?.left) ? { left: position!.left } : {}),
    ...(Number.isFinite(position?.top) ? { top: position!.top } : {}),
  };
}

// Visible IDs are ordered by PDFViewer's visibility ranking, not document order.
export function anchorPage(visible: number[], current: number, pointed?: number): number {
  if (pointed !== undefined && visible.includes(pointed)) return pointed;
  return visible.includes(current) ? current : visible[0] ?? current;
}

export interface PageSize { width: number; height: number }

// Sizes are CSS pixels at viewer scale 1, including PDF user units/rotation.
export function fitScale(viewport: PageSize, pages: PageSize[], layout: LayoutMode, columns: number): number {
  if (!pages.length || viewport.width <= 0 || viewport.height <= 0) return 1;
  const count = layout === 'horizontal' ? pages.length : Math.min(positiveInteger(columns), pages.length);
  const widths = Array<number>(count).fill(0);
  const heights: number[] = [];
  pages.forEach((page, index) => {
    widths[index % count] = Math.max(widths[index % count]!, page.width);
    const row = Math.floor(index / count);
    heights[row] = Math.max(heights[row] ?? 0, page.height);
  });
  const width = widths.reduce((sum, value) => sum + value, 0);
  const height = heights.reduce((sum, value) => sum + value, 0);
  // PDFViewer.updateScale quantizes to 1%; round fits down to avoid clipping.
  return clampScale(Math.floor(100 * Math.min(
    Math.max(1, viewport.width - 2 * VIEW_PADDING - (count - 1) * PAGE_GAP) / width,
    Math.max(1, viewport.height - 2 * VIEW_PADDING - (heights.length - 1) * PAGE_GAP) / height,
  )) / 100);
}

export function heightScale(height: number, pageHeight: number): number {
  return clampScale(Math.floor(100 * Math.max(1, height - 2 * VIEW_PADDING) / pageHeight) / 100);
}

export interface WheelSample { deltaX: number; deltaY: number; deltaMode: number }

// WheelEvent has no device identity. Favor continuous input when ambiguous.
export function isPageWheel(input: ScrollInput, event: WheelSample, recentlySmooth = false): boolean {
  if (event.deltaX !== 0 || input === 'smooth') return false;
  if (input === 'page') return true;
  if (event.deltaMode !== 0) return true;
  const delta = Math.abs(event.deltaY);
  return !recentlySmooth && delta >= 40 && Number.isInteger(delta) &&
    [40, 50, 60, 100, 120].some(unit => delta % unit === 0);
}

export function wheelPixels(event: WheelSample, viewportHeight: number): [number, number] {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
  return [event.deltaX * unit, event.deltaY * unit];
}

export interface PageExtent { start: number; size: number }

// Oversized pages advance within the page before moving to the next page.
export function pageStep(pages: PageExtent[], scroll: number, viewport: number, direction: number): number {
  if (!pages.length || !direction) return scroll;
  const edge = scroll + VIEW_PADDING + 1;
  let index = pages.findIndex(page => page.start + page.size > edge);
  if (index < 0) index = pages.length - 1;
  const page = pages[index]!;
  const start = Math.max(0, page.start - VIEW_PADDING);
  const end = Math.max(start, page.start + page.size - viewport + VIEW_PADDING);
  if (direction > 0) {
    if (scroll < end - 1) return Math.min(end, scroll + viewport * 0.85);
    return Math.max(0, (pages[index + 1]?.start ?? page.start) - VIEW_PADDING, end);
  }
  if (scroll > start + 1) return Math.max(start, scroll - viewport * 0.85);
  const previous = pages[index - 1];
  return previous ? Math.max(0, previous.start - VIEW_PADDING, previous.start + previous.size - viewport + VIEW_PADDING) : 0;
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function pdfErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'InvalidPDFException') return '无法打开：文件不是有效的 PDF，或内容已损坏。请尝试其他文件。';
  if (name === 'PasswordException') return '无法解锁 PDF，请检查密码后重新打开。';
  if (name === 'WorkerError') return 'PDF 渲染进程启动失败，请重启应用后重试。';
  return 'PDF 加载或渲染失败，请重新打开文件；若仍失败，请尝试其他 PDF。';
}
