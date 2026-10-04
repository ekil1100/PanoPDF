import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, JSHandle, Page } from '@playwright/test';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { encryptedFixture, readerFixture } from './fixtures';
import type { LifecycleFixture } from './lifecycle-fixture';

const root = fileURLToPath(new URL('../..', import.meta.url));
let server: ViteDevServer;
let devUrl: string;
let application: ElectronApplication | undefined;
let page: Page;
let fixture: JSHandle<LifecycleFixture> | undefined;
let pdf: number[];
let errors: string[];

test.beforeAll(async () => {
  pdf = [...(await readerFixture())];
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [
      {
        name: 'lifecycle-test-entry',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            // Keep the real index, CSP and #app layout root; only suppress auto-mounting.
            const entry = /<script\b[^>]*\bsrc=["']\/src\/main\.tsx["'][^>]*>\s*<\/script>/;
            if (!entry.test(html)) throw new Error('Application entry script was not found');
            return html.replace(entry, '');
          },
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Lifecycle server did not bind');
  devUrl = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
  await server?.close();
});

test.beforeEach(async ({}, testInfo) => {
  const directory = testInfo.outputPath('user-data');
  await mkdir(directory, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PANO_TEST_MODE: '1',
    PANO_USER_DATA: await realpath(directory),
    PANO_DEV_SERVER_URL: devUrl,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    cwd: root,
    args: [path.join(root, 'electron/main.cjs')],
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  });
  page = await application.firstWindow();
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#app')).toBeAttached();
  expect(await page.locator('#app').evaluate((host) => host.childNodes.length)).toBe(0);
  expect(
    await page.evaluate(() => ({
      bridge: !!window.panopdf,
      node: typeof Reflect.get(window, 'require'),
    })),
  ).toEqual({ bridge: true, node: 'undefined' });
  fixture = await page.evaluateHandle(async (): Promise<LifecycleFixture> => {
    // Dynamic imports run in the normal sandboxed Electron renderer, not a browser fallback.
    const appUrl = '/src/app.tsx';
    const readerUrl = '/src/reader.ts';
    const fixtureUrl = '/tests/e2e/lifecycle-fixture.ts';
    const styleUrl = '/src/style.css';
    const [{ mountApplication }, { createReader }, { createLifecycleFixture }] = await Promise.all([
      import(appUrl),
      import(readerUrl),
      import(fixtureUrl),
      import(styleUrl),
    ]);
    return createLifecycleFixture(mountApplication, createReader);
  });
});

test.afterEach(async ({}, testInfo) => {
  await testInfo.attach('renderer-errors', {
    body: JSON.stringify(errors ?? [], null, 2),
    contentType: 'application/json',
  });
  await fixture
    ?.evaluate((value) => {
      value.cleanup();
    })
    .catch(() => {});
  await fixture?.dispose();
  fixture = undefined;
  if (application) {
    // Forced teardown also handles a failing lifecycle assertion without hanging on beforeunload.
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await application.close().catch(() => {});
    application = undefined;
  }
});

async function snapshot(index: number) {
  return fixture!.evaluate((value, id) => value.instance(id).snapshot(), index);
}
async function expectReleased(index: number) {
  await fixture!.evaluate((value, id) => value.instance(id).waitDisposed(), index);
  const state = await snapshot(index);
  expect(state.samePromise).toBe(true);
  expect(state.destroyCalls).toBe(1);
  expect(state.destroySettled).toBe(true);
  expect(state.disposalSettled).toBe(true);
  expect(state.listeners).toEqual([0, 0, 0]);
  expect(state.synchronousDisposal).toEqual({
    destroyCalls: 1,
    childNodes: 0,
    listeners: [0, 0, 0],
    observers: 0,
  });
  expect(state.resources.workers).toBe(0);
  expect(state.resources.observers).toBe(0);
  expect(state.resources.observedTargets).toBe(0);
  expect(state.resources.subscriptions).toBe(state.resources.unsubscriptions);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(await page.locator('#app').evaluate((host) => host.childNodes.length)).toBe(0);
  const again = await fixture!.evaluate((value, id) => value.instance(id).dispose(), index);
  expect(again.samePromise).toBe(true);
  expect(again.destroyCalls).toBe(1);
  expect(errors).toEqual([]);
  return state;
}
function expectMeasurable(state: Awaited<ReturnType<typeof snapshot>>) {
  expect(state.openHost).toMatchObject({
    connected: true,
    hidden: false,
    visibility: 'hidden',
    busy: 'true',
  });
  expect(state.openHost!.width).toBeGreaterThan(0);
  expect(state.openHost!.height).toBeGreaterThan(0);
}

test('empty Solid mounts release their real reader, observers and bridge subscriptions repeatedly', async () => {
  for (let cycle = 0; cycle < 3; cycle++) {
    const index = await fixture!.evaluate((value) => value.mount());
    await expect(page.locator('#emptyOpen')).toBeEnabled();
    await expect(page.locator('#emptyState')).toBeVisible();
    const mounted = await snapshot(index);
    expect(mounted.listeners).toEqual([1, 1, 1]);
    expect(mounted.resources.subscriptions - mounted.resources.unsubscriptions).toBe(3);
    expect(mounted.resources.observers).toBe(2);
    expect(mounted.openCalls).toBe(0);
    await fixture!.evaluate((value, id) => {
      value.instance(id).dispose();
    }, index);
    const disposed = await expectReleased(index);
    expect(disposed.resources.workersCreated).toBe(0);
    expect(disposed.resources.observersCreated).toBe((cycle + 1) * 2);
  }
});

test('opening disposal aborts actual reader.open in the same task before worker readiness', async () => {
  const index = await fixture!.evaluate(
    (value, bytes) => value.mount({ bytes, disposeOnOpen: true }),
    pdf,
  );
  await expect.poll(async () => (await snapshot(index)).destroyCalls).toBe(1);
  const disposed = await expectReleased(index);
  expectMeasurable(disposed);
  expect(disposed.openCalls).toBe(1);
  expect(disposed.openSettled).toBe(true);
  expect(disposed.openingResources).toMatchObject({
    workers: 1,
    workersCreated: 1,
    workerReadyMessages: 0,
  });
  expect(disposed.passwordRequests).toBe(0);
  expect(disposed.saved).toEqual([]);
  expect(disposed.events.indexOf('open-returned')).toBeLessThan(
    disposed.events.indexOf('dispose-called'),
  );
  expect(disposed.events.indexOf('destroy-called')).toBeLessThan(
    disposed.events.indexOf('open-completed'),
  );
  expect(disposed.events.indexOf('open-completed')).toBeLessThan(
    disposed.events.indexOf('dispose-completed'),
  );
});

test('password-awaiting disposal settles the real PDF.js password request and releases its worker', async () => {
  const index = await fixture!.evaluate(
    (value, bytes) => value.mount({ bytes }),
    [...encryptedFixture()],
  );
  await expect(page.locator('#passwordDialog')).toBeVisible();
  await expect(page.locator('#passwordInput')).toBeFocused();
  await expect.poll(() => page.workers().length).toBe(1);
  const awaiting = await snapshot(index);
  expectMeasurable(awaiting);
  expect(awaiting.passwordRequests).toBe(1);
  expect(awaiting.passwords).toEqual([]);
  expect(awaiting.openSettled).toBe(false);
  expect(awaiting.resources.workerReadyMessages).toBe(1);
  await fixture!.evaluate((value, id) => {
    value.instance(id).dispose();
  }, index);
  const disposed = await expectReleased(index);
  expect(disposed.passwords).toEqual([null]);
  expect(disposed.openSettled).toBe(true);
  expect(disposed.saved).toEqual([]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('ready disposal captures final progress and waits for save after releasing resources across remounts', async () => {
  for (let cycle = 0; cycle < 3; cycle++) {
    const index = await fixture!.evaluate(
      (value, bytes) => value.mount({ bytes, holdSave: true }),
      pdf,
    );
    await expect(page.locator('#pageTotal')).toHaveText('/ 12');
    await expect(page.locator('#pageNumber')).toBeEnabled();
    await expect(page.locator('#viewer .page canvas').first()).toBeVisible();
    await expect.poll(() => page.workers().length).toBe(1);
    const ready = await snapshot(index);
    expectMeasurable(ready);
    expect(ready.openSettled).toBe(true);
    expect(ready.listeners).toEqual([1, 1, 1]);
    expect(ready.resources.subscriptions - ready.resources.unsubscriptions).toBe(3);
    expect(ready.resources.workersCreated).toBe(cycle + 1);
    expect(ready.resources.workers).toBe(1);
    // Navigation and disposal share a task, before either position debounce can fire.
    const target = cycle + 5;
    const immediate = await fixture!.evaluate(
      (value, { index, target }) => value.instance(index).moveAndDispose(target),
      { index, target },
    );
    expect(immediate.synchronousDisposal).toEqual({
      destroyCalls: 1,
      childNodes: 0,
      listeners: [0, 0, 0],
      observers: 0,
    });
    expect(immediate.positionAtDestroy?.page).toBe(target);
    expect(immediate.samePromise).toBe(true);
    await expect.poll(async () => (await snapshot(index)).destroySettled).toBe(true);
    await expect.poll(() => page.workers().length).toBe(0);
    const saving = await snapshot(index);
    expect(saving.resources.observers).toBe(0);
    expect(saving.resources.workers).toBe(0);
    expect(saving.disposalSettled).toBe(false);
    expect(saving.saved.length).toBeGreaterThan(0);
    expect(saving.saved[0]!.completed).toBe(false);
    expect(saving.events.indexOf('capture-position')).toBeLessThan(
      saving.events.indexOf('destroy-called'),
    );
    await fixture!.evaluate((value, id) => {
      value.instance(id).releaseSave();
    }, index);
    const disposed = await expectReleased(index);
    expect(disposed.saved.every((entry) => entry.completed)).toBe(true);
    expect(disposed.saved.at(-1)).toEqual({
      id: `lifecycle-${index}`,
      position: disposed.positionAtDestroy,
      completed: true,
    });
    expect(disposed.saved.at(-1)!.position.page).toBe(target);
    expect(disposed.events.lastIndexOf('save-completed')).toBeLessThan(
      disposed.events.indexOf('dispose-completed'),
    );
    expect(disposed.events.indexOf('destroy-completed')).toBeLessThan(
      disposed.events.indexOf('dispose-completed'),
    );
  }
});

test('ordinary close keeps the live reader measurable while final save is blocked', async () => {
  const index = await fixture!.evaluate(
    (value, bytes) => value.mount({ bytes, holdSave: true }),
    pdf,
  );
  await expect(page.locator('#pageNumber')).toBeEnabled();
  await page.locator('#pageNumber').fill('7');
  await page.locator('#pageNumber').press('Enter');
  await expect(page.locator('#pageNumber')).toHaveValue('7');
  await expect(page.locator('#viewer .page[data-page-number="7"] canvas')).toBeVisible();
  const position = await fixture!.evaluate((value, id) => value.instance(id).getPosition(), index);
  expect(position?.page).toBe(7);
  expect(position!.scale).toBeGreaterThan(0.1);
  const host = page.locator('#viewerContainer');
  expect(errors).toEqual([]);

  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#readingArea')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#pageNumber')).toBeDisabled();
  await expect.poll(async () => (await snapshot(index)).saved.length).toBeGreaterThan(0);
  // Native observer delivery happens after layout; subsequent native frames run its queued refresh.
  // Keep save blocked throughout, without invoking observer/reader callbacks or using a timer.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
  const closing = await host.evaluate((node: HTMLDivElement) => ({
    hidden: node.hidden,
    visibility: getComputedStyle(node).visibility,
    dimensions: [node.clientWidth, node.clientHeight],
    pageHasOffsetParent: !!node.querySelector<HTMLElement>('.page')?.offsetParent,
  }));
  expect.soft(closing).toMatchObject({
    hidden: false,
    visibility: 'hidden',
    pageHasOffsetParent: true,
  });
  expect.soft(closing.dimensions[0]).toBeGreaterThan(0);
  expect.soft(closing.dimensions[1]).toBeGreaterThan(0);
  // Hiding the toolbar can change fitted scale; the frozen save must retain the reading scale.
  const live = await fixture!.evaluate((value, id) => value.instance(id).getPosition(), index);
  expect.soft(live?.page).toBe(position!.page);
  expect.soft(live!.scale).toBeGreaterThan(0.1);
  const held = await snapshot(index);
  expect(held.saved.every((entry) => !entry.completed)).toBe(true);
  expect(held.resources.workers).toBe(1);
  expect(page.workers()).toHaveLength(1);
  expect.soft(errors).toEqual([]);

  await fixture!.evaluate((value, id) => value.instance(id).releaseSave(), index);
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(0);
  const closed = await snapshot(index);
  expect(closed.resources.workers).toBe(0);
  expect(closed.saved.every((entry) => entry.completed)).toBe(true);
  expect(closed.saved.at(-1)).toEqual({ id: `lifecycle-${index}`, position, completed: true });
  expect(await host.evaluate((node: HTMLDivElement) => node.hidden)).toBe(true);
  expect(errors).toEqual([]);
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`disposed startup and window-state ${outcome} continuations leave the remounted DOM untouched`, async () => {
    const old = await fixture!.evaluate((value) =>
      value.mount({ pendingStartup: true, pendingWindow: true }),
    );
    await expect(page.locator('#emptyOpen')).toBeDisabled();
    await expect.poll(async () => (await snapshot(old)).startupCalls).toBe(1);
    expect((await snapshot(old)).windowCalls).toBe(1);
    await fixture!.evaluate((value, id) => {
      value.instance(id).dispose();
    }, old);
    // Disposal completes while both non-cancellable bridge promises are still pending.
    await expectReleased(old);

    const current = await fixture!.evaluate((value) => value.mount());
    await expect(page.locator('#emptyOpen')).toBeEnabled();
    await expect(page.locator('#maximizeWindow')).toBeEnabled();
    await expect(page.locator('#maximizeWindow')).toHaveAttribute('aria-label', '最大化窗口');
    const late = await fixture!.evaluate(
      (value, { old, bytes, outcome }) => value.instance(old).completeLate(bytes, outcome),
      { old, bytes: pdf, outcome },
    );
    expect(late.mutations).toBe(0);
    expect(late.after).toEqual(late.before);
    const discarded = await snapshot(old);
    expect(discarded.openCalls).toBe(0);
    expect(discarded.recentCalls).toBe(0);
    expect(discarded.pickerCalls).toBe(0);
    expect(discarded.saved).toEqual([]);
    expect(discarded.destroyCalls).toBe(1);
    expect(discarded.listeners).toEqual([0, 0, 0]);
    const mounted = await snapshot(current);
    expect(mounted.openCalls).toBe(0);
    expect(mounted.listeners).toEqual([1, 1, 1]);
    expect(mounted.resources.workersCreated).toBe(0);
    expect(mounted.resources.observers).toBe(2);
    expect(mounted.resources.subscriptions - mounted.resources.unsubscriptions).toBe(3);
    await fixture!.evaluate((value, id) => {
      value.instance(id).dispose();
    }, current);
    await expectReleased(current);
  });
}
