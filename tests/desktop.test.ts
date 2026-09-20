import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { StartupSession } = require('../electron/startup.cjs');
const { SettingsStore, sanitizeSettings } = require('../electron/settings.cjs');
const { validateWindowAction } = require('../electron/security.cjs');
const directories: string[] = [];
async function workspace() {
  const root = path.resolve('.agents');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'desktop-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const pdf = (name: string) => ({ id: name, name, data: new Uint8Array([1, 2]) });
const session = (options: Record<string, unknown> = {}) => new StartupSession({
  paths: [], lastPath: '/last.pdf', firstRun: false, open: async (name: string) => pdf(name), ...options,
});

describe('window actions', () => {
  it('accepts only the three exact actions', () => {
    for (const value of ['minimize', 'toggle-maximize', 'close']) expect(validateWindowAction(value)).toBe(value);
    for (const value of [null, undefined, {}, ['close'], 1, 'destroy', 'maximize', 'quit', 'CLOSE', 'close ']) {
      expect(() => validateWindowAction(value)).toThrow();
    }
  });
});

describe('startup ordering', () => {
  it('reads and returns the initial PDF only once, including concurrent callers', async () => {
    const read = deferred<ReturnType<typeof pdf>>();
    const open = vi.fn(() => read.promise);
    const startup = session({ open });
    const first = startup.get();
    const second = startup.get();
    expect(open).toHaveBeenCalledTimes(1);
    expect(() => startup.acknowledge()).toThrow();
    read.resolve(pdf('last'));
    expect((await first).file.name).toBe('last');
    expect((await second).file).toBeNull();
    expect((await startup.get()).file).toBeNull();
    expect(startup.ready).toBe(false);
    startup.acknowledge();
    expect(startup.ready).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('takes the first queued OS request instead of restoring and retains the remaining FIFO', async () => {
    const paths = ['/B.pdf', '/A.pdf'];
    const open = vi.fn(async (name: string) => pdf(name));
    const startup = session({ paths, open });
    expect((await startup.get()).file.name).toBe('/B.pdf');
    expect(paths).toEqual(['/A.pdf']);
    expect(open.mock.calls).toEqual([['/B.pdf']]);
    expect(startup.ready).toBe(false);
  });

  it.each([false, true])('suppresses a stale restore when a native open arrives during I/O (failure=%s)', async failure => {
    const read = deferred<ReturnType<typeof pdf>>();
    const paths: string[] = [];
    const open = vi.fn((name: string) => name === '/last.pdf' ? read.promise : Promise.resolve(pdf(name)));
    const startup = session({ paths, open });
    const result = startup.get();
    paths.push('/B.pdf', '/A.pdf');
    if (failure) read.reject(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    else read.resolve(pdf('stale'));
    expect((await result).file.name).toBe('/B.pdf');
    expect(paths).toEqual(['/A.pdf']);
    expect(open.mock.calls).toEqual([['/last.pdf'], ['/B.pdf']]);
  });

  it('does not read or deliver twice when the OS requests the restore target during I/O', async () => {
    const read = deferred<ReturnType<typeof pdf>>();
    const paths: string[] = [];
    const open = vi.fn(() => read.promise);
    const startup = session({ paths, open });
    const result = startup.get();
    paths.push('/last.pdf');
    read.resolve(pdf('last'));
    expect((await result).file.name).toBe('last');
    expect(paths).toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports a missing last file without fallback or repeated retries', async () => {
    const open = vi.fn(async () => { throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); });
    const startup = session({ open });
    expect(await startup.get()).toEqual({ firstRun: false, file: null, error: '文件已移动或删除，请重新选择。' });
    startup.acknowledge();
    expect(startup.ready).toBe(true);
    expect((await startup.get()).file).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('supports a first launch without any document', async () => {
    const open = vi.fn();
    const startup = session({ firstRun: true, lastPath: undefined, open });
    expect(await startup.get()).toEqual({ firstRun: true, file: null });
    expect(open).not.toHaveBeenCalled();
  });

  it('requeues an unacknowledged native request if its window closes', async () => {
    const read = deferred<ReturnType<typeof pdf>>();
    const paths = ['/B.pdf', '/A.pdf'];
    const startup = session({ paths, open: () => read.promise });
    const result = startup.get();
    startup.dispose();
    startup.dispose();
    expect(paths).toEqual(['/B.pdf', '/A.pdf']);
    read.resolve(pdf('B'));
    expect((await result).file).toBeNull();
    expect(() => startup.acknowledge()).toThrow();
  });

  it('does not requeue a document already acknowledged, and a new window may restore it', async () => {
    const paths = ['/B.pdf'];
    const startup = session({ paths });
    await startup.get();
    startup.acknowledge();
    startup.dispose();
    expect(paths).toEqual([]);
    expect((await session({ paths, lastPath: '/B.pdf' }).get()).file.name).toBe('/B.pdf');
  });
});

describe('launch persistence', () => {
  it('persists first launch without opening a PDF and coalesces callers', async () => {
    const file = path.join(await workspace(), 'settings.json');
    const store = new SettingsStore(file);
    await store.load();
    expect(await Promise.all([store.beginLaunch(), store.beginLaunch()])).toEqual([{ firstRun: true }, { firstRun: true }]);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ version: 1, hasLaunched: true, recents: [] });
    const next = new SettingsStore(file);
    await next.load();
    expect(await next.beginLaunch()).toEqual({ firstRun: false });
  });

  it('migrates legacy recents without losing IDs or reading positions', async () => {
    const file = path.join(await workspace(), 'settings.json');
    const position = { page: 9, scale: 1.5, layout: 'horizontal', columns: 2, zoomMode: 'custom', fitPages: 2, scrollInput: 'auto', left: 12, top: 4 };
    const entry = { id: randomUUID(), path: path.resolve('.agents', 'legacy.pdf'), lastOpened: 1, position };
    await fs.writeFile(file, JSON.stringify({ version: 1, recents: [entry] }));
    const store = new SettingsStore(file);
    await store.load();
    expect(await store.beginLaunch()).toEqual({ firstRun: false });
    expect(store.lastPath()).toBe(entry.path);
    expect(store.authorized(entry.id)).toEqual(entry);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).recents).toEqual([entry]);
    expect(sanitizeSettings({ version: 1, hasLaunched: 'yes', recents: [] }).hasLaunched).toBe(false);
    expect(sanitizeSettings({ version: 1, hasLaunched: true, recents: [] }).hasLaunched).toBe(true);
  });

  it('a failed launch write is actionable and does not poison subsequent saves', async () => {
    let fail = true;
    const writes: unknown[] = [];
    const store = new SettingsStore('/unused/settings.json', {
      warn: () => {}, write: async (_file: string, state: unknown) => {
        if (fail) throw new Error('Disk full');
        writes.push(state);
      },
    });
    expect(await store.beginLaunch()).toMatchObject({ firstRun: true, error: expect.stringContaining('空间和权限') });
    expect(store.state.hasLaunched).toBe(false);
    fail = false;
    const entry = await store.remember(path.resolve('.agents', 'new.pdf'));
    expect(store.authorized(entry.id).id).toBe(entry.id);
    expect(writes).toHaveLength(1);
  });

  it('reports corrupt settings but still persists the launch marker', async () => {
    const file = path.join(await workspace(), 'settings.json');
    await fs.writeFile(file, '{broken');
    const store = new SettingsStore(file, { warn: () => {} });
    await store.load();
    expect(await store.beginLaunch()).toMatchObject({ firstRun: true, error: expect.stringContaining('重新打开 PDF') });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).hasLaunched).toBe(true);
  });
});

describe('main-process integration', () => {
  async function main() {
    const handlers = new Map<string, (...args: any[]) => Promise<any>>();
    const windows: any[] = [];
    const reads = new Map<string, ReturnType<typeof deferred<Uint8Array>>>();
    const loaded = deferred<void>();
    class MockWindow extends EventEmitter {
      destroyed = false;
      maximized = false;
      fullscreen = false;
      webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'http://127.0.0.1:5173/' }, isDestroyed: () => this.destroyed,
        send: vi.fn(), setWindowOpenHandler: vi.fn(),
      });
      minimize = vi.fn();
      close = vi.fn();
      setMenuBarVisibility = vi.fn();
      show = vi.fn();
      constructor(public options: any) { super(); windows.push(this); }
      isDestroyed() { return this.destroyed; }
      isMaximized() { return this.maximized; }
      isFullScreen() { return this.fullscreen; }
      maximize() { this.maximized = true; this.emit('maximize'); }
      unmaximize() { this.maximized = false; this.emit('unmaximize'); }
      async loadURL() { loaded.resolve(); }
    }
    const app = Object.assign(new EventEmitter(), {
      isPackaged: false, setName() {}, getPath: () => '/unused', requestSingleInstanceLock: () => true,
      whenReady: async () => {}, quit: vi.fn(),
    });
    const electron = {
      app, BrowserWindow: MockWindow, ipcMain: { handle: (channel: string, action: any) => handlers.set(channel, action) },
      Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: (value: unknown) => value },
      dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(async () => ({ response: 0 })) },
      protocol: { registerSchemesAsPrivileged() {} }, shell: {},
      session: { defaultSession: Object.assign(new EventEmitter(), {
        setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
      }) },
    };
    class Store {
      async load() {}
      async beginLaunch() { return { firstRun: true }; }
      lastPath() { return undefined; }
      async remember(filePath: string) { return { id: filePath }; }
    }
    const security = require('../electron/security.cjs');
    runInNewContext(readFileSync(require.resolve('../electron/main.cjs'), 'utf8'), {
      require: (name: string) => {
        if (name === 'electron') return electron;
        if (name === './settings.cjs') return { SettingsStore: Store };
        if (name === './startup.cjs') return { StartupSession };
        if (name === './security.cjs') return {
          ...security, resolvePdf: async (filePath: string) => filePath,
          readPdf: async (filePath: string) => reads.get(filePath)?.promise ?? new Uint8Array([1]),
        };
        return require(name);
      },
      __dirname: path.resolve('electron'), console: { ...console, warn: vi.fn() },
      process: { platform: 'linux', argv: ['electron', '.'], env: { PANO_DEV_SERVER_URL: 'http://127.0.0.1:5173/' } },
    });
    await loaded.promise;
    const call = (channel: string, ...args: unknown[]) => {
      const contents = windows.at(-1).webContents;
      return handlers.get(channel)!({ sender: contents, senderFrame: contents.mainFrame }, ...args);
    };
    const tick = () => new Promise<void>(resolve => setImmediate(resolve));
    return { app, windows, handlers, reads, call, tick, electron };
  }

  it('creates a frameless isolated window, validates every new IPC and uses normal close', async () => {
    const { windows, call, handlers, electron } = await main();
    const target = windows[0];
    expect(target.options).toMatchObject({ frame: false, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    expect(target.setMenuBarVisibility).toHaveBeenCalledWith(false);
    for (const [channel, args] of [
      ['pano:startup', []], ['pano:startup-ready', []], ['pano:window-state', []],
      ['pano:window-action', ['close']], ['pano:listen', ['window-state', true]],
    ] as const) {
      await expect(handlers.get(channel)!({ sender: {}, senderFrame: {} }, ...args)).rejects.toThrow('不受信任');
      await expect(call(channel, ...args, 'extra')).rejects.toThrow('参数无效');
    }
    await expect(call('pano:window-action', 'destroy')).rejects.toThrow('参数无效');
    await call('pano:listen', 'window-state', true);
    await call('pano:window-action', 'toggle-maximize');
    expect(await call('pano:window-state')).toEqual({ maximized: true, fullscreen: false });
    expect(target.webContents.send).toHaveBeenLastCalledWith('pano:window-state', { maximized: true, fullscreen: false });
    await call('pano:window-action', 'toggle-maximize');
    await call('pano:window-action', 'minimize');
    await call('pano:window-action', 'close');
    expect(target.minimize).toHaveBeenCalledTimes(1);
    expect(target.close).toHaveBeenCalledTimes(1);
    const menu = electron.Menu.setApplicationMenu.mock.calls[0][0] as any[];
    expect(menu[0].submenu.find((entry: any) => entry.accelerator === 'CmdOrCtrl+W').role).toBeUndefined();
  });

  it('gates native delivery on both startup acknowledgement and subscription, preserving FIFO across window replacement', async () => {
    const { app, windows, reads, call, tick } = await main();
    app.emit('open-file', { preventDefault() {} }, '/B.pdf');
    app.emit('open-file', { preventDefault() {} }, '/A.pdf');
    await call('pano:listen', 'file', true);
    await tick();
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
    expect((await call('pano:startup')).file.name).toBe('B.pdf');
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
    await call('pano:listen', 'file', false);
    await call('pano:startup-ready');
    await tick();
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
    const reading = deferred<Uint8Array>();
    reads.set('/A.pdf', reading);
    await call('pano:listen', 'file', true);
    await tick();
    app.emit('open-file', { preventDefault() {} }, '/C.pdf');
    windows[0].destroyed = true;
    windows[0].emit('closed');
    app.emit('activate');
    await tick();
    expect(windows).toHaveLength(2);
    const startup = call('pano:startup');
    reading.resolve(new Uint8Array([1]));
    expect((await startup).file.name).toBe('A.pdf');
    await call('pano:listen', 'file', true);
    await call('pano:startup-ready');
    await tick();
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
    expect(windows[1].webContents.send.mock.calls.map((event: any[]) => [event[0], event[1].name]))
      .toEqual([['pano:file', 'C.pdf']]);
  });
});

describe('sandboxed preload', () => {
  function preload() {
    let bridge: any;
    const listeners = new Map<string, (event: unknown, value: unknown) => void>();
    const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => channel === 'pano:startup'
      ? { firstRun: true, file: pdf('initial') } : undefined);
    runInNewContext(readFileSync(require.resolve('../electron/preload.cjs'), 'utf8'), {
      require: (name: string) => {
        expect(name).toBe('electron');
        return {
          contextBridge: { exposeInMainWorld: (_key: string, api: unknown) => { bridge = api; } },
          ipcRenderer: { invoke, on: (channel: string, callback: (event: unknown, value: unknown) => void) => listeners.set(channel, callback) },
          webUtils: {},
        };
      },
      process: { platform: 'darwin' }, console, setTimeout,
    });
    return { bridge, invoke, listeners };
  }

  it('acknowledges startup in a later task, not on early subscription or before promise resolution', async () => {
    vi.useFakeTimers();
    const { bridge, invoke } = preload();
    bridge.onOpenFile(() => {});
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['pano:listen']);
    expect((await bridge.getStartup()).file.name).toBe('initial');
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['pano:listen', 'pano:startup']);
    await vi.runAllTimersAsync();
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['pano:listen', 'pano:startup', 'pano:startup-ready']);
  });

  it('validates actions and supports validated state events with idempotent unsubscription', async () => {
    const { bridge, invoke, listeners } = preload();
    await expect(bridge.windowAction('destroy')).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await bridge.windowAction('close');
    expect(invoke).toHaveBeenCalledWith('pano:window-action', 'close');
    const callback = vi.fn();
    const off = bridge.onWindowState(callback);
    expect(invoke).toHaveBeenCalledWith('pano:listen', 'window-state', true);
    listeners.get('pano:window-state')!({}, { maximized: true, fullscreen: false });
    listeners.get('pano:window-state')!({}, { maximized: 'yes', fullscreen: false });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ maximized: true, fullscreen: false });
    off();
    off();
    listeners.get('pano:window-state')!({}, { maximized: false, fullscreen: true });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter(call => call[0] === 'pano:listen' && call[2] === false)).toHaveLength(1);
    const command = vi.fn();
    bridge.onCommand(command);
    listeners.get('pano:command')!({}, 'close-document');
    listeners.get('pano:command')!({}, 'destroy');
    expect(command).toHaveBeenCalledExactlyOnceWith('close-document');
  });
});
