import {
  AnnotationEditorType, AnnotationMode, GlobalWorkerOptions, PasswordResponses,
  PDFWorker, getDocument,
} from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import {
  EventBus, FindState as PDFFindState, PDFFindController, PDFLinkService,
  PDFViewer, ScrollMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './reader.css';
import type {
  FindState, OutlineEntry, ReaderCallbacks, ReaderController, ReadingPosition,
} from './contracts.ts';
import {
  MIN_SCALE, VIEW_PADDING, anchorPage, clampScale, fitScale, heightScale, isPageWheel,
  normalizePosition, pageStep, pdfErrorMessage, positiveInteger, safeExternalUrl, wheelPixels,
} from './reader-layout.ts';
import type { PageSize } from './reader-layout.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

interface Anchor { page: number; left: number; top: number; x: number; y: number }
interface OutlineTarget { dest?: string | unknown[] | null; url?: string | null }
interface Session {
  abort: AbortController;
  bus: EventBus;
  pdf: PDFViewer;
  links: PDFLinkService;
  find: PDFFindController;
  worker?: Worker;
  workerFailed?: boolean;
  pdfWorker?: PDFWorker;
  task?: PDFDocumentLoadingTask;
  document?: PDFDocumentProxy;
  ready: boolean;
  targets: Map<unknown, OutlineTarget>;
  pageGeometry: Map<number, string>;
  searchActive: boolean;
  findState: FindState;
}

const emptyFind = (): FindState => ({ current: 0, total: 0, pending: false, notFound: false });

// Abortable waits also settle open() when PDF.js leaves a readiness promise pending.
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Reader operation cancelled', 'AbortError'));
    if (signal.aborted) { void promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createReader(
  container: HTMLDivElement, viewer: HTMLDivElement, callbacks: ReaderCallbacks,
): ReaderController {
  let settings = normalizePosition();
  let session: Session | null = null;
  let destroyed = false;
  let generation = 0;
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeFrame = 0;
  let stableAnchor: Anchor | null = null;
  let lastSmooth = -Infinity;
  let lastPageWheel = -Infinity;
  let mutating = false;
  let geometryVersion = 0;
  let lastStateKey = '';
  const lifetime = new AbortController();
  const releases = new Set<Promise<void>>();
  const resources = `${import.meta.env.BASE_URL}pdfjs/`;

  const isCurrent = (s: Session) => session === s && !s.abort.signal.aborted && !destroyed;
  const ready = () => session?.ready && !destroyed ? session : null;
  const pageView = (s: Session, page: number): PDFPageView | undefined => s.pdf.getPageView(page - 1);
  const viewportSize = (): PageSize => ({ width: container.clientWidth, height: container.clientHeight });

  function pageSizes(s: Session, count: number): PageSize[] {
    const first = Math.min(s.pdf.currentPageNumber, Math.max(1, s.pdf.pagesCount - count + 1));
    return Array.from({ length: Math.min(count, s.pdf.pagesCount) }, (_, index) => {
      const view = pageView(s, first + index)!;
      return { width: view.viewport.width / view.scale, height: view.viewport.height / view.scale };
    });
  }

  function zoomChoices(s: Session | null) {
    if (!s?.ready) return [];
    const choices: { pages: number; scale: number }[] = [];
    for (let pages = 1; pages <= s.pdf.pagesCount; pages++) {
      const scale = fitScale(viewportSize(), pageSizes(s, pages), settings.layout, settings.columns);
      choices.push({ pages, scale });
      if (scale <= MIN_SCALE) break;
    }
    return choices;
  }

  function emitState() {
    if (destroyed) return;
    const s = ready();
    const key = JSON.stringify([!!s, s?.pdf.currentPageNumber, s?.pdf.pagesCount, s?.pdf.currentScale,
      settings, container.clientWidth, container.clientHeight, geometryVersion]);
    if (key === lastStateKey) return;
    lastStateKey = key;
    callbacks.onState({
      loaded: !!s, page: s?.pdf.currentPageNumber ?? 0, pages: s?.pdf.pagesCount ?? 0,
      scale: s?.pdf.currentScale ?? settings.scale, layout: settings.layout,
      columns: settings.columns, zoomMode: settings.zoomMode, fitPages: settings.fitPages,
      scrollInput: settings.scrollInput, zoomChoices: zoomChoices(s),
    });
  }

  function capture(point?: { x: number; y: number }): Anchor | null {
    const s = ready();
    if (!s) return null;
    const box = container.getBoundingClientRect();
    const visible = s.pdf._getVisiblePages() as { views: { view: PDFPageView }[] };
    const x = point?.x ?? 0;
    const y = point?.y ?? 0;
    const pointed = point ? visible.views.map(item => item.view).find(item => {
      const rect = item.div.getBoundingClientRect();
      return box.left + x >= rect.left && box.left + x <= rect.right &&
        box.top + y >= rect.top && box.top + y <= rect.bottom;
    }) : undefined;
    // A preceding row's tiny sliver must not replace the reading anchor.
    const page = anchorPage(visible.views.map(item => Number(item.view.id)), s.pdf.currentPageNumber,
      pointed ? Number(pointed.id) : undefined);
    const view = pageView(s, page);
    if (!view) return null;
    const rect = view.div.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, box.left + x - rect.left));
    const localY = Math.max(0, Math.min(rect.height, box.top + y - rect.top));
    const [left, top] = view.viewport.convertToPdfPoint(localX, localY);
    return { page: Number(view.id), left: left!, top: top!, x: rect.left + localX - box.left, y: rect.top + localY - box.top };
  }

  function centerShortPage(s: Session, page = s.pdf.currentPageNumber) {
    const view = pageView(s, page);
    if (settings.layout === 'horizontal' && view && view.height <= container.clientHeight - 2 * VIEW_PADDING) {
      container.scrollTop = 0;
    }
  }

  function restore(anchor: Anchor | null) {
    const s = ready();
    if (!s || !anchor) return;
    const view = pageView(s, anchor.page);
    if (!view) return;
    const [x, y] = view.viewport.convertToViewportPoint(anchor.left, anchor.top);
    const box = container.getBoundingClientRect();
    const rect = view.div.getBoundingClientRect();
    container.scrollLeft += rect.left - box.left + x! - anchor.x;
    container.scrollTop += rect.top - box.top + y! - anchor.y;
    centerShortPage(s, anchor.page);
    s.pdf.update();
  }

  function getPosition(): ReadingPosition | null {
    const s = ready();
    const anchor = capture();
    return s && anchor ? {
      ...settings, page: anchor.page, scale: s.pdf.currentScale, left: anchor.left, top: anchor.top,
    } : null;
  }

  function saveSoon() {
    clearTimeout(positionTimer);
    const s = ready();
    if (!s || mutating) return;
    stableAnchor = capture();
    positionTimer = setTimeout(() => {
      if (!isCurrent(s)) return;
      const position = getPosition();
      if (position) callbacks.onPosition(position);
    }, 250);
  }

  function centerPage(view: PDFPageView) {
    // Reuse PDF.js's CSS dimension expression so zoom needs no per-page DOM loop.
    view.div.style.setProperty('--reader-page-height', view.div.style.height);
    session?.pageGeometry.set(Number(view.id), `${(view.viewport.width / view.scale).toFixed(3)}:${(view.viewport.height / view.scale).toFixed(3)}`);
  }

  function applyLayout(s: Session) {
    container.dataset.layout = settings.layout;
    container.dataset.scrollInput = settings.scrollInput;
    container.style.setProperty('--reader-columns', String(settings.columns));
    container.style.setProperty('--reader-viewport-height', `${container.clientHeight}px`);
    const mode = settings.layout === 'horizontal' ? ScrollMode.HORIZONTAL : ScrollMode.WRAPPED;
    s.pdf.scrollMode = mode;
    // PDF.js forces PAGE above 10,000 pages. Keep our continuous-layout contract.
    if (s.pdf.scrollMode !== mode) {
      s.pdf._previousScrollMode = s.pdf.scrollMode;
      s.pdf._scrollMode = mode;
      s.pdf._updateScrollMode();
      for (let i = 0; i < s.pdf.pagesCount; i++) viewer.append(pageView(s, i + 1)!.div);
    }
  }

  function selectedScale(s: Session): number {
    if (settings.zoomMode === 'height') return heightScale(container.clientHeight, pageSizes(s, 1)[0]!.height);
    if (settings.zoomMode === 'pages') {
      return fitScale(viewportSize(), pageSizes(s, settings.fitPages), settings.layout, settings.columns);
    }
    return settings.scale;
  }

  function changeScale(scale: number, anchor = capture()) {
    const s = ready();
    if (!s) return;
    mutating = true;
    s.pdf.updateScale({ scaleFactor: clampScale(scale) / s.pdf.currentScale, drawingDelay: 150 });
    settings.scale = s.pdf.currentScale;
    restore(anchor);
    mutating = false;
    emitState();
    saveSoon();
  }

  function refresh(anchor = capture()) {
    const s = ready();
    if (!s) return;
    mutating = true;
    applyLayout(s);
    if (settings.zoomMode !== 'custom') {
      s.pdf.updateScale({ scaleFactor: selectedScale(s) / s.pdf.currentScale, drawingDelay: 150 });
    }
    settings.scale = s.pdf.currentScale;
    restore(anchor);
    s.pdf.update();
    mutating = false;
    emitState();
    saveSoon();
  }

  function dispose(s: Session): Promise<void> {
    s.ready = false;
    s.searchActive = false;
    s.abort.abort();
    s.bus.dispatch('findbarclose', { source: controller });
    for (let page = 1; page <= s.pdf.pagesCount; page++) pageView(s, page)?.destroy();
    // Runtime supports null; upstream declarations omit the documented reset case.
    s.pdf.setDocument(null as unknown as PDFDocumentProxy);
    s.find.setDocument(null as unknown as PDFDocumentProxy);
    s.links.setDocument(null);
    s.targets.clear();
    const release = (async () => {
      try {
        await s.pdf.l10n?.destroy();
        const taskRelease = s.task?.destroy();
        // A crashed port cannot acknowledge Terminate; do not wait for its reply.
        if (s.workerFailed) void taskRelease?.catch(() => {});
        else await taskRelease;
      } finally {
        s.pdfWorker?.destroy();
        s.worker?.terminate();
      }
    })().catch(() => {
      // Worker teardown may reject after cancellation; the native port is still terminated.
    });
    releases.add(release);
    void release.finally(() => releases.delete(release));
    return release;
  }

  function detach() {
    clearTimeout(positionTimer);
    cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    stableAnchor = null;
    lastSmooth = lastPageWheel = -Infinity;
    lastStateKey = '';
    const previous = session;
    session = null;
    if (previous) void dispose(previous);
    container.scrollLeft = container.scrollTop = 0;
  }

  function resetCallbacks() {
    callbacks.onOutline([]);
    callbacks.onFind(emptyFind());
    emitState();
  }

  function makeSession(): Session {
    const abort = new AbortController();
    const bus = new EventBus();
    let s: Session;
    class SafeLinks extends PDFLinkService {
      override addLinkAttributes(link: HTMLAnchorElement, url: string) {
        link.href = '#';
        link.title = url;
        link.dataset.readerExternal = safeExternalUrl(url) ?? '';
        link.rel = 'noopener noreferrer';
      }
      override async goToDestination(dest: string | unknown[]) {
        const doc = s.document;
        if (!doc || !isCurrent(s)) return;
        try {
          const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
          if (!isCurrent(s) || !Array.isArray(explicit)) return;
          const ref = explicit[0];
          const page = typeof ref === 'number' ? ref + 1 : await doc.getPageIndex(ref) + 1;
          if (!isCurrent(s) || page < 1 || page > doc.numPages) return;
          s.pdf.scrollPageIntoView({ pageNumber: page, destArray: explicit, ignoreDestinationZoom: true });
          centerShortPage(s, page);
          saveSoon();
        } catch {
          if (isCurrent(s)) callbacks.onError('无法跳转到此目录或链接，PDF 中的目标可能已损坏。');
        }
      }
    }
    const links = new SafeLinks({ eventBus: bus, ignoreDestinationZoom: true });
    const find = new PDFFindController({ eventBus: bus, linkService: links });
    // 6.3.289 implements abortSignal, but its generated option types omit it.
    const options = {
      container, viewer, eventBus: bus, linkService: links, findController: find,
      abortSignal: abort.signal, annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE, removePageBorders: true,
      maxCanvasPixels: 4 * 1024 * 1024, maxCanvasDim: 8192, capCanvasAreaFactor: 100,
      enableDetailCanvas: true, enableOptimizedPartialRendering: false,
      imageResourcesPath: `${resources}images/`,
    };
    const pdf = new PDFViewer(options);
    links.setViewer(pdf);
    s = { abort, bus, pdf, links, find, ready: false, targets: new Map(), pageGeometry: new Map(), searchActive: false, findState: emptyFind() };
    const listen = (name: string, handler: (event: any) => void) => {
      bus.on(name, (event: unknown) => { if (isCurrent(s)) handler(event); }, { signal: abort.signal });
    };
    listen('updateviewarea', () => {
      if (!mutating) {
        if (s.searchActive) centerShortPage(s);
        emitState();
        saveSoon();
      }
    });
    listen('pagerender', ({ pageNumber }) => {
      const view = pageView(s, pageNumber);
      if (!view) return;
      const geometry = `${(view.viewport.width / view.scale).toFixed(3)}:${(view.viewport.height / view.scale).toFixed(3)}`;
      const changed = s.pageGeometry.get(pageNumber) !== geometry;
      centerPage(view);
      if (changed && s.ready) {
        geometryVersion++;
        queueMicrotask(() => { if (isCurrent(s)) refresh(stableAnchor); });
      }
    });
    listen('pagerendered', ({ error }) => { if (error) callbacks.onError(pdfErrorMessage(error)); });
    listen('pagesloaded', () => {
      if (!s.ready) return;
      for (let page = 1; page <= pdf.pagesCount; page++) centerPage(pageView(s, page)!);
      geometryVersion++;
      refresh(stableAnchor);
    });
    const findUpdate = (event: { state?: number; matchesCount?: { current: number; total: number } }) => {
      if (!s.searchActive) return;
      if (event.matchesCount) Object.assign(s.findState, event.matchesCount);
      if (event.state !== undefined) {
        s.findState.pending = event.state === PDFFindState.PENDING;
        s.findState.notFound = event.state === PDFFindState.NOT_FOUND;
      }
      callbacks.onFind({ ...s.findState });
    };
    listen('updatefindmatchescount', findUpdate);
    listen('updatefindcontrolstate', findUpdate);
    return s;
  }

  async function open(data: Uint8Array, position?: ReadingPosition) {
    if (destroyed) return;
    const token = ++generation;
    detach();
    settings = normalizePosition(position);
    resetCallbacks();
    if (destroyed || token !== generation) return;
    let s: Session | undefined;
    try {
      s = makeSession();
      session = s;
      const current = s;
      // Supplying a native port makes a failed worker an error, never a fake worker.
      s.worker = new Worker(workerUrl, { type: 'module' });
      const workerFailure = new Promise<never>((_, reject) => {
        s!.worker!.addEventListener('error', () => {
          current.workerFailed = true;
          const error = new Error('PDF module worker failed');
          error.name = 'WorkerError';
          reject(error);
          if (isCurrent(current) && current.ready) {
            callbacks.onError(pdfErrorMessage(error));
            detach();
            resetCallbacks();
          }
        }, { signal: s!.abort.signal });
      });
      const workerReady = new Promise<void>(resolve => {
        const onMessage = (event: MessageEvent) => {
          if (event.data?.action !== 'ready') return;
          current.worker!.removeEventListener('message', onMessage);
          resolve();
        };
        current.worker!.addEventListener('message', onMessage, { signal: current.abort.signal });
      });
      await untilAborted(Promise.race([workerReady, workerFailure]), s.abort.signal);
      if (!isCurrent(s)) return;
      // PDFWorker.create has the correctly generated Worker-port parameter type.
      s.pdfWorker = PDFWorker.create({ port: s.worker });
      // Eval-based compilation was removed in 6.3.289; retain the explicit policy.
      const documentOptions = {
        data, worker: s.pdfWorker, isEvalSupported: false, enableXfa: false,
        cMapUrl: `${resources}cmaps/`, cMapPacked: true,
        standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/`,
        useWasm: true,
      };
      s.task = getDocument(documentOptions);
      s.task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
        if (!isCurrent(current)) return;
        void (async () => {
          try {
            const password = await untilAborted(callbacks.onPassword(reason === PasswordResponses.INCORRECT_PASSWORD), current.abort.signal);
            if (!isCurrent(current)) return;
            if (password === null) { detach(); resetCallbacks(); }
            else updatePassword(password);
          } catch {
            if (isCurrent(current)) { callbacks.onError('未能获取 PDF 密码，请重新打开文件。'); detach(); resetCallbacks(); }
          }
        })();
      };
      const doc = await untilAborted(Promise.race([s.task.promise, workerFailure]), s.abort.signal);
      if (token !== generation || !isCurrent(s)) return;
      s.document = doc;
      s.links.setDocument(doc);
      const initialized = new Promise<void>(resolve => s!.bus.on('pagesinit', resolve, { once: true, signal: s!.abort.signal }));
      s.pdf.setDocument(doc);
      // pagesPromise rejects if first-page initialization fails; it need not finish first.
      const initFailure = s.pdf.pagesPromise.then(() => new Promise<never>(() => {}));
      await untilAborted(Promise.race([initialized, initFailure, workerFailure]), s.abort.signal);
      if (!isCurrent(s)) return;
      const page = Math.min(settings.page, doc.numPages);
      const targetPage = await untilAborted(doc.getPage(page), s.abort.signal);
      if (!isCurrent(s)) return;
      const targetView = pageView(s, page)!;
      if (!targetView.pdfPage) targetView.setPdfPage(targetPage);
      for (let number = 1; number <= s.pdf.pagesCount; number++) centerPage(pageView(s, number)!);
      s.ready = true;
      mutating = true;
      applyLayout(s);
      s.pdf.currentPageNumber = page;
      s.pdf.currentScale = selectedScale(s);
      settings.scale = s.pdf.currentScale;
      s.pdf.scrollPageIntoView({ pageNumber: page });
      centerShortPage(s, page);
      if (settings.left !== undefined && settings.top !== undefined) {
        restore({ page, left: settings.left, top: settings.top, x: 0, y: 0 });
      }
      mutating = false;
      s.pdf.update();
      emitState();
      saveSoon();
      const outline = await untilAborted(doc.getOutline(), s.abort.signal).catch(error => {
        if (isCurrent(current)) callbacks.onError('PDF 已打开，但无法读取文档目录。');
        if (current.abort.signal.aborted) throw error;
        return null;
      });
      if (!isCurrent(s)) return;
      type PDFOutline = NonNullable<typeof outline>;
      const entries = (items: PDFOutline): OutlineEntry[] => items.map(item => {
        const target = Symbol('outline');
        current.targets.set(target, { dest: item.dest, url: item.url });
        return { title: item.title, children: entries(item.items), target };
      });
      callbacks.onOutline(entries(outline ?? []));
    } catch (error) {
      mutating = false;
      if (token !== generation || destroyed || (s && !isCurrent(s))) return;
      callbacks.onError(pdfErrorMessage(error));
      detach();
      resetCallbacks();
    }
  }

  function wheel(event: WheelEvent) {
    const s = ready();
    if (!s || event.defaultPrevented || !event.cancelable) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"]')) return;
    const selection = window.getSelection();
    if (event.buttons || (selection && !selection.isCollapsed && selection.anchorNode && viewer.contains(selection.anchorNode))) return;
    const [dx, dy] = wheelPixels(event, container.clientHeight);
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const box = container.getBoundingClientRect();
      settings.zoomMode = 'custom';
      changeScale(s.pdf.currentScale * Math.exp(-dy * 0.002), capture({ x: event.clientX - box.left, y: event.clientY - box.top }));
      return;
    }
    if (settings.layout !== 'horizontal') return;
    if (event.shiftKey) {
      event.preventDefault();
      container.scrollTop += dy || dx;
      return;
    }
    if (dx) return; // Preserve native horizontal/diagonal touchpad momentum.
    const view = pageView(s, s.pdf.currentPageNumber);
    if (view && view.height > container.clientHeight - 2 * VIEW_PADDING) {
      const rect = view.div.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      if ((dy > 0 && rect.bottom > box.bottom - VIEW_PADDING + 1) ||
          (dy < 0 && rect.top < box.top + VIEW_PADDING - 1)) {
        event.preventDefault();
        container.scrollTop += dy;
        return;
      }
    }
    event.preventDefault();
    const now = performance.now();
    const discrete = isPageWheel(settings.scrollInput, event, now - lastSmooth < 180);
    if (!discrete) {
      lastSmooth = now;
      container.scrollLeft += dy;
      return;
    }
    if (now - lastPageWheel < 180) return;
    lastPageWheel = now;
    const extents = Array.from({ length: s.pdf.pagesCount }, (_, index) => {
      const page = pageView(s, index + 1)!;
      return { start: page.div.offsetLeft, size: page.width };
    });
    container.scrollTo({ left: pageStep(extents, container.scrollLeft, container.clientWidth, Math.sign(dy)), behavior: 'instant' });
  }

  const resize = new ResizeObserver(() => {
    if (resizeFrame || !ready()) return;
    const anchor = stableAnchor;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; refresh(anchor); });
  });
  resize.observe(container);
  container.addEventListener('wheel', wheel, { passive: false, signal: lifetime.signal });
  const externalClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-reader-external]') : null;
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const url = safeExternalUrl(link.dataset.readerExternal ?? '');
    if (ready() && url && (event.type === 'click' || event.button === 1)) callbacks.onExternalLink(url);
  };
  container.addEventListener('click', externalClick, { capture: true, signal: lifetime.signal });
  container.addEventListener('auxclick', externalClick, { capture: true, signal: lifetime.signal });

  const controller: ReaderController = {
    open,
    async close() {
      if (destroyed) return;
      ++generation;
      detach();
      resetCallbacks();
      await Promise.all([...releases]);
    },
    async destroy() {
      if (destroyed) { await Promise.all([...releases]); return; }
      ++generation;
      destroyed = true;
      lifetime.abort();
      resize.disconnect();
      detach();
      await Promise.all([...releases]);
    },
    setLayout(mode) {
      if (destroyed || !['horizontal', 'vertical'].includes(mode)) return;
      const anchor = capture();
      settings.layout = mode;
      refresh(anchor);
      if (!ready()) emitState();
    },
    setColumns(columns) {
      if (destroyed) return;
      const anchor = capture();
      settings.columns = positiveInteger(columns);
      refresh(anchor);
      if (!ready()) emitState();
    },
    setScale(scale) {
      if (destroyed || !Number.isFinite(scale) || scale <= 0) return;
      settings.zoomMode = 'custom';
      settings.scale = clampScale(scale);
      changeScale(settings.scale);
    },
    fitHeight() {
      settings.zoomMode = 'height';
      const s = ready();
      if (s) changeScale(selectedScale(s));
    },
    fitPageCount(count) {
      settings.zoomMode = 'pages';
      settings.fitPages = positiveInteger(count);
      const s = ready();
      if (s) changeScale(selectedScale(s));
    },
    setScrollInput(input) {
      if (destroyed || !['auto', 'page', 'smooth'].includes(input)) return;
      settings.scrollInput = input;
      container.dataset.scrollInput = input;
      emitState();
      saveSoon();
    },
    goToPage(page) {
      const s = ready();
      if (!s || !Number.isFinite(page)) return;
      s.pdf.currentPageNumber = Math.min(s.pdf.pagesCount, positiveInteger(page));
      if (settings.zoomMode !== 'custom') refresh();
      else { centerShortPage(s); emitState(); saveSoon(); }
    },
    zoomBy(factor) {
      const s = ready();
      if (s && Number.isFinite(factor) && factor > 0) controller.setScale(s.pdf.currentScale * factor);
    },
    find(query, options = {}) {
      const s = ready();
      if (!s) return;
      if (!query) { controller.closeFind(); return; }
      s.searchActive = true;
      s.bus.dispatch('find', {
        source: controller, type: options.again ? 'again' : '', query,
        caseSensitive: false, entireWord: false, highlightAll: true,
        findPrevious: options.previous ?? false, matchDiacritics: false,
      });
    },
    closeFind() {
      const s = ready();
      if (!s) return;
      s.searchActive = false;
      s.bus.dispatch('findbarclose', { source: controller });
      s.findState = emptyFind();
      callbacks.onFind(emptyFind());
    },
    async goToOutline(target) {
      const s = ready();
      const entry = s?.targets.get(target);
      if (!s || !entry) return;
      const url = entry.url ? safeExternalUrl(entry.url) : null;
      if (url) callbacks.onExternalLink(url);
      else if (entry.dest) await s.links.goToDestination(entry.dest);
    },
    refreshLayout() { refresh(stableAnchor ?? capture()); },
    getPosition,
  };
  container.dataset.layout = settings.layout;
  container.dataset.scrollInput = settings.scrollInput;
  queueMicrotask(() => { if (!session && !destroyed) emitState(); });
  return controller;
}
