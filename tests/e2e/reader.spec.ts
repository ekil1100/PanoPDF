import { _electron as electron, chromium, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { encryptedFixture, fixturePassword, readerFixture, scannedFixture } from './fixtures';

let directory: string;
let application: ElectronApplication | undefined;
let documentA: string;
let documentB: string;
const initialPosition = {
  page: 1,
  scale: 1,
  layout: 'horizontal',
  columns: 1,
  zoomMode: 'custom',
  fitPages: 1,
  scrollInput: 'auto',
};

test.beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'panopdf-e2e-')));
  documentA = path.join(directory, 'a.pdf');
  documentB = path.join(directory, 'b.pdf');
  const data = await readerFixture();
  await writeFile(documentA, data);
  await writeFile(documentB, data);
});

test.afterEach(async () => {
  if (application) {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await application.close().catch(() => {});
    application = undefined;
  }
  await rm(directory, { recursive: true, force: true });
});

async function launch(file?: string): Promise<Page> {
  const env: NodeJS.ProcessEnv = { ...process.env, PANO_TEST_MODE: '1', PANO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PANO_DEV_SERVER_URL;
  application = await electron.launch({
    args: ['.', ...(file ? [file] : [])],
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  });
  const page = await application.firstWindow();
  // Electron handles beforeunload without a browser confirmation; prevent Playwright's auto-dismiss race.
  page.on('dialog', (dialog) => {
    if (dialog.type() !== 'beforeunload') void dialog.dismiss();
  });
  await expect(page.locator('#fileMenuButton')).toBeVisible();
  return page;
}
async function jump(page: Page, target: number) {
  await page.locator('#pageNumber').fill(String(target));
  await page.locator('#pageNumber').press('Enter');
  await expect(page.locator('#pageNumber')).toHaveValue(String(target));
}

test('offline desktop reading, selection, search, outline, layouts, and restoration', async ({}, testInfo) => {
  const page = await launch(documentA);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('#pageTotal')).toHaveText('/ 12');
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await page.locator('#zoomMode').selectOption('pages-3');
  await expect(page.locator('#viewer .page canvas').first()).toBeVisible();
  await expect(page.locator('#viewer .textLayer').first()).toContainText('panorama');
  await expect(page.locator('#viewer .textLayer').first()).toBeVisible();
  expect(
    await page.evaluate(() => {
      const layer = document.querySelector('#viewer .textLayer')!;
      const range = document.createRange();
      range.selectNodeContents(layer);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    }),
  ).toContain('panorama');
  const center = await page.evaluate(() => {
    const container = document.getElementById('viewerContainer')!;
    const host = container.getBoundingClientRect();
    const first = document.querySelector('#viewer .page')!.getBoundingClientRect();
    return Math.abs(host.top + container.clientHeight / 2 - (first.top + first.bottom) / 2);
  });
  expect(center).toBeLessThan(2);

  // Every renderer asset is local, including the annotation images and WASM.
  const assets = await page.evaluate(async () =>
    Promise.all(
      [
        'pdfjs/images/annotation-comment.svg',
        'pdfjs/wasm/openjpeg.wasm',
        'pdfjs/standard_fonts/FoxitSerif.pfb',
      ].map(async (url) => {
        const response = await fetch(url);
        return {
          ok: response.ok,
          length: (await response.arrayBuffer()).byteLength,
          type: response.headers.get('content-type'),
        };
      }),
    ),
  );
  expect(assets.every((asset) => asset.ok && asset.length > 0)).toBe(true);
  expect(assets[0].type).toBe('image/svg+xml');
  expect(
    await page.evaluate(() => ({ node: typeof (window as any).require, bridge: !!window.panopdf })),
  ).toEqual({ node: 'undefined', bridge: true });

  await page.locator('#searchToggle').click();
  await page.locator('#searchQuery').fill('panorama');
  await expect(page.locator('#findCount')).toContainText('/ 12 处');
  await page.locator('#nextFind').click();
  await expect(page.locator('#findCount')).toHaveText('2 / 12 处');
  await page.locator('#searchQuery').fill('missing-search-phrase');
  await expect(page.locator('#findCount')).toHaveText('未找到匹配');
  await expect(page.locator('#nextFind')).toBeDisabled();
  await page.locator('#outlineTab').click();
  await page.getByRole('button', { name: 'Chapter four', exact: true }).click();
  await expect(page.locator('#pageNumber')).toHaveValue('4');
  await page.locator('#closePanel').click();

  await page.locator('#layoutMode').selectOption('vertical');
  await page.locator('#columns').fill('3');
  await page.locator('#columns').press('Enter');
  await jump(page, 1);
  const rows = await page
    .locator('#viewer .page')
    .evaluateAll((pages) => pages.slice(0, 4).map((page) => page.getBoundingClientRect().top));
  expect(rows[0]).toBeCloseTo(rows[1]);
  expect(rows[1]).toBeCloseTo(rows[2]);
  expect(rows[3]).toBeGreaterThan(rows[2]);
  await page.screenshot({ path: testInfo.outputPath('vertical.png') });

  await page.locator('#layoutMode').selectOption('horizontal');
  await page.locator('#zoomPercent').fill('55%');
  await page.locator('#zoomPercent').press('Enter');
  await jump(page, 7);
  await page.screenshot({ path: testInfo.outputPath('horizontal.png') });
  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#emptyState')).toBeVisible();
  await page.getByRole('button', { name: /a.pdf/ }).click();
  await expect(page.locator('#pageNumber')).toHaveValue('7');
  await expect(page.locator('#zoomPercent')).toHaveValue('55%');
  expect(errors).toEqual([]);
});

test('queued native reopening preserves newer unsaved reading position', async () => {
  const id = randomUUID();
  const settingsPath = path.join(directory, 'settings.json');
  await writeFile(
    settingsPath,
    JSON.stringify({
      version: 1,
      recents: [{ id, path: documentA, lastOpened: Date.now(), position: initialPosition }],
    }),
  );
  const page = await launch();
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect
    .poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).recents[0].position?.page)
    .toBe(1);
  await application!.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const send = contents.send.bind(contents);
    (globalThis as any).testNativeEvents = [];
    contents.send = (channel, ...args) => {
      if (channel === 'pano:file') (globalThis as any).testNativeEvents.push(args[0].name);
      return send(channel, ...args);
    };
  });
  const busyStarted = page.waitForEvent('console', {
    predicate: (message) => message.text() === 'Test renderer busy',
  });
  const busy = page.evaluate(() => {
    const input = document.getElementById('pageNumber') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('change'));
    console.log('Test renderer busy');
    // Model a complex PDF long task while the main process handles OS open events.
    const until = performance.now() + 1500;
    while (performance.now() < until) {
      /* Keep the renderer occupied. */
    }
  });
  await busyStarted;
  await application!.evaluate(
    ({ app }, files) => {
      for (const file of files) app.emit('open-file', { preventDefault() {} }, file);
    },
    [documentB, documentA],
  );
  await busy;
  await expect
    .poll(() => application!.evaluate(() => (globalThis as any).testNativeEvents))
    .toEqual(['b.pdf', 'a.pdf']);
  await expect(page.locator('#filename')).toHaveText('a.pdf');
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect(page.locator('#pageNumber')).toHaveValue('7');
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(settingsPath, 'utf8')).recents.find(
          (entry: { id: string }) => entry.id === id,
        ).position.page,
    )
    .toBe(7);
});

test('quitting immediately after navigation flushes the final position', async () => {
  const page = await launch(documentA);
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await jump(page, 8);
  const closed = application!.waitForEvent('close');
  await application!.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  await closed;
  application = undefined;
  const settings = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  expect(
    settings.recents.find((entry: { path: string }) => entry.path === documentA).position.page,
  ).toBe(8);
});

async function quitApplication() {
  const closing = application!.waitForEvent('close');
  await application!.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  await closing;
  application = undefined;
}
async function seedRecent(file: string, page = 1) {
  await writeFile(
    path.join(directory, 'settings.json'),
    JSON.stringify({
      version: 1,
      hasLaunched: true,
      recents: [
        {
          id: randomUUID(),
          path: file,
          lastOpened: Date.now(),
          position: { ...initialPosition, page },
        },
      ],
    }),
  );
}

test('first launch shows guidance once and keeps the toolbar out of the welcome screen', async ({}, testInfo) => {
  let page = await launch();
  await expect(page.locator('#welcomeGuide')).toBeVisible();
  await expect(page.locator('#emptyTitle')).toHaveText('欢迎使用 PanoPDF');
  await expect(page.locator('#openShortcut')).toHaveText(
    process.platform === 'darwin' ? '⌘ O' : 'Ctrl O',
  );
  await expect(page.locator('#readerToolbar')).toBeHidden();
  await expect(page.locator('.document-bar')).toHaveCount(0);
  await expect(page.locator('#openFile')).toBeHidden();
  await expect(page.locator('#emptyOpen')).toBeEnabled();
  await application!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1440, 900),
  );
  await page.screenshot({ path: testInfo.outputPath('welcome-1440.png') });
  await application!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(800, 560),
  );
  await page.screenshot({ path: testInfo.outputPath('welcome-800.png') });
  await quitApplication();
  page = await launch();
  await expect(page.locator('#emptyOpen')).toBeEnabled();
  await expect(page.locator('#welcomeGuide')).toBeHidden();
  await expect(page.locator('#emptyTitle')).toHaveText('PanoPDF');
});

test('next application launch automatically restores the last document and reading position', async () => {
  let page = await launch(documentA);
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await jump(page, 6);
  await quitApplication();
  page = await launch();
  await expect(page.locator('#filename')).toHaveText('a.pdf');
  await expect(page.locator('#pageNumber')).toHaveValue('6');
  await expect(page.locator('#welcomeGuide')).toBeHidden();
  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#readerToolbar')).toBeHidden();
  // Closing a document does not immediately reopen it in the same window.
  expect(await page.evaluate(async () => (await window.panopdf!.getStartup()).file)).toBeNull();
  await expect(page.locator('#emptyState')).toBeVisible();
});

test('an explicit startup file wins over the previous document', async () => {
  await seedRecent(documentA, 7);
  const page = await launch(documentB);
  await expect(page.locator('#filename')).toHaveText('b.pdf');
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect(page.locator('#pageNumber')).toHaveValue('1');
  const settings = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  expect(
    settings.recents.find((entry: { path: string }) => entry.path === documentA).position.page,
  ).toBe(7);
});

test('missing last file is recoverable through the file menu and custom window controls work', async ({}, testInfo) => {
  await seedRecent(path.join(directory, 'missing.pdf'));
  const page = await launch();
  await expect(page.locator('#noticeText')).toContainText('文件已移动或删除');
  await expect(page.locator('#emptyOpen')).toBeEnabled();
  await application!.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, documentA);
  await page.locator('#fileMenuButton').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#fileMenu')).toBeVisible();
  await expect(page.locator('#openFile')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fileMenu')).toBeHidden();
  await expect(page.locator('#fileMenuButton')).toBeFocused();
  await page.locator('#fileMenuButton').click();
  await page.locator('#openFile').click();
  await expect(page.locator('#filename')).toHaveText('a.pdf');
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect(page.locator('#fileMenu')).toBeHidden();
  await page.locator('#dismissNotice').click();
  await page.locator('#zoomMode').selectOption('pages-3');
  await page.screenshot({ path: testInfo.outputPath('custom-titlebar-reader.png') });

  expect(
    await page
      .locator('#titlebar')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
  ).toBe('drag');
  expect(
    await page
      .locator('#fileMenuButton')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
  ).toBe('no-drag');
  // Small CI displays can start with a screen-sized window. Establish the normal state first.
  await application!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.unmaximize();
    window.setSize(800, 560);
  });
  await expect
    .poll(() => page.evaluate(() => window.panopdf!.getWindowState()))
    .toMatchObject({ maximized: false });
  await page.locator('#maximizeWindow').click();
  await expect
    .poll(() => page.evaluate(() => window.panopdf!.getWindowState()))
    .toMatchObject({ maximized: true });
  await expect(page.locator('#maximizeWindow')).toHaveAttribute('aria-label', '还原窗口');
  await page.locator('#maximizeWindow').click();
  await expect
    .poll(() => page.evaluate(() => window.panopdf!.getWindowState()))
    .toMatchObject({ maximized: false });
  await page.locator('#minimizeWindow').click();
  await expect
    .poll(() =>
      application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()),
    )
    .toBe(true);
  await application!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.restore();
    window.focus();
  });
  await jump(page, 5);
  const closed = page.waitForEvent('close');
  await page.locator('#closeWindow').click();
  await closed;
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')).recents[0]
          .position.page,
    )
    .toBe(5);
});

test('a pending resize must not overwrite navigation before the next frame', async () => {
  const page = await launch(documentA);
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await application!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 642),
  );
  await page.locator('#zoomPercent').fill('55%');
  await page.locator('#zoomPercent').press('Enter');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const settledPage = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const container = document.getElementById('viewerContainer')!;
        const width = container.clientWidth;
        // This observer runs after the reader's observer has queued its resize frame.
        const observer = new ResizeObserver(() => {
          if (container.clientWidth === width) return;
          observer.disconnect();
          const input = document.getElementById('pageNumber') as HTMLInputElement;
          input.value = '7';
          input.dispatchEvent(new Event('change'));
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(input.value)));
        });
        observer.observe(container);
        container.style.right = '1px';
      }),
  );
  expect(settledPage).toBe('7');
  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(
    JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')).recents[0].position
      .page,
  ).toBe(7);
  await page.getByRole('button', { name: /a.pdf/ }).click();
  await expect(page.locator('#pageNumber')).toHaveValue('7');
});

async function pickDocument(page: Page, file: string) {
  await application!.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, file);
  await page.locator('#emptyOpen').click();
}

async function closeDocument(page: Page) {
  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#emptyState')).toBeVisible();
}

async function expectRendered(page: Page) {
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect(page.locator('#viewer .page[data-loaded="true"] canvas').first()).toBeVisible();
}

test('opening keeps a measurable host and UI updates preserve viewer and PDF page identity', async () => {
  const page = await launch();
  await page.evaluate(() => {
    const host = document.getElementById('viewerContainer')!;
    const samples: { width: number; height: number; hidden: boolean }[] = [];
    const observer = new MutationObserver(() => {
      if (document.getElementById('readingArea')!.getAttribute('aria-busy') !== 'true') return;
      // Opening first closes the previous (possibly empty) reader. Only opening shows the toolbar.
      if (document.getElementById('readerToolbar')!.hidden) return;
      const rect = host.getBoundingClientRect();
      samples.push({ width: rect.width, height: rect.height, hidden: host.hidden !== false });
    });
    observer.observe(document.getElementById('readingArea')!, { attributes: true, subtree: true });
    (window as any).__openingEvidence = {
      observer,
      samples,
      host,
      viewer: document.getElementById('viewer'),
    };
  });
  await pickDocument(page, documentA);
  await expectRendered(page);
  const opening = await page.evaluate(() => {
    const evidence = (window as any).__openingEvidence;
    evidence.observer.disconnect();
    evidence.page = document.querySelector('#viewer .page');
    return evidence.samples as { width: number; height: number; hidden: boolean }[];
  });
  expect(opening.length).toBeGreaterThan(0);
  expect(
    opening.every((sample) => sample.width > 0 && sample.height > 0 && !sample.hidden),
    JSON.stringify(opening),
  ).toBe(true);
  const stable = () =>
    page.evaluate(() => {
      const evidence = (window as any).__openingEvidence;
      return (
        evidence.host === document.getElementById('viewerContainer') &&
        evidence.viewer === document.getElementById('viewer') &&
        evidence.page === document.querySelector('#viewer .page') &&
        evidence.page.isConnected
      );
    });
  await page.locator('#searchToggle').click();
  await page.locator('#searchQuery').fill('panorama');
  await expect(page.locator('#findCount')).toContainText('/ 12 处');
  expect(await stable()).toBe(true);
  await page.locator('#outlineTab').click();
  await page.getByRole('button', { name: 'Chapter four', exact: true }).click();
  await expect(page.locator('#pageNumber')).toHaveValue('4');
  expect(await stable()).toBe(true);
  await page.locator('#closePanel').click();
  await page.locator('#scrollInput').selectOption('smooth');
  await page.locator('#fileMenuButton').click();
  await page.keyboard.press('Escape');
  expect(await stable()).toBe(true);
  // Layout/zoom may replace canvases, but PDF.js page and host nodes remain owned by the reader.
  await page.locator('#zoomIn').click();
  await page.locator('#layoutMode').selectOption('vertical');
  expect(await stable()).toBe(true);
});

test('repeated close and reopen terminates every document worker', async () => {
  const page = await launch();
  const created: string[] = [];
  const closed: string[] = [];
  page.on('worker', (worker) => {
    created.push(worker.url());
    worker.on('close', () => closed.push(worker.url()));
  });
  await pickDocument(page, documentA);
  for (let cycle = 0; cycle < 4; cycle++) {
    await expectRendered(page);
    await expect.poll(() => page.workers().length).toBe(1);
    expect(page.workers()[0]!.url()).toMatch(/^pano:\/\/app\/assets\/pdf\.worker.*\.mjs$/);
    await closeDocument(page);
    await expect.poll(() => page.workers().length).toBe(0);
    await expect(page.locator('#viewer .page')).toHaveCount(0);
    await expect.poll(() => closed.length).toBe(cycle + 1);
    if (cycle < 3) await page.getByRole('button', { name: /a.pdf/ }).click();
  }
  expect(created).toHaveLength(4);
  expect(closed).toEqual(created);
});

test('focused page, zoom and column drafts survive reader state changes and Escape restores values', async () => {
  const page = await launch(documentA);
  await expectRendered(page);
  await page.locator('#pageNumber').fill('9');
  // dispatchEvent changes reader state without moving keyboard focus or committing the draft.
  await page.locator('#zoomIn').dispatchEvent('click');
  await expect(page.locator('#pageNumber')).toBeFocused();
  await expect(page.locator('#pageNumber')).toHaveValue('9');
  await page.locator('#pageNumber').press('Escape');
  await expect(page.locator('#pageNumber')).toHaveValue('1');
  const zoom = await page.locator('#zoomPercent').inputValue();
  await page.locator('#zoomPercent').fill('137%');
  await page.locator('#nextPage').dispatchEvent('click');
  await expect(page.locator('#pageNumber')).toHaveValue('2');
  await expect(page.locator('#zoomPercent')).toBeFocused();
  await expect(page.locator('#zoomPercent')).toHaveValue('137%');
  await page.locator('#zoomPercent').press('Escape');
  await expect(page.locator('#zoomPercent')).toHaveValue(zoom);
  await page.locator('#layoutMode').selectOption('vertical');
  await page.locator('#columns').fill('4');
  await page.locator('#zoomIn').dispatchEvent('click');
  await expect(page.locator('#columns')).toHaveValue('4');
  await page.locator('#columns').press('Escape');
  await expect(page.locator('#columns')).toHaveValue('1');
});

test('search composing Enter does not advance the current match', async () => {
  const page = await launch(documentA);
  await expectRendered(page);
  await page.locator('#searchToggle').click();
  await page.locator('#searchQuery').fill('panorama');
  await expect(page.locator('#findCount')).toHaveText('1 / 12 处');
  await page.locator('#searchQuery').dispatchEvent('compositionstart');
  await page
    .locator('#searchQuery')
    .dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(page.locator('#searchQuery')).toBeFocused();
  await expect(page.locator('#findCount')).toHaveText('1 / 12 处');
  await page.locator('#searchQuery').dispatchEvent('compositionend', { data: 'panorama' });
  await page.locator('#searchQuery').press('Enter');
  await expect(page.locator('#findCount')).toHaveText('2 / 12 处');
});

test('@migration numeric composing Enter preserves focus and waits for an explicit commit', async () => {
  const page = await launch(documentA);
  await expectRendered(page);
  for (const [selector, draft] of [
    ['#pageNumber', '4'],
    ['#zoomPercent', '85%'],
  ] as const) {
    const status = await page.locator('#documentStatus').textContent();
    await page.locator(selector).fill(draft);
    await page.locator(selector).dispatchEvent('compositionstart');
    await page
      .locator(selector)
      .dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await expect(page.locator(selector)).toBeFocused();
    await expect(page.locator(selector)).toHaveValue(draft);
    await expect(page.locator('#documentStatus')).toHaveText(status!);
    await page.locator(selector).dispatchEvent('compositionend', { data: draft });
    await page.locator(selector).press('Enter');
    await expect(page.locator(selector)).toHaveValue(draft);
    await expect(page.locator('#viewerContainer')).toBeFocused();
  }
});

test('password incorrect, cancel and recovery release the worker and preserve opening geometry', async () => {
  const encrypted = path.join(directory, 'encrypted.pdf');
  await writeFile(encrypted, encryptedFixture());
  const page = await launch();
  await pickDocument(page, encrypted);
  await expect(page.locator('#passwordDialog')).toBeVisible();
  await expect(page.locator('#passwordInput')).toBeFocused();
  await expect(page.locator('#pageNumber')).toBeDisabled();
  const size = await page
    .locator('#viewerContainer')
    .evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
  await page.locator('#passwordInput').fill('incorrect-password');
  await page.locator('#submitPassword').click();
  await expect(page.locator('#passwordError')).toBeVisible();
  await expect(page.locator('#passwordInput')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#passwordInput')).toBeFocused();
  await page.locator('#cancelPassword').click();
  await expect(page.locator('#passwordDialog')).toBeHidden();
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#passwordInput')).toHaveValue('');
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole('button', { name: /encrypted.pdf/ }).click();
  await expect(page.locator('#passwordDialog')).toBeVisible();
  await page.locator('#passwordInput').fill(fixturePassword);
  await page.locator('#submitPassword').click();
  await expectRendered(page);
  await expect(page.locator('#viewer .textLayer')).toContainText('encrypted local fixture');
  await expect(page.locator('#passwordDialog')).toBeHidden();
  await closeDocument(page);
  await expect.poll(() => page.workers().length).toBe(0);
  await pickDocument(page, documentA);
  await expectRendered(page);
  await expect(page.locator('#pageTotal')).toHaveText('/ 12');
});

test('local raster-only scanned PDF renders and returns no text search match', async () => {
  const scanned = path.join(directory, 'scanned.pdf');
  await writeFile(scanned, await scannedFixture());
  const page = await launch(scanned);
  await expectRendered(page);
  await expect(page.locator('#pageTotal')).toHaveText('/ 3');
  await expect(page.locator('#viewer .textLayer').first()).toHaveText('');
  // Canvas existence alone could be an empty image; check actual dark ink and light paper.
  const raster = await page
    .locator('#viewer .page canvas')
    .first()
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      let light = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index]! < 100) dark++;
        if (data[index]! > 200) light++;
      }
      return { dark, light };
    });
  expect(raster.dark).toBeGreaterThan(1000);
  expect(raster.light).toBeGreaterThan(1000);
  await page.locator('#searchToggle').click();
  await page.locator('#searchQuery').fill('panorama');
  await expect(page.locator('#findCount')).toHaveText('未找到匹配');
  await closeDocument(page);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('CMap, font, WASM and image assets resolve locally while remote requests are denied', async () => {
  const page = await launch(documentA);
  await expectRendered(page);
  const assets = await page.evaluate(async () =>
    Promise.all(
      [
        'pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
        'pdfjs/standard_fonts/FoxitSerif.pfb',
        'pdfjs/wasm/openjpeg.wasm',
        'pdfjs/images/annotation-comment.svg',
      ].map(async (relative) => {
        const response = await fetch(relative);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          url: response.url,
          status: response.status,
          bytes: bytes.length,
          magic: Array.from(bytes.subarray(0, 4)),
          type: response.headers.get('content-type'),
        };
      }),
    ),
  );
  for (const asset of assets) {
    expect(asset.url).toMatch(/^pano:\/\/app\/pdfjs\//);
    expect(asset.status).toBe(200);
    expect(asset.bytes).toBeGreaterThan(100);
  }
  expect(assets[2]!.magic).toEqual([0, 97, 115, 109]);
  expect(assets[2]!.type).toBe('application/wasm');
  expect(assets[3]!.type).toBe('image/svg+xml');
  expect(page.workers().map((worker) => worker.url())).toEqual([
    expect.stringMatching(/^pano:\/\/app\/assets\//),
  ]);

  // A reachable loopback endpoint proves denial, without contacting an external service.
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end('reachable');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  const url = `http://127.0.0.1:${address.port}/denied`;
  try {
    expect(await (await fetch(url)).text()).toBe('reachable');
    expect(requests).toBe(1);
    requests = 0;
    const denial = await page.evaluate(
      async (urls) => {
        const violations: string[] = [];
        const listener = (event: SecurityPolicyViolationEvent) => violations.push(event.blockedURI);
        document.addEventListener('securitypolicyviolation', listener);
        const blocked = await Promise.all(
          urls.map(async (url) => {
            try {
              await fetch(url);
              return false;
            } catch {
              return true;
            }
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        document.removeEventListener('securitypolicyviolation', listener);
        return { blocked, violations };
      },
      [url, 'https://example.invalid/panopdf-denied'],
    );
    expect(denial.blocked).toEqual([true, true]);
    expect(denial.violations).toEqual(
      expect.arrayContaining([url, 'https://example.invalid/panopdf-denied']),
    );
    // Also exercise Electron's session request filter independently of renderer CSP.
    const mainDenial = await application!.evaluate(async ({ BrowserWindow }, target) => {
      try {
        await BrowserWindow.getAllWindows()[0]!.webContents.session.fetch(target);
        return 'allowed';
      } catch (error) {
        return String(error);
      }
    }, url);
    expect(mainDenial).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(requests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('browser preview repeatedly reopens the same local file without transferring the saved bytes', async ({}, testInfo) => {
  // An existing Chromium can be supplied; this test never downloads or installs a browser.
  const executablePath = process.env.PANO_PREVIEW_CHROMIUM ?? chromium.executablePath();
  test.skip(
    !existsSync(executablePath),
    'Chromium is not installed; set PANO_PREVIEW_CHROMIUM to an existing executable',
  );
  const root = path.resolve('dist');
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://127.0.0.1').pathname);
      const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const consoleErrors: string[] = [];
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Preview server did not bind');
    browser = await chromium.launch({ executablePath });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    expect(await page.evaluate(() => typeof window.panopdf)).toBe('undefined');
    await expect(page.locator('#emptyOpen')).toBeEnabled();
    await page.locator('#browserFile').setInputFiles(documentA);
    for (let cycle = 0; cycle < 3; cycle++) {
      await expectRendered(page);
      await expect(page.locator('#pageTotal')).toHaveText('/ 12');
      await expect.poll(() => page.workers().length).toBe(1);
      await jump(page, cycle + 2);
      await closeDocument(page);
      await expect.poll(() => page.workers().length).toBe(0);
      if (cycle < 2) {
        await page.getByRole('button', { name: /a.pdf/ }).click();
        await expect(page.locator('#pageNumber')).toHaveValue(String(cycle + 2));
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('preview-environment', {
      body: JSON.stringify({ version: browser?.version(), consoleErrors }, null, 2),
      contentType: 'application/json',
    });
    await browser?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
