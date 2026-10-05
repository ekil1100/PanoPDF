import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { DesktopBridge, ReadingPosition } from '../../src/contracts';
import type { createReader } from '../../src/reader';
import { readerFixture } from './fixtures';

const root = fileURLToPath(new URL('../..', import.meta.url));

// Serialized into the test entry only. All bridge calls and PDF.js work remain real.
function createHmrProbe(readerFactory: typeof createReader) {
  const bridge = window.panopdf!;
  const listeners = [0, 0, 0];
  const readers: { destroyCalls: number; destroyed: boolean }[] = [];
  const saves: { id: string; position: ReadingPosition; completed: boolean }[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const error = console.error;
  console.error = (...args) => {
    errors.push(`${args.map(String).join(' ')}\n${new Error().stack}`);
    error(...args);
  };
  const warn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
    warn(...args);
  };
  const NativeResizeObserver = window.ResizeObserver;
  const observers = new Map<ResizeObserver, Set<Element>>();
  window.ResizeObserver = class extends NativeResizeObserver {
    override observe(target: Element, options?: ResizeObserverOptions) {
      const targets = observers.get(this) ?? new Set<Element>();
      targets.add(target);
      observers.set(this, targets);
      super.observe(target, options);
    }
    override unobserve(target: Element) {
      const targets = observers.get(this);
      targets?.delete(target);
      if (!targets?.size) observers.delete(this);
      super.unobserve(target);
    }
    override disconnect() {
      observers.delete(this);
      super.disconnect();
    }
  };
  let subscriptions = 0;
  let unsubscriptions = 0;
  let startupCalls = 0;
  let entries = 0;
  let updatesStarted = 0;
  let updatesFinished = 0;
  let saveGate: Promise<void> | undefined;
  let releaseSave = () => {};
  function subscribe<T>(
    index: number,
    add: (callback: (value: T) => void) => () => void,
    callback: (value: T) => void,
  ) {
    const remove = add(callback);
    subscriptions++;
    listeners[index]++;
    return () => {
      unsubscriptions++;
      listeners[index]--;
      remove();
    };
  }
  const measuredBridge: DesktopBridge = {
    ...bridge,
    getStartup() {
      startupCalls++;
      return bridge.getStartup();
    },
    onOpenFile: (callback) => subscribe(0, (listener) => bridge.onOpenFile(listener), callback),
    onCommand: (callback) => subscribe(1, (listener) => bridge.onCommand(listener), callback),
    onWindowState: (callback) =>
      subscribe(2, (listener) => bridge.onWindowState(listener), callback),
    async savePosition(id, position) {
      const entry = { id, position: { ...position }, completed: false };
      saves.push(entry);
      await saveGate;
      await bridge.savePosition(id, position);
      entry.completed = true;
    },
  };
  const measuredReader: typeof createReader = (...args) => {
    const actual = readerFactory(...args);
    const entry = { destroyCalls: 0, destroyed: false };
    readers.push(entry);
    return {
      ...actual,
      destroy() {
        entry.destroyCalls++;
        const pending = actual.destroy();
        void pending.then(() => {
          entry.destroyed = true;
        });
        return pending;
      },
    };
  };
  return {
    options: { bridge: measuredBridge, createReader: measuredReader },
    enter() {
      entries++;
    },
    beginUpdate() {
      updatesStarted++;
    },
    endUpdate() {
      updatesFinished++;
    },
    holdSave() {
      saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    },
    releaseSave() {
      releaseSave();
    },
    snapshot() {
      return {
        readers,
        saves,
        listeners,
        subscriptions,
        unsubscriptions,
        startupCalls,
        entries,
        updatesStarted,
        updatesFinished,
        observers: observers.size,
        warnings,
        errors,
      };
    },
  };
}

for (const [firstUpdate, followingUpdate] of [
  ['app', 'app'],
  ['app', 'entry'],
  ['host', 'host'],
  ['host', 'entry'],
] as const) {
  test(`${firstUpdate} HMR followed by ${followingUpdate} HMR owns pending saves and mounts a working shell`, async ({}, testInfo) => {
    const directory = testInfo.outputPath('user-data');
    await mkdir(directory, { recursive: true });
    const file = path.join(await realpath(directory), 'application-hmr.pdf');
    await writeFile(file, await readerFixture());
    const target = path.join(
      root,
      firstUpdate === 'host' ? 'src/components/reader-host.tsx' : 'src/app.tsx',
    );
    const label = firstUpdate === 'host' ? 'PDF 页面' : 'PDF 阅读区';
    const updatedSelector = firstUpdate === 'host' ? '#viewerContainer' : '#readingArea';
    let revision = 0;
    const server = await createServer({
      root,
      cacheDir: testInfo.outputPath('vite-cache'),
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'test-application-hot-update',
          enforce: 'pre',
          transform(code, id) {
            if (id.split('?')[0] === path.join(root, 'src/main.tsx')) {
              return `import { createReader as probeReader } from '/src/reader';
              window.__appHmr ??= (${createHmrProbe.toString()})(probeReader);
              window.__appHmr.enter();
              // Tailwind also emits CSS updates; these do not remount the application.
              import.meta.hot.on('vite:beforeUpdate', (payload) => {
                if (payload.updates.some((update) => update.type === 'js-update' && !update.path.endsWith('.css'))) window.__appHmr.beginUpdate();
              });
              import.meta.hot.on('vite:afterUpdate', (payload) => {
                if (payload.updates.some((update) => update.type === 'js-update' && !update.path.endsWith('.css'))) window.__appHmr.endUpdate();
              });
              ${code.replaceAll('mountApplication(host)', 'mountApplication(host, window.__appHmr.options)')}`;
            }
            // Exercise the actual HMR graph without modifying any source file.
            if (revision && id.split('?')[0] === target) {
              return code.replace(label, `${label} HMR ${revision}`);
            }
          },
        },
      ],
    });
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('HMR server did not bind');
      const url = `http://127.0.0.1:${address.port}/`;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PANO_TEST_MODE: '1',
        PANO_USER_DATA: path.dirname(file),
        PANO_DEV_SERVER_URL: url,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      application = await electron.launch({
        cwd: root,
        args: ['.', file],
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      });
      const page = await application.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => {
        if (dialog.type() !== 'beforeunload') void dialog.dismiss();
      });
      await expect(page.locator('#pageNumber')).toBeEnabled();
      await expect(page.locator('#viewer .page canvas').first()).toBeVisible();
      await expect(page.locator('#viewer .page')).toHaveCount(12);
      await expect.poll(() => page.workers().length).toBe(1);
      const oldWorker = page.workers()[0]!;
      const probe = await page.evaluateHandle(
        () => Reflect.get(window, '__appHmr') as ReturnType<typeof createHmrProbe>,
      );
      const snapshot = () => probe.evaluate((value) => value.snapshot());
      const hotUpdate = async (module: 'app' | 'host' | 'entry' = firstUpdate) => {
        if (module !== 'entry') revision++;
        const modules = server.moduleGraph.getModulesByFile(
          module !== 'entry' ? target : path.join(root, 'src/main.tsx'),
        );
        expect(modules?.size).toBeGreaterThan(0);
        for (const module of modules!) await server.reloadModule(module);
      };
      const identity = await page.evaluateHandle(() => document.getElementById('viewerContainer'));
      expect(await snapshot()).toMatchObject({
        readers: [{ destroyCalls: 0, destroyed: false }],
        listeners: [1, 1, 1],
        subscriptions: 3,
        unsubscriptions: 0,
        startupCalls: 1,
        observers: 3,
      });
      await probe.evaluate((value) => value.holdSave());
      await page.locator('#pageNumber').fill('5');
      await page.locator('#pageNumber').press('Enter');
      await expect(page.locator('#pageNumber')).toHaveValue('5');
      await hotUpdate();
      await expect.poll(async () => (await snapshot()).readers[0]!.destroyed).toBe(true);
      await expect.poll(() => page.workers().length).toBe(0);
      await expect.poll(async () => (await snapshot()).saves.length).toBeGreaterThan(0);
      const saving = await snapshot();
      expect(saving).toMatchObject({
        readers: [{ destroyCalls: 1, destroyed: true }],
        listeners: [0, 0, 0],
        subscriptions: 3,
        unsubscriptions: 3,
        startupCalls: 1,
        observers: 0,
      });
      expect(saving.saves.every((entry) => !entry.completed)).toBe(true);
      expect(await identity.evaluate((node) => node?.isConnected)).toBe(false);
      expect(await identity.evaluate((node) => node?.querySelectorAll('.page').length)).toBe(0);

      // Vite's event is the barrier: the update has reached the renderer while saving is held.
      await expect.poll(async () => (await snapshot()).updatesFinished).toBe(1);
      await hotUpdate(followingUpdate);
      await expect.poll(async () => (await snapshot()).updatesStarted).toBe(2);
      if (followingUpdate !== 'entry')
        await expect.poll(async () => (await snapshot()).updatesFinished).toBe(2);
      expect(await snapshot()).toMatchObject({
        readers: [{ destroyCalls: 1, destroyed: true }],
        entries: 1,
        listeners: [0, 0, 0],
        observers: 0,
      });
      await probe.evaluate((value) => value.releaseSave());
      await expect(page.locator(updatedSelector)).toHaveAttribute(
        'aria-label',
        `${label} HMR ${revision}`,
      );
      await expect(page.locator('.app-header')).toBeHidden();
      await expect(page.locator('#emptyState')).toBeVisible();
      await expect(page.locator('#emptyOpen')).toBeEnabled();
      await expect.poll(async () => (await snapshot()).listeners).toEqual([1, 1, 1]);
      const replaced = await snapshot();
      expect(replaced.entries).toBe(followingUpdate !== 'entry' ? 1 : 2);
      expect(replaced.readers).toHaveLength(followingUpdate !== 'entry' ? 3 : 2);
      expect(
        replaced.readers
          .slice(0, -1)
          .every((reader) => reader.destroyCalls === 1 && reader.destroyed),
      ).toBe(true);
      expect(replaced.readers.at(-1)).toEqual({ destroyCalls: 0, destroyed: false });
      expect(replaced.subscriptions - replaced.unsubscriptions).toBe(3);
      expect(replaced.observers).toBe(2);
      expect(replaced.saves.every((entry) => entry.completed)).toBe(true);
      expect(replaced.saves.at(-1)!.position.page).toBe(5);
      // This original handle surviving proves there was no full-page reload.
      expect(await probe.evaluate((value) => value === Reflect.get(window, '__appHmr'))).toBe(true);
      expect(
        await identity.evaluate((node) => node === document.getElementById('viewerContainer')),
      ).toBe(false);
      await page.getByRole('button', { name: /application-hmr\.pdf/ }).click();
      await expect(page.locator('#pageNumber')).toBeEnabled();
      await expect(page.locator('#pageNumber')).toHaveValue('5');
      await expect(page.locator('#viewer .page canvas').first()).toBeVisible();
      await expect(page.locator('#viewer .page')).toHaveCount(12);
      await expect.poll(() => page.workers().length).toBe(1);
      expect(page.workers()[0]).not.toBe(oldWorker);
      await page.locator('#pageNumber').fill('7');
      await page.locator('#pageNumber').press('Enter');
      await expect(page.locator('#pageNumber')).toHaveValue('7');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
      await expect(page.locator('#emptyState')).toBeVisible();
      await expect.poll(() => page.workers().length).toBe(0);
      expect(errors).toEqual([]);
      expect((await snapshot()).warnings).toEqual([]);
      expect((await snapshot()).errors).toEqual([]);
      await identity.dispose();
      await probe.dispose();
    } finally {
      if (application) {
        for (const page of application.windows()) {
          await page.evaluate(() => Reflect.get(window, '__appHmr')?.releaseSave()).catch(() => {});
        }
        await application
          .evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) window.destroy();
          })
          .catch(() => {});
        await application.close().catch(() => {});
      }
      await server.close();
    }
  });
}
