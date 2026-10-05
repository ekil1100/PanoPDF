import { Effect, Fiber } from 'effect';
import type { ReaderCallbacks, ReaderController, ReadingPosition } from './contracts';
import { loadEpub, type EpubBook } from './epub-book';
import { isPageWheel, normalizePosition, wheelPixels } from './reader-layout';
import {
  anchorForPage,
  columnAt,
  mountChapter,
  pageForAnchor,
  pageGeometry,
  paginate,
  textRange,
} from './epub-pagination';
import type { EpubAnchor, PaginatedChapter } from './epub-pagination';
import './epub-reader.css';

export function createEpubReader(
  container: HTMLDivElement,
  viewer: HTMLDivElement,
  callbacks: ReaderCallbacks,
): ReaderController {
  let book: EpubBook | null = null;
  let chapters: PaginatedChapter[] = [];
  let settings = normalizePosition();
  let geometry = pageGeometry(container.clientWidth, container.clientHeight);
  let anchor: EpubAnchor | null = null;
  let page = 0;
  let pages = 0;
  let ready = false;
  let destroyed = false;
  let generation = 0;
  let loading: Fiber.Fiber<void> | undefined;
  let frame = 0;
  let lastScroll = 0;
  let lastPageWheel = -Infinity;
  let lastSmooth = -Infinity;
  let query = '';
  let matches: { chapter: number; start: number; end: number }[] = [];
  let matchIndex = -1;
  const urls = new Map<string, string>();
  const events = new AbortController();
  const emit = () =>
    callbacks.onState({
      ...settings,
      format: 'epub',
      loaded: ready,
      page: ready ? page + 1 : 0,
      pages,
      layout: 'horizontal',
      columns: 1,
      zoomMode: 'custom',
      zoomChoices: [],
    });
  const emptyFind = () =>
    callbacks.onFind({ current: 0, total: 0, pending: false, notFound: false });
  const clearHighlights = () => {
    CSS.highlights.delete('epub-matches');
    CSS.highlights.delete('epub-current');
  };
  const chapterAt = (value: number) =>
    chapters.find((item) => value >= item.firstPage && value < item.firstPage + item.pages) ??
    chapters.at(-1);
  const boundedPage = (value: number) => Math.max(0, Math.min(pages - 1, Math.floor(value)));
  function capture() {
    if (!ready || Math.abs(container.scrollLeft - lastScroll) < 0.5) return;
    page = boundedPage(Math.floor((container.scrollLeft + 1) / geometry.stride));
    const chapter = chapterAt(page);
    if (chapter) anchor = anchorForPage(chapter, page - chapter.firstPage, geometry);
    lastScroll = container.scrollLeft;
  }
  function getPosition(): ReadingPosition | null {
    capture();
    return ready && anchor
      ? {
          ...settings,
          page: page + 1,
          layout: 'horizontal',
          columns: 1,
          zoomMode: 'custom',
          epub: { ...anchor },
        }
      : null;
  }
  const save = () => {
    const position = getPosition();
    if (position) callbacks.onPosition(position);
  };
  function move(value: number, preserveAnchor = false) {
    if (!ready || !Number.isFinite(value)) return;
    page = boundedPage(value);
    container.scrollLeft = page * geometry.stride;
    container.scrollTop = 0;
    lastScroll = container.scrollLeft;
    const chapter = chapterAt(page);
    if (!preserveAnchor && chapter)
      anchor = anchorForPage(chapter, page - chapter.firstPage, geometry);
    emit();
    save();
  }
  function highlight() {
    clearHighlights();
    if (!ready || !matches.length) return;
    const ranges = matches.flatMap((match, index) => {
      const range = textRange(chapters[match.chapter]!, match.start, match.end);
      return range ? [{ range, index }] : [];
    });
    CSS.highlights.set('epub-matches', new Highlight(...ranges.map((item) => item.range)));
    const current = ranges.find((item) => item.index === matchIndex);
    if (current) CSS.highlights.set('epub-current', new Highlight(current.range));
  }
  function reflow() {
    if (!ready || destroyed || !chapters.length) return;
    // A pending scroll must be captured against the old fixed column geometry.
    capture();
    // Hiding the host during close/HMR must not destroy its content anchor.
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    geometry = pageGeometry(container.clientWidth, container.clientHeight);
    pages = paginate(viewer, chapters, geometry, settings.scale, container.clientWidth);
    move(anchor ? pageForAnchor(chapters, anchor, geometry) : page, true);
    highlight();
  }
  const scheduleReflow = () => {
    if (!ready || destroyed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      reflow();
    });
  };
  function target(value: unknown) {
    if (!ready || !value || typeof value !== 'object' || !('path' in value)) return;
    const chapter = chapters.find((item) => item.source.path === value.path);
    if (!chapter) return;
    const fragment = 'fragment' in value ? value.fragment : '';
    const element =
      typeof fragment === 'string' && fragment
        ? [...chapter.article.querySelectorAll<HTMLElement>('[data-epub-id]')].find(
            (node) => node.dataset.epubId === fragment,
          )
        : undefined;
    const rect = element?.getClientRects()[0];
    move(chapter.firstPage + (rect ? columnAt(chapter, rect, geometry) : 0));
  }
  function mount(loaded: EpubBook) {
    book = loaded;
    chapters = loaded.chapters.map(mountChapter);
    const images: HTMLImageElement[] = [];
    for (const chapter of chapters) {
      for (const image of chapter.article.querySelectorAll<HTMLImageElement>('img')) {
        const path = image.dataset.epubImage ?? '';
        const asset = loaded.images.get(path);
        if (!asset) {
          image.remove();
          continue;
        }
        if (!urls.has(path))
          urls.set(path, URL.createObjectURL(new Blob([asset.bytes], { type: asset.type })));
        image.src = urls.get(path)!;
        images.push(image);
      }
    }
    container.dataset.format = 'epub';
    container.dataset.layout = 'horizontal';
    viewer.replaceChildren(...chapters.map((chapter) => chapter.host));
    return images;
  }
  function reset() {
    ready = false;
    book = null;
    chapters = [];
    anchor = null;
    pages = page = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.clear();
    clearHighlights();
    query = '';
    matches = [];
    matchIndex = -1;
    lastPageWheel = lastSmooth = -Infinity;
    viewer.replaceChildren();
    [...viewer.style]
      .filter((name) => name.startsWith('--epub-'))
      .forEach((name) => viewer.style.removeProperty(name));
    delete container.dataset.format;
    callbacks.onOutline([]);
    emptyFind();
    emit();
  }
  const resize = new ResizeObserver(scheduleReflow);
  resize.observe(container);
  container.addEventListener(
    'scroll',
    () => {
      if (ready) {
        capture();
        emit();
        save();
      }
    },
    { signal: events.signal },
  );
  const click = (event: MouseEvent) => {
    const link =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a') : null;
    if (!ready || !link || !viewer.contains(link)) return;
    event.preventDefault();
    if (event.type === 'auxclick' && event.button !== 1) return;
    if (link.dataset.epubExternal) callbacks.onExternalLink(link.dataset.epubExternal);
    else if (link.dataset.epubTarget) target(JSON.parse(link.dataset.epubTarget));
  };
  container.addEventListener('click', click, { signal: events.signal });
  container.addEventListener('auxclick', click, { signal: events.signal });
  container.addEventListener(
    'wheel',
    (event) => {
      if (!ready || event.defaultPrevented) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        controller.zoomBy(Math.exp(-event.deltaY * 0.002));
        return;
      }
      const [dx, dy] = wheelPixels(event, container.clientHeight);
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (!delta) return;
      const now = performance.now();
      capture();
      if (isPageWheel(settings.scrollInput, event, now - lastSmooth < 180)) {
        if (now - lastPageWheel < 180) return;
        lastPageWheel = now;
        move(page + Math.sign(delta));
      } else {
        lastSmooth = now;
        container.scrollLeft += delta;
        capture();
        emit();
        save();
      }
    },
    { passive: false, signal: events.signal },
  );
  container.addEventListener(
    'keydown',
    (event) => {
      if (
        !ready ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,button,[contenteditable="true"]')
      )
        return;
      const targets: Record<string, number> = {
        ArrowRight: page + 1,
        PageDown: page + 1,
        ArrowLeft: page - 1,
        PageUp: page - 1,
        Home: 0,
        End: pages - 1,
      };
      const next = targets[event.key];
      if (next === undefined) return;
      event.preventDefault();
      move(next);
    },
    { signal: events.signal },
  );
  const stop = () => (loading ? Fiber.interrupt(loading).pipe(Effect.asVoid) : Effect.void);
  const controller: ReaderController = {
    open(data, position) {
      if (destroyed) return Effect.runPromise(Effect.void);
      const token = ++generation;
      const task = stop().pipe(
        Effect.andThen(
          Effect.sync(() => {
            reset();
            settings = {
              ...normalizePosition(position),
              layout: 'horizontal',
              zoomMode: 'custom',
              scale: Math.min(3, Math.max(0.5, position?.scale ?? 1)),
            };
          }),
        ),
        Effect.andThen(loadEpub(data)),
        Effect.flatMap((loaded) => Effect.sync(() => mount(loaded))),
        // Decode before pagination: late intrinsic image sizes otherwise move text between pages.
        Effect.flatMap((images) =>
          Effect.all(
            images.map((image) =>
              typeof image.decode === 'function'
                ? Effect.tryPromise({ try: () => image.decode(), catch: () => undefined }).pipe(
                    Effect.catch(() => Effect.void),
                  )
                : Effect.void,
            ),
            { concurrency: 8 },
          ),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            if (destroyed || token !== generation || !book) return;
            const saved = position?.epub;
            const initial =
              chapters.find((item) => item.source.path === saved?.chapter) ?? chapters[0]!;
            anchor =
              saved && initial.source.path === saved.chapter
                ? { ...saved }
                : { chapter: initial.source.path, progress: 0, offset: 0 };
            ready = true;
            geometry = pageGeometry(container.clientWidth, container.clientHeight);
            pages = paginate(viewer, chapters, geometry, settings.scale, container.clientWidth);
            move(pageForAnchor(chapters, anchor, geometry), true);
            callbacks.onOutline(book.outline);
          }),
        ),
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.sync(() => {
            if (!destroyed && token === generation) {
              reset();
              callbacks.onError(error.message);
            }
          }),
        ),
      );
      loading = Effect.runFork(task);
      return Effect.runPromise(Fiber.join(loading));
    },
    close() {
      ++generation;
      return Effect.runPromise(stop().pipe(Effect.andThen(Effect.sync(reset))));
    },
    destroy() {
      destroyed = true;
      ++generation;
      events.abort();
      resize.disconnect();
      return Effect.runPromise(stop().pipe(Effect.andThen(Effect.sync(reset))));
    },
    setLayout() {},
    setColumns() {},
    fitPageCount() {},
    fitHeight() {},
    setScrollInput(value) {
      settings.scrollInput = value;
      emit();
      save();
    },
    setScale(scale) {
      if (!ready || !Number.isFinite(scale)) return;
      capture();
      settings.scale = Math.min(3, Math.max(0.5, scale));
      reflow();
    },
    zoomBy(factor) {
      if (Number.isFinite(factor) && factor > 0) controller.setScale(settings.scale * factor);
    },
    goToPage(value) {
      move(value - 1);
    },
    find(value, options = {}) {
      if (!ready || !book) return;
      if (!value) {
        controller.closeFind();
        return;
      }
      if (value !== query) {
        query = value;
        matches = [];
        const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
        book.chapters.forEach((item, index) => {
          for (const match of item.text.matchAll(pattern)) {
            if (matches.length >= 10000) break;
            matches.push({
              chapter: index,
              start: match.index,
              end: match.index + match[0].length,
            });
          }
        });
        matchIndex = options.previous ? matches.length - 1 : 0;
      } else if (options.again && matches.length)
        matchIndex = (matchIndex + (options.previous ? -1 : 1) + matches.length) % matches.length;
      const match = matches[matchIndex];
      if (match) {
        anchor = {
          chapter: chapters[match.chapter]!.source.path,
          progress: 0,
          offset: match.start,
        };
        move(pageForAnchor(chapters, anchor, geometry), true);
      }
      highlight();
      callbacks.onFind({
        current: matches.length ? matchIndex + 1 : 0,
        total: matches.length,
        pending: false,
        notFound: !matches.length,
      });
    },
    closeFind() {
      query = '';
      matches = [];
      matchIndex = -1;
      clearHighlights();
      emptyFind();
    },
    goToOutline(value) {
      return Effect.runPromise(Effect.sync(() => target(value)));
    },
    refreshLayout: reflow,
    getPosition,
  };
  return controller;
}
