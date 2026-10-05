import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { Effect } from 'effect';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { epubFixture } from '../epub-fixture';
import type { ReadingPosition } from '../../src/contracts';

const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (error) => error });
interface Session {
  page: Page;
  app: ElectronApplication;
  directory: string;
}
const withBook = (use: (session: Session) => Effect.Effect<unknown, unknown>) =>
  Effect.runPromise(
    Effect.acquireUseRelease(
      io(() => mkdtemp(path.join(tmpdir(), 'pano-pagination-'))).pipe(
        Effect.flatMap((directory) => io(() => realpath(directory))),
      ),
      (directory) =>
        io(() => epubFixture()).pipe(
          Effect.flatMap((bytes) => io(() => writeFile(path.join(directory, 'pages.epub'), bytes))),
          Effect.andThen(
            Effect.acquireUseRelease(
              io(() => {
                const env: NodeJS.ProcessEnv = {
                  ...process.env,
                  PANO_TEST_MODE: '1',
                  PANO_USER_DATA: directory,
                };
                delete env.ELECTRON_RUN_AS_NODE;
                delete env.PANO_DEV_SERVER_URL;
                return electron.launch({
                  args: ['.', path.join(directory, 'pages.epub')],
                  env: Object.fromEntries(
                    Object.entries(env).filter(
                      (entry): entry is [string, string] => entry[1] !== undefined,
                    ),
                  ),
                });
              }),
              (app) =>
                io(() => app.firstWindow()).pipe(
                  Effect.tap((page) =>
                    Effect.sync(() =>
                      page.on('dialog', (dialog) => {
                        if (dialog.type() !== 'beforeunload') void dialog.dismiss();
                      }),
                    ),
                  ),
                  Effect.tap((page) => io(() => expect(page.locator('#pageNumber')).toBeEnabled())),
                  Effect.flatMap((page) => use({ page, app, directory })),
                ),
              (app) =>
                io(() =>
                  app.evaluate(({ BrowserWindow }) =>
                    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
                  ),
                ).pipe(Effect.andThen(io(() => app.close()))),
            ),
          ),
        ),
      (directory) => io(() => rm(directory, { recursive: true, force: true })),
    ),
  );
const jump = (page: Page, value: number) =>
  io(() => page.locator('#pageNumber').fill(String(value))).pipe(
    Effect.andThen(io(() => page.locator('#pageNumber').press('Enter'))),
    Effect.andThen(io(() => expect(page.locator('#pageNumber')).toHaveValue(String(value)))),
  );
const close = (page: Page) =>
  io(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')).pipe(
    Effect.andThen(io(() => expect(page.locator('#emptyState')).toBeVisible())),
  );
const saved = (directory: string) =>
  io(() => readFile(path.join(directory, 'settings.json'), 'utf8')).pipe(
    Effect.map((json) => JSON.parse(json).recents[0].position as ReadingPosition),
  );
const reopen = (page: Page) =>
  io(() => page.getByRole('button', { name: /pages.epub/ }).click()).pipe(
    Effect.andThen(io(() => expect(page.locator('#pageNumber')).toBeEnabled())),
  );
const anchorOnLeadingPage = (page: Page, position: ReadingPosition) =>
  page.evaluate((anchor) => {
    const host = [...document.querySelectorAll<HTMLElement>('.epub-section')].find(
      (node) => node.dataset.chapter === anchor!.chapter,
    )!;
    const article = host.querySelector('.epub-chapter')!;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let offset = anchor!.offset!;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent!.length;
      if (offset >= length) {
        offset -= length;
        continue;
      }
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getClientRects()[0];
      const container = document.getElementById('viewerContainer')!.getBoundingClientRect();
      const width = document.querySelector('.epub-page')!.getBoundingClientRect().width;
      return (
        !!rect &&
        rect.left >= container.left &&
        rect.right <= container.left + width + 16 &&
        rect.top >= container.top &&
        rect.bottom <= container.bottom
      );
    }
    return false;
  }, position.epub);

test('EPUB lays out consecutive pages horizontally and scrolls across chapter boundaries', () =>
  withBook(({ page }) =>
    io(() =>
      page.evaluate(() => {
        const container = document.getElementById('viewerContainer')!;
        const frames = [...document.querySelectorAll('.epub-page')];
        const boxes = frames.slice(0, 3).map((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        return {
          count: frames.length,
          boxes,
          viewport: container.clientWidth,
          verticalOverflow: container.scrollHeight - container.clientHeight,
        };
      }),
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.count).toBeGreaterThan(3);
          expect(result.boxes[1]!.x).toBeCloseTo(result.boxes[0]!.x + result.boxes[0]!.width + 16);
          expect(result.boxes[2]!.y).toBe(result.boxes[0]!.y);
          expect(result.boxes[1]!.x + result.boxes[1]!.width).toBeLessThan(result.viewport);
          expect(result.verticalOverflow).toBeLessThanOrEqual(1);
        }),
      ),
      Effect.andThen(io(() => page.locator('#viewerContainer').focus())),
      Effect.andThen(io(() => page.keyboard.press('ArrowRight'))),
      Effect.andThen(io(() => expect(page.locator('#pageNumber')).toHaveValue('2'))),
      Effect.andThen(
        io(() =>
          page.locator('#viewerContainer').evaluate((node) =>
            node.dispatchEvent(
              new WheelEvent('wheel', {
                deltaY: 120,
                deltaMode: 1,
                bubbles: true,
                cancelable: true,
              }),
            ),
          ),
        ),
      ),
      Effect.andThen(io(() => expect(page.locator('#pageNumber')).toHaveValue('3'))),
      Effect.andThen(
        io(() =>
          page.locator('#viewerContainer').evaluate((node) =>
            node.dispatchEvent(
              new WheelEvent('wheel', {
                deltaX: 70.5,
                deltaY: 0,
                bubbles: true,
                cancelable: true,
              }),
            ),
          ),
        ),
      ),
      Effect.andThen(
        io(() =>
          page.locator('#viewerContainer').evaluate((node) => ({
            left: node.scrollLeft,
            stride: document.querySelector('.epub-page')!.getBoundingClientRect().width + 16,
          })),
        ),
      ),
      Effect.tap(({ left, stride }) =>
        Effect.sync(() => expect(left).toBeCloseTo(2 * stride + 70.5, 0)),
      ),
      Effect.andThen(io(() => page.keyboard.press('End'))),
      Effect.andThen(io(() => page.locator('.epub-page').count())),
      Effect.flatMap((count) =>
        io(() => expect(page.locator('#pageNumber')).toHaveValue(String(count))),
      ),
    ),
  ));

test('EPUB reflows on font and viewport changes without losing its text anchor', () =>
  withBook(({ page, app, directory }) =>
    jump(page, 5).pipe(
      Effect.andThen(close(page)),
      Effect.andThen(saved(directory)),
      Effect.tap((position) => Effect.sync(() => expect(position.epub?.offset).toBeGreaterThan(0))),
      Effect.flatMap((position) =>
        reopen(page).pipe(
          Effect.andThen(io(() => page.locator('.epub-page').count())),
          Effect.flatMap((before) =>
            io(() => page.locator('#zoomPercent').fill('150%')).pipe(
              Effect.andThen(io(() => page.locator('#zoomPercent').press('Enter'))),
              Effect.andThen(
                io(() =>
                  expect.poll(() => page.locator('.epub-page').count()).toBeGreaterThan(before),
                ),
              ),
            ),
          ),
          Effect.andThen(
            io(() => expect.poll(() => anchorOnLeadingPage(page, position)).toBe(true)),
          ),
          Effect.andThen(
            io(() =>
              app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0]!.setSize(980, 640),
              ),
            ),
          ),
          Effect.andThen(
            io(() =>
              expect
                .poll(() =>
                  page
                    .locator('.epub-page')
                    .first()
                    .evaluate((node) => node.getBoundingClientRect().height),
                )
                .toBeLessThan(620),
            ),
          ),
          Effect.andThen(
            io(() => expect.poll(() => anchorOnLeadingPage(page, position)).toBe(true)),
          ),
          Effect.andThen(close(page)),
          Effect.andThen(saved(directory)),
          Effect.tap((after) =>
            Effect.sync(() => {
              expect(after.epub?.chapter).toBe(position.epub?.chapter);
              expect(after.epub?.offset).toBe(position.epub?.offset);
              expect(after.scale).toBe(1.5);
            }),
          ),
          Effect.andThen(reopen(page)),
          Effect.andThen(
            io(() => expect.poll(() => anchorOnLeadingPage(page, position)).toBe(true)),
          ),
        ),
      ),
    ),
  ));

test('EPUB search targets the matching page and selection spans column boundaries', () =>
  withBook(({ page }) =>
    io(() => page.locator('#searchToggle').click()).pipe(
      Effect.andThen(io(() => page.locator('#searchQuery').fill('Reading paragraph 65'))),
      Effect.andThen(io(() => expect(page.locator('#findCount')).toHaveText('1 / 1 处'))),
      Effect.andThen(
        io(() =>
          page.evaluate(() => {
            const range = [...CSS.highlights.get('epub-current')!][0]! as Range;
            const rect = range.getClientRects()[0]!;
            const host = document.getElementById('viewerContainer')!.getBoundingClientRect();
            return rect.left >= host.left && rect.right <= host.right;
          }),
        ),
      ),
      Effect.tap((visible) => Effect.sync(() => expect(visible).toBe(true))),
      Effect.andThen(
        io(() =>
          page.evaluate(() => {
            const article = document.querySelectorAll('.epub-chapter')[1]!;
            const range = document.createRange();
            range.selectNodeContents(article);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            const text = selection.toString();
            selection.removeAllRanges();
            return text;
          }),
        ),
      ),
      Effect.tap((text) =>
        Effect.sync(() => {
          expect(text).toContain('Reading paragraph 1:');
          expect(text).toContain('Reading paragraph 80:');
          expect(text.match(/Reading paragraph 65:/g)).toHaveLength(1);
        }),
      ),
    ),
  ));
