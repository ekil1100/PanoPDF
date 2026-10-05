// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { createEpubReader } from '../src/epub-reader';
import type { ReaderCallbacks, ReadingPosition } from '../src/contracts';
import { epubFixture } from './epub-fixture';

const position: ReadingPosition = {
  page: 2,
  scale: 1,
  layout: 'horizontal',
  columns: 1,
  zoomMode: 'custom',
  fitPages: 1,
  scrollInput: 'auto',
  epub: { chapter: 'OPS/chapters/two.xhtml', progress: 0.65 },
};
const revokeObjectURL = vi.fn();
const callbacks = () =>
  ({
    onState: vi.fn(),
    onPosition: vi.fn(),
    onOutline: vi.fn(),
    onFind: vi.fn(),
    onError: vi.fn(),
    onPassword: vi.fn(),
    onExternalLink: vi.fn(),
  }) satisfies ReaderCallbacks;
beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('CSS', { highlights: new Map() });
  vi.stubGlobal('Highlight', class {});
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:fixture'), revokeObjectURL }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('keeps the saved content anchor while mounting and releases all pagination resources', async () => {
  const container = document.createElement('div');
  const viewer = document.createElement('div');
  container.append(viewer);
  document.body.append(container);
  Object.defineProperties(container, {
    clientWidth: { value: 1280 },
    clientHeight: { value: 800 },
  });
  const cb = callbacks();
  const reader = createEpubReader(container, viewer, cb);
  const saved = {
    ...position,
    epub: { chapter: 'OPS/chapters/two.xhtml', progress: 0.65, offset: 200 },
  };
  await reader.open(await epubFixture(), saved);
  expect(reader.getPosition()?.epub).toEqual(saved.epub);
  expect(container.dataset.layout).toBe('horizontal');
  expect(viewer.querySelectorAll('.epub-section')).toHaveLength(2);
  reader.setScale(1.5);
  expect(reader.getPosition()?.epub).toEqual(saved.epub);
  expect(reader.getPosition()?.scale).toBe(1.5);
  await reader.destroy();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
  expect(container.dataset.format).toBeUndefined();
  expect(viewer.style.getPropertyValue('--epub-scale')).toBe('');
  expect(viewer.children).toHaveLength(0);
});

it('cancels in-flight opening and releases the host without late loaded state', async () => {
  const bytes = await epubFixture();
  const container = document.createElement('div');
  const viewer = document.createElement('div');
  container.append(viewer);
  const cb = callbacks();
  const reader = createEpubReader(container, viewer, cb);
  const opened = reader.open(bytes);
  const settled = opened.then(
    () => 'completed',
    () => 'interrupted',
  );
  await reader.destroy();
  expect(await settled).toBe('interrupted');
  expect(cb.onState.mock.calls.some(([state]) => state.loaded)).toBe(false);
  expect(cb.onError).not.toHaveBeenCalled();
  expect(viewer.childNodes.length).toBe(0);
});

it('searches across chapters, wraps next/previous, clears highlights and follows local links', async () => {
  const container = document.createElement('div');
  const viewer = document.createElement('div');
  container.append(viewer);
  document.body.append(container);
  const cb = callbacks();
  const reader = createEpubReader(container, viewer, cb);
  // jsdom has no Range geometry; the search/navigation behavior is independent of it.
  Range.prototype.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  await reader.open(await epubFixture());
  reader.find('PANORAMA');
  expect(cb.onFind).toHaveBeenLastCalledWith({
    current: 1,
    total: 2,
    pending: false,
    notFound: false,
  });
  reader.find('PANORAMA', { again: true });
  expect(reader.getPosition()?.page).toBe(2);
  reader.find('PANORAMA', { again: true });
  expect(reader.getPosition()?.page).toBe(1);
  reader.find('PANORAMA', { again: true, previous: true });
  expect(reader.getPosition()?.page).toBe(2);
  reader.closeFind();
  expect(CSS.highlights.size).toBe(0);
  reader.find('missing');
  expect(cb.onFind).toHaveBeenLastCalledWith({
    current: 0,
    total: 0,
    pending: false,
    notFound: true,
  });
  reader.goToPage(1);
  viewer.querySelector<HTMLAnchorElement>('[data-epub-target]')!.click();
  expect(reader.getPosition()?.page).toBe(2);
  expect(viewer.textContent).toContain('Second chapter');
  await reader.destroy();
});
