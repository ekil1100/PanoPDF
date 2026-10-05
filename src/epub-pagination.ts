import type { EpubChapter } from './epub-book';
import type { ReadingPosition } from './contracts';

export type EpubAnchor = NonNullable<ReadingPosition['epub']>;
export interface TextRun {
  node: Text;
  start: number;
  end: number;
}
export interface PaginatedChapter {
  source: EpubChapter;
  host: HTMLElement;
  article: HTMLElement;
  paper: HTMLElement;
  runs: TextRun[];
  firstPage: number;
  pages: number;
}
export interface PageGeometry {
  width: number;
  height: number;
  padding: number;
  gap: number;
  stride: number;
}

export function pageGeometry(width: number, height: number): PageGeometry {
  const pageHeight = Math.max(160, height - 32);
  const pageWidth = Math.max(
    160,
    Math.min(Math.max(160, width - 32), Math.round(pageHeight * 0.72)),
  );
  return { width: pageWidth, height: pageHeight, padding: 32, gap: 16, stride: pageWidth + 16 };
}

export function textRuns(article: HTMLElement): TextRun[] {
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const runs: TextRun[] = [];
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const end = offset + (node.textContent?.length ?? 0);
    if (end > offset) runs.push({ node: node as Text, start: offset, end });
    offset = end;
  }
  return runs;
}

function runAt(runs: TextRun[], offset: number): TextRun | undefined {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (runs[mid]!.end <= offset) low = mid + 1;
    else high = mid;
  }
  return runs[low] ?? runs.at(-1);
}

export function textRange(chapter: PaginatedChapter, start: number, end = start + 1): Range | null {
  const total = chapter.runs.at(-1)?.end ?? 0;
  if (!total) return null;
  const from = Math.max(0, Math.min(total - 1, start));
  const to = Math.max(from + 1, Math.min(total, end));
  const first = runAt(chapter.runs, from)!;
  const last = runAt(chapter.runs, to - 1)!;
  const range = document.createRange();
  range.setStart(first.node, from - first.start);
  range.setEnd(last.node, to - last.start);
  return range;
}

export function columnAt(chapter: PaginatedChapter, rect: DOMRect, geometry: PageGeometry): number {
  const left = rect.left - chapter.article.getBoundingClientRect().left;
  return Math.max(0, Math.min(chapter.pages - 1, Math.floor((left + 1) / geometry.stride)));
}

function offsetColumn(chapter: PaginatedChapter, offset: number, geometry: PageGeometry): number {
  const range = textRange(chapter, offset);
  const rect = range?.getClientRects()[0];
  return rect ? columnAt(chapter, rect, geometry) : 0;
}

/** First character in a column. Character offsets survive font and viewport reflow;
 * page numbers and scroll fractions do not. The DOM text remains in reading order. */
export function anchorForPage(
  chapter: PaginatedChapter,
  localPage: number,
  geometry: PageGeometry,
): EpubAnchor {
  const anchor: EpubAnchor = {
    chapter: chapter.source.path,
    progress: chapter.pages > 1 ? localPage / (chapter.pages - 1) : 0,
  };
  if (!chapter.source.text.trim()) return anchor;
  let low = 0;
  let high = chapter.runs.at(-1)?.end ?? 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsetColumn(chapter, mid, geometry) < localPage) low = mid + 1;
    else high = mid;
  }
  return { ...anchor, offset: low };
}

export function pageForAnchor(
  chapters: PaginatedChapter[],
  anchor: EpubAnchor,
  geometry: PageGeometry,
): number {
  const chapter = chapters.find((item) => item.source.path === anchor.chapter) ?? chapters[0];
  if (!chapter) return 0;
  const local =
    anchor.offset !== undefined && chapter.source.text.trim()
      ? offsetColumn(chapter, anchor.offset, geometry)
      : Math.round(Math.max(0, Math.min(1, anchor.progress)) * (chapter.pages - 1));
  return chapter.firstPage + local;
}

export function mountChapter(source: EpubChapter): PaginatedChapter {
  const host = document.createElement('section');
  host.className = 'epub-section';
  host.dataset.chapter = source.path;
  const paper = document.createElement('div');
  paper.className = 'epub-paper';
  paper.setAttribute('aria-hidden', 'true');
  const article = document.createElement('article');
  article.className = 'epub-chapter';
  article.setAttribute('aria-label', source.title);
  article.append(source.content.cloneNode(true));
  host.append(paper, article);
  return { source, host, article, paper, runs: textRuns(article), firstPage: 0, pages: 1 };
}

export function paginate(
  viewer: HTMLElement,
  chapters: PaginatedChapter[],
  geometry: PageGeometry,
  scale: number,
  viewportWidth: number,
): number {
  const { width, height, padding, gap, stride } = geometry;
  const styles: Record<string, number> = {
    '--epub-page-width': width,
    '--epub-page-height': height,
    '--epub-page-padding': padding,
    '--epub-content-width': width - 2 * padding,
    '--epub-content-height': height - 2 * padding,
    '--epub-column-gap': 2 * padding + gap,
    '--epub-stride': stride,
    '--epub-tail': Math.max(16, viewportWidth - width - 16),
  };
  Object.entries(styles).forEach(([name, value]) => viewer.style.setProperty(name, `${value}px`));
  viewer.style.setProperty('--epub-scale', String(scale));
  // Read all column extents before writing section widths to avoid layout thrashing.
  const counts = chapters.map(({ article }) =>
    Math.max(1, Math.ceil((article.scrollWidth + 2 * padding + gap - 1) / stride)),
  );
  let total = 0;
  chapters.forEach((chapter, index) => {
    chapter.firstPage = total;
    chapter.pages = counts[index]!;
    chapter.host.style.width = `${chapter.pages * stride - gap}px`;
    if (chapter.paper.childElementCount !== chapter.pages) {
      chapter.paper.replaceChildren(
        ...Array.from({ length: chapter.pages }, (_, page) => {
          const frame = document.createElement('div');
          frame.className = 'epub-page';
          frame.style.left = `${page * stride}px`;
          return frame;
        }),
      );
    }
    [...chapter.paper.children].forEach((frame, page) => {
      (frame as HTMLElement).dataset.pageNumber = String(total + page + 1);
      (frame as HTMLElement).style.left = `${page * stride}px`;
    });
    total += chapter.pages;
  });
  return total;
}
