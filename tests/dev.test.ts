import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

const url = new URL('../scripts/dev.mjs', import.meta.url);
// Exercise the actual orchestration with the same VM seam used by desktop tests.
const originalSource = readFileSync(url, 'utf8');
afterEach(() => vi.useRealTimers());

describe.each([
  ['LF', '\n'],
  ['CRLF', '\r\n'],
] as const)('%s source', (_name, newline) => {
  const source = originalSource
    .replace(/\r?\n/g, newline)
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(url.href));

  async function harness(options: { missingElectron?: boolean; listenFailure?: boolean } = {}) {
    const process = Object.assign(new EventEmitter(), {
      platform: 'darwin',
      env: { ELECTRON_RUN_AS_NODE: '1' },
      exitCode: undefined as number | undefined,
      exit: vi.fn(),
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(),
    });
    let closed = false;
    const server = {
      listen: vi.fn(async () => {
        if (options.listenFailure) throw new Error('Listen failed');
      }),
      close: vi.fn(() => {
        closed = true;
        return Promise.resolve();
      }),
      httpServer: { address: () => ({ port: 5191 }) },
    };
    const spawn = vi.fn(
      (_binary: string, _args: string[], _options: { env: NodeJS.ProcessEnv }) => child,
    );
    await runInNewContext(`(async () => { ${source} })()`, {
      process,
      spawn,
      URL,
      path,
      fileURLToPath,
      setTimeout,
      clearTimeout,
      console: { log: vi.fn(), error: vi.fn() },
      createRequire: () => () => {
        if (options.missingElectron) throw new Error('Missing Electron');
        return '/electron';
      },
      createServer: async () => {
        // Vite's standalone listener exits the process unless close() has detached it
        // synchronously. This models the real SIGTERM startup race reproduced on macOS.
        process.once('SIGTERM', () => {
          if (!closed) process.exit();
        });
        return server;
      },
    });
    const drain = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    return { process, child, server, spawn, drain };
  }

  test.each(['SIGINT', 'SIGTERM'] as const)(
    '%s starts both teardowns before waiting for the Electron child',
    async (signal) => {
      vi.useFakeTimers();
      const h = await harness();
      expect(h.spawn.mock.calls[0]).toMatchObject([
        '/electron',
        ['.'],
        { env: { PANO_DEV_SERVER_URL: 'http://127.0.0.1:5191/' } },
      ]);
      expect(h.spawn.mock.calls[0]![2].env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
      h.process.emit(signal);
      expect(h.child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(h.server.close).toHaveBeenCalledTimes(1);
      expect(h.process.exit).not.toHaveBeenCalled();
      expect(h.process.exitCode).toBeUndefined();
      h.child.emit('exit', 0, null);
      await h.drain();
      expect(h.process.exitCode).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test('a stuck Electron child is killed while Vite stays under the shared shutdown owner', async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    h.child.emit('exit', null, 'SIGKILL');
    await h.drain();
    expect(h.process.exitCode).toBe(143);
    expect(h.process.exit).not.toHaveBeenCalled();
  });

  test('Electron exit closes Vite and returns the child exit status', async () => {
    const h = await harness();
    h.child.exitCode = 0;
    h.child.emit('exit', 0, null);
    await h.drain();
    expect(h.server.close).toHaveBeenCalledTimes(1);
    expect(h.child.kill).not.toHaveBeenCalled();
    expect(h.process.exitCode).toBe(0);
  });

  test('missing Electron fails before listening, and a listen failure closes Vite', async () => {
    const missing = await harness({ missingElectron: true });
    expect(missing.server.listen).not.toHaveBeenCalled();
    expect(missing.spawn).not.toHaveBeenCalled();
    expect(missing.process.exitCode).toBe(1);
    const listen = await harness({ listenFailure: true });
    expect(listen.server.close).toHaveBeenCalledTimes(1);
    expect(listen.spawn).not.toHaveBeenCalled();
    expect(listen.process.exitCode).toBe(1);
  });
});
