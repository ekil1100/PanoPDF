import { _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  encryptedFixture,
  fixturePassword,
  readerFixture,
  scannedFixture,
} from '../tests/e2e/fixtures.ts';

// Usage: bun scripts/measure-reader.ts [output.json] [cold-samples=3] [cycles=5]
// Measures the existing production dist. Never builds, installs, or uses a normal profile.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] ?? '.agents/verification/electron/measurement.json');
const samples = Number(process.argv[3] ?? 3);
const cycles = Number(process.argv[4] ?? 5);
if (![samples, cycles].every((n) => Number.isInteger(n) && n >= 1 && n <= 20))
  throw new Error('Sample and cycle counts must be integers from 1 to 20');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function distManifest(directory: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relative = path.posix.join(prefix, entry.name);
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await distManifest(filename, relative));
    else result[relative] = hash(await readFile(filename));
  }
  return result;
}
const distBefore = await distManifest(path.join(root, 'dist'));
const fixtures = {
  mixed: await readerFixture(),
  scanned: await scannedFixture(),
  encrypted: encryptedFixture(),
};
const fixtureDirectory = path.join(root, '.agents/verification/fixtures');
await mkdir(fixtureDirectory, { recursive: true });
for (const [name, bytes] of Object.entries(fixtures))
  await writeFile(path.join(fixtureDirectory, `${name}.pdf`), bytes);
const initialPosition = {
  page: 1,
  scale: 1,
  layout: 'horizontal',
  columns: 1,
  zoomMode: 'custom',
  fitPages: 1,
  scrollInput: 'auto',
};
const results: unknown[] = [];
const failures: string[] = [];
async function ready(page: Page) {
  await expect(page.locator('#pageNumber')).toBeEnabled({ timeout: 20_000 });
}
async function canvas(page: Page) {
  await page.waitForFunction(
    () => {
      const node = document.querySelector<HTMLCanvasElement>('#viewer .page canvas');
      return (
        !!node && node.width > 0 && node.height > 0 && !!node.closest('.page[data-loaded="true"]')
      );
    },
    undefined,
    { timeout: 20_000 },
  );
}
async function closeDocument(page: Page) {
  await page.locator('#fileMenuButton').click();
  await page.locator('#closeFile').click();
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(0);
}
async function unlock(page: Page) {
  await expect(page.locator('#passwordDialog')).toBeVisible();
  await page.locator('#passwordInput').fill(fixturePassword);
  await page.locator('#submitPassword').click();
}
async function reopen(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`${name}\\.pdf`) }).click();
  if (name === 'encrypted') await unlock(page);
  await ready(page);
  await canvas(page);
}
async function activity(page: Page, kind: 'scroll' | 'zoom') {
  const position = () =>
    page
      .locator('#viewerContainer')
      .evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  const before = await position();
  await page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
      throw new Error('Long task measurement is unsupported');
    const state = {
      entries: [] as { startTime: number; duration: number }[],
      observer: null as PerformanceObserver | null,
    };
    state.observer = new PerformanceObserver((list) => {
      state.entries.push(
        ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
      );
    });
    state.observer.observe({ type: 'longtask' });
    (window as any).__measurement = state;
  });
  const start = performance.now();
  const zoomValues: string[] = [];
  if (kind === 'scroll') {
    await page.locator('#viewerContainer').hover();
    for (let step = 0; step < 12; step++) {
      await page.mouse.wheel(360, 0);
      await page.waitForTimeout(60);
    }
  } else {
    for (const value of ['80%', '110%', '60%', '100%']) {
      await page.locator('#zoomPercent').fill(value);
      await page.locator('#zoomPercent').press('Enter');
      await page.waitForTimeout(200);
      await expect(page.locator('#zoomPercent')).toHaveValue(value);
      zoomValues.push(await page.locator('#zoomPercent').inputValue());
    }
  }
  await page.waitForTimeout(300);
  const entries = await page.evaluate(() => {
    const state = (window as any).__measurement;
    state.entries.push(
      ...state.observer
        .takeRecords()
        .map(({ startTime, duration }: PerformanceEntry) => ({ startTime, duration })),
    );
    state.observer.disconnect();
    delete (window as any).__measurement;
    return state.entries as { startTime: number; duration: number }[];
  });
  const after = await position();
  if (kind === 'scroll') expect(after.left).toBeGreaterThan(before.left);
  return {
    elapsedMs: performance.now() - start,
    before,
    after,
    zoomValues,
    count: entries.length,
    totalMs: entries.reduce((n, e) => n + e.duration, 0),
    maxMs: Math.max(0, ...entries.map((e) => e.duration)),
    entries,
  };
}
for (const [name, bytes] of Object.entries(fixtures)) {
  for (let sample = 0; sample < samples; sample++) {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'panopdf-measure-')));
    let application: ElectronApplication | undefined;
    try {
      const document = path.join(directory, `${name}.pdf`);
      await writeFile(document, bytes);
      await writeFile(
        path.join(directory, 'settings.json'),
        JSON.stringify({
          version: 1,
          hasLaunched: true,
          recents: [{ id: randomUUID(), path: document, lastOpened: 1, position: initialPosition }],
        }),
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PANO_TEST_MODE: '1',
        PANO_USER_DATA: directory,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.PANO_DEV_SERVER_URL;
      const start = performance.now();
      application = await electron.launch({
        cwd: root,
        args: ['.', document],
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      });
      const page = await application.firstWindow();
      page.on('dialog', (dialog) => {
        if (dialog.type() !== 'beforeunload') void dialog.dismiss();
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let passwordInteractionMs: number | null = null;
      if (name === 'encrypted') {
        const passwordStart = performance.now();
        await unlock(page);
        passwordInteractionMs = performance.now() - passwordStart;
      }
      await ready(page);
      const readyMs = performance.now() - start;
      await canvas(page);
      const canvasMs = performance.now() - start;
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio,
      }));
      let searchMs: number | null = null;
      if (name !== 'scanned') {
        await page.locator('#searchToggle').click();
        const searchStart = performance.now();
        await page.locator('#searchQuery').fill(name === 'mixed' ? 'panorama' : 'encrypted');
        await expect(page.locator('#findCount')).toContainText(
          name === 'mixed' ? '/ 12 处' : '/ 1 处',
        );
        searchMs = performance.now() - searchStart;
        await page.locator('#closePanel').click();
      }
      // The one-page encrypted fixture has no horizontal scroll range at 100%.
      const scroll = name === 'encrypted' ? null : await activity(page, 'scroll');
      const zoom = await activity(page, 'zoom');
      const cdp = await page.context().newCDPSession(page);
      const memory = async (phase: string, cycle: number) => {
        const raw = await cdp.send('Runtime.getHeapUsage');
        await cdp.send('HeapProfiler.collectGarbage');
        const collected = await cdp.send('Runtime.getHeapUsage');
        return {
          phase,
          cycle,
          workers: page.workers().length,
          workerUrls: page.workers().map((worker) => worker.url()),
          raw,
          afterGC: collected,
        };
      };
      // Fixed cycle settings; the first loaded sample follows the interaction workload.
      await page.locator('#pageNumber').fill('1');
      await page.locator('#pageNumber').press('Enter');
      const heap = [await memory('loaded', 0)];
      for (let cycle = 1; cycle <= cycles; cycle++) {
        await closeDocument(page);
        await page.waitForTimeout(150);
        heap.push(await memory('closed', cycle));
        await reopen(page, name);
        await expect.poll(() => page.workers().length).toBe(1);
        await page.waitForTimeout(150);
        heap.push(await memory('reopened', cycle));
      }
      await closeDocument(page);
      heap.push(await memory('final-closed', cycles));
      const versions = await application.evaluate(() => process.versions);
      results.push({
        fixture: name,
        sample: sample + 1,
        readyMs,
        canvasMs,
        passwordInteractionMs,
        searchMs,
        viewport,
        scroll,
        zoom,
        heap,
        errors,
        versions,
      });
      if (errors.length)
        failures.push(`${name} sample ${sample + 1}: renderer errors: ${errors.join('; ')}`);
      await cdp.detach();
      console.log(
        `${name} sample ${sample + 1}: ready=${readyMs.toFixed(1)}ms canvas=${canvasMs.toFixed(1)}ms search=${searchMs === null ? 'n/a' : `${searchMs.toFixed(1)}ms`}`,
      );
    } catch (error) {
      failures.push(`${name} sample ${sample + 1}: ${String(error)}`);
      console.error(failures.at(-1));
    } finally {
      if (application) {
        await application
          .evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) window.destroy();
          })
          .catch(() => {});
        await application.close().catch(() => {});
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
}
const distAfter = await distManifest(path.join(root, 'dist'));
const distUnchanged = JSON.stringify(distBefore) === JSON.stringify(distAfter);
if (!distUnchanged)
  failures.push('Production dist changed during measurement; this run is not comparable');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      schema: 1,
      createdAt: new Date().toISOString(),
      command: `bun scripts/measure-reader.ts <output.json> ${samples} ${cycles}`,
      system: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model },
      settings: {
        initialPosition,
        samples,
        cycles,
        freshProfilePerSample: true,
        viewport: 'Application default, recorded per sample',
        gc: 'CDP forced GC after each raw heap observation',
      },
      fixtures: Object.fromEntries(
        Object.entries(fixtures).map(([name, bytes]) => [
          name,
          { bytes: bytes.length, sha256: hash(bytes) },
        ]),
      ),
      distUnchanged,
      distManifest: distBefore,
      results,
      failures,
      limitations: [
        'Cold means a fresh Electron process and user-data directory, not flushed OS disk cache.',
        'Ready is enabled page navigation; canvas is the first nonzero canvas in a loaded PDF.js page, measured by polling after ready.',
        'Search includes typing, 220ms debounce, PDF.js processing and Playwright polling; this is not pure search-engine time.',
        'Long tasks cover only the renderer main thread during fixed scripted interactions; PDF workers and GPU time are excluded.',
        'Heap is renderer V8 heap, not process RSS, native canvas/GPU memory or worker heaps. Forced GC changes normal behavior.',
        'Synthetic 12-page mixed orientation/text, 3-page raster-only scan and 1-page encrypted PDF; not representative of large or real-world documents.',
        'Encrypted open timings include automated password-dialog interaction; passwordInteractionMs records that interval separately. Its single page has no scroll workload.',
        'Repeated small samples on one host are descriptive evidence, not a universal performance claim or leak proof.',
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${output}`);
if (failures.length) process.exitCode = 1;
