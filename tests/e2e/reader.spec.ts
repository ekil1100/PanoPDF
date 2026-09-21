import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readerFixture } from './fixtures';

let directory: string;
let application: ElectronApplication | undefined;
let documentA: string;
let documentB: string;
const initialPosition = { page: 1, scale: 1, layout: 'horizontal', columns: 1, zoomMode: 'custom', fitPages: 1, scrollInput: 'auto' };

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
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    }).catch(() => {});
    await application.close().catch(() => {});
    application = undefined;
  }
  await rm(directory, { recursive: true, force: true });
});

async function launch(file?: string): Promise<Page> {
  const env = { ...process.env, PANO_TEST_MODE: '1', PANO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PANO_DEV_SERVER_URL;
  application = await electron.launch({ args: ['.', ...(file ? [file] : [])], env });
  const page = await application.firstWindow();
  // Electron handles beforeunload without a browser confirmation; prevent Playwright's auto-dismiss race.
  page.on('dialog', dialog => { if (dialog.type() !== 'beforeunload') void dialog.dismiss(); });
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
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#pageTotal')).toHaveText('/ 12');
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await page.locator('#zoomMode').selectOption('pages-3');
  await expect(page.locator('#viewer .page canvas').first()).toBeVisible();
  await expect(page.locator('#viewer .textLayer').first()).toContainText('panorama');
  await expect(page.locator('#viewer .textLayer').first()).toBeVisible();
  expect(await page.evaluate(() => {
    const layer = document.querySelector('#viewer .textLayer')!;
    const range = document.createRange();
    range.selectNodeContents(layer);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  })).toContain('panorama');
  const center = await page.evaluate(() => {
    const container = document.getElementById('viewerContainer')!;
    const host = container.getBoundingClientRect();
    const first = document.querySelector('#viewer .page')!.getBoundingClientRect();
    return Math.abs(host.top + container.clientHeight / 2 - (first.top + first.bottom) / 2);
  });
  expect(center).toBeLessThan(2);

  // Every renderer asset is local, including the annotation images and WASM.
  const assets = await page.evaluate(async () => Promise.all([
    'pdfjs/images/annotation-comment.svg', 'pdfjs/wasm/openjpeg.wasm', 'pdfjs/standard_fonts/FoxitSerif.pfb',
  ].map(async url => {
    const response = await fetch(url);
    return { ok: response.ok, length: (await response.arrayBuffer()).byteLength, type: response.headers.get('content-type') };
  })));
  expect(assets.every(asset => asset.ok && asset.length > 0)).toBe(true);
  expect(assets[0].type).toBe('image/svg+xml');
  expect(await page.evaluate(() => ({ node: typeof (window as any).require, bridge: !!window.panopdf }))).toEqual({ node: 'undefined', bridge: true });

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
  const rows = await page.locator('#viewer .page').evaluateAll(pages => pages.slice(0, 4).map(page => page.getBoundingClientRect().top));
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
  await writeFile(settingsPath, JSON.stringify({ version: 1, recents: [{ id, path: documentA, lastOpened: Date.now(), position: initialPosition }] }));
  const page = await launch();
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).recents[0].position?.page).toBe(1);
  await application!.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const send = contents.send.bind(contents);
    (globalThis as any).testNativeEvents = [];
    contents.send = (channel, ...args) => {
      if (channel === 'pano:file') (globalThis as any).testNativeEvents.push(args[0].name);
      return send(channel, ...args);
    };
  });
  const busyStarted = page.waitForEvent('console', { predicate: message => message.text() === 'Test renderer busy' });
  const busy = page.evaluate(() => {
    const input = document.getElementById('pageNumber') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('change'));
    console.log('Test renderer busy');
    // Model a complex PDF long task while the main process handles OS open events.
    const until = performance.now() + 1500;
    while (performance.now() < until) { /* Keep the renderer occupied. */ }
  });
  await busyStarted;
  await application!.evaluate(({ app }, files) => {
    for (const file of files) app.emit('open-file', { preventDefault() {} }, file);
  }, [documentB, documentA]);
  await busy;
  await expect.poll(() => application!.evaluate(() => (globalThis as any).testNativeEvents)).toEqual(['b.pdf', 'a.pdf']);
  await expect(page.locator('#filename')).toHaveText('a.pdf');
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await expect(page.locator('#pageNumber')).toHaveValue('7');
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).recents.find((entry: { id: string }) => entry.id === id).position.page).toBe(7);
});

test('quitting immediately after navigation flushes the final position', async () => {
  const page = await launch(documentA);
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await jump(page, 8);
  const closed = application!.waitForEvent('close');
  await application!.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
  await closed;
  application = undefined;
  const settings = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  expect(settings.recents.find((entry: { path: string }) => entry.path === documentA).position.page).toBe(8);
});

async function quitApplication() {
  const closing = application!.waitForEvent('close');
  await application!.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
  await closing;
  application = undefined;
}
async function seedRecent(file: string, page = 1) {
  await writeFile(path.join(directory, 'settings.json'), JSON.stringify({
    version: 1, hasLaunched: true,
    recents: [{ id: randomUUID(), path: file, lastOpened: Date.now(), position: { ...initialPosition, page } }],
  }));
}

test('first launch shows guidance once and keeps the toolbar out of the welcome screen', async ({}, testInfo) => {
  let page = await launch();
  await expect(page.locator('#welcomeGuide')).toBeVisible();
  await expect(page.locator('#emptyTitle')).toHaveText('欢迎使用 PanoPDF');
  await expect(page.locator('#openShortcut')).toHaveText(process.platform === 'darwin' ? '⌘ O' : 'Ctrl O');
  await expect(page.locator('#readerToolbar')).toBeHidden();
  await expect(page.locator('.document-bar')).toHaveCount(0);
  await expect(page.locator('#openFile')).toBeHidden();
  await expect(page.locator('#emptyOpen')).toBeEnabled();
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
  await page.screenshot({ path: testInfo.outputPath('welcome-1440.png') });
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(800, 560));
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
  expect(settings.recents.find((entry: { path: string }) => entry.path === documentA).position.page).toBe(7);
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

  expect(await page.locator('#titlebar').evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region'))).toBe('drag');
  expect(await page.locator('#fileMenuButton').evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  // Small CI displays can start with a screen-sized window. Establish the normal state first.
  await application!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.unmaximize();
    window.setSize(800, 560);
  });
  await expect.poll(() => page.evaluate(() => window.panopdf!.getWindowState())).toMatchObject({ maximized: false });
  await page.locator('#maximizeWindow').click();
  await expect.poll(() => page.evaluate(() => window.panopdf!.getWindowState())).toMatchObject({ maximized: true });
  await expect(page.locator('#maximizeWindow')).toHaveAttribute('aria-label', '还原窗口');
  await page.locator('#maximizeWindow').click();
  await expect.poll(() => page.evaluate(() => window.panopdf!.getWindowState())).toMatchObject({ maximized: false });
  await page.locator('#minimizeWindow').click();
  await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())).toBe(true);
  await application!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.restore(); window.focus(); });
  await jump(page, 5);
  const closed = page.waitForEvent('close');
  await page.locator('#closeWindow').click();
  await closed;
  await expect.poll(async () => JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')).recents[0].position.page).toBe(5);
});

test('a pending resize must not overwrite navigation before the next frame', async () => {
  const page = await launch(documentA);
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 642));
  await page.locator('#zoomPercent').fill('55%');
  await page.locator('#zoomPercent').press('Enter');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const settledPage = await page.evaluate(() => new Promise<string>(resolve => {
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
  }));
  expect(settledPage).toBe('7');
  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')).recents[0].position.page).toBe(7);
  await page.getByRole('button', { name: /a.pdf/ }).click();
  await expect(page.locator('#pageNumber')).toHaveValue('7');
});
