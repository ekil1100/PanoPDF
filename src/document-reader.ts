import { Effect } from 'effect';
import type { ReaderCallbacks, ReaderController } from './contracts';
import { createReader as createPdfReader } from './reader';
import { createEpubReader } from './epub-reader';

/** One backend owns the host at a time, including event listeners and observers. */
export function createReader(
  container: HTMLDivElement,
  viewer: HTMLDivElement,
  callbacks: ReaderCallbacks,
): ReaderController {
  let current: ReaderController | undefined;
  let destroyed = false;
  let generation = 0;
  const release = () => {
    const previous = current;
    current = undefined;
    return Effect.promise(() => previous?.destroy() ?? Promise.resolve()).pipe(
      Effect.andThen(
        Effect.sync(() => {
          viewer.replaceChildren();
          viewer.className = 'pdfViewer';
          delete container.dataset.format;
        }),
      ),
    );
  };
  const controller: ReaderController = {
    open(data, position, format = 'pdf') {
      const token = ++generation;
      return Effect.runPromise(
        release().pipe(
          Effect.andThen(
            Effect.suspend(() => {
              if (destroyed || token !== generation) return Effect.void;
              current = (format === 'epub' ? createEpubReader : createPdfReader)(
                container,
                viewer,
                callbacks,
              );
              return Effect.promise(() => current!.open(data, position));
            }),
          ),
        ),
      );
    },
    close() {
      ++generation;
      return Effect.runPromise(release());
    },
    destroy() {
      destroyed = true;
      ++generation;
      return Effect.runPromise(release());
    },
    setLayout: (value) => current?.setLayout(value),
    setColumns: (value) => current?.setColumns(value),
    setScale: (value) => current?.setScale(value),
    fitHeight: () => current?.fitHeight(),
    fitPageCount: (value) => current?.fitPageCount(value),
    setScrollInput: (value) => current?.setScrollInput(value),
    goToPage: (value) => current?.goToPage(value),
    zoomBy: (value) => current?.zoomBy(value),
    find: (query, options) => current?.find(query, options),
    closeFind: () => current?.closeFind(),
    goToOutline: (target) => current?.goToOutline(target) ?? Effect.runPromise(Effect.void),
    refreshLayout: () => current?.refreshLayout(),
    getPosition: () => current?.getPosition() ?? null,
  };
  return controller;
}
