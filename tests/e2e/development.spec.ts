import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { readerFixture } from './fixtures';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('development uses local assets and Solid HMR preserves the live reader', async ({}, testInfo) => {
  const directory = testInfo.outputPath('user-data');
  await mkdir(directory, { recursive: true });
  const file = path.join(await realpath(directory), 'development.pdf');
  await writeFile(file, await readerFixture());
  let updated = false;
  const titleBar = path.join(root, 'src/components/title-bar.tsx');
  const server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'test-solid-hot-update',
        enforce: 'pre',
        transform(code, id) {
          if (id.split('?')[0] === path.join(root, 'src/main.tsx')) {
            return `window.__developmentWarnings = []; const originalWarn = console.warn; console.warn = (...args) => { window.__developmentWarnings.push(args.map(String).join(' ') + '\\n' + new Error().stack); originalWarn(...args); };\n${code}`;
          }
          // Change only the served module. The test never rewrites repository source.
          if (updated && id.split('?')[0] === titleBar) {
            return code.replace(/>\s*文件\s*<\/button>/, '>文件 HMR</button>');
          }
        },
      },
    ],
  });
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Development server did not bind');
    const url = `http://127.0.0.1:${address.port}/`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PANO_TEST_MODE: '1',
      PANO_USER_DATA: path.dirname(file),
      PANO_DEV_SERVER_URL: url,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await electron.launch({
      args: ['.', file],
      cwd: root,
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
    await expect(page.locator('#pageNumber')).toBeEnabled();
    await expect(page.locator('#viewer .page[data-loaded="true"] canvas').first()).toBeVisible();
    expect(page.url()).toBe(url);
    const identity = await page.evaluateHandle(() => ({
      host: document.getElementById('viewerContainer'),
      page: document.querySelector('#viewer .page'),
    }));
    const resources = await page.evaluate(async () =>
      Promise.all(
        [
          'pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
          'pdfjs/standard_fonts/FoxitSerif.pfb',
          'pdfjs/wasm/openjpeg.wasm',
          'pdfjs/images/annotation-comment.svg',
        ].map(async (relative) => {
          const response = await fetch(relative);
          return {
            status: response.status,
            bytes: (await response.arrayBuffer()).byteLength,
            url: response.url,
          };
        }),
      ),
    );
    for (const resource of resources) {
      expect(resource.status).toBe(200);
      expect(resource.bytes).toBeGreaterThan(100);
      expect(resource.url.startsWith(url)).toBe(true);
    }
    await expect.poll(() => page.workers().length).toBe(1);
    expect(page.workers()[0]!.url().startsWith(url)).toBe(true);
    await page.locator('#pageNumber').fill('5');
    await page.locator('#pageNumber').press('Enter');
    updated = true;
    const modules = server.moduleGraph.getModulesByFile(titleBar);
    expect(modules?.size).toBeGreaterThan(0);
    for (const module of modules!) await server.reloadModule(module);
    await expect(page.locator('#fileMenuButton')).toHaveText('文件 HMR');
    await expect(page.locator('#pageNumber')).toHaveValue('5');
    expect(
      await identity.evaluate(
        (value) =>
          value.host === document.getElementById('viewerContainer') &&
          value.page === document.querySelector('#viewer .page'),
      ),
    ).toBe(true);
    expect(page.workers().length).toBe(1);
    await page.locator('#fileMenuButton').click();
    await page.locator('#closeFile').click();
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect.poll(() => page.workers().length).toBe(0);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, '__developmentWarnings'))).toEqual([]);
    await identity.dispose();
  } finally {
    if (application) {
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
