import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Clock, Effect, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import {
  AppEnvironment,
  createAppController,
  initialAppState,
  makeAppController,
} from '../src/app-controller';
import type { AppController, AppEvent, AppState } from '../src/app-controller';
import type {
  AppCommand,
  DesktopBridge,
  OpenedFile,
  ReaderCallbacks,
  ReaderController,
  ReaderState,
  ReadingPosition,
  RecentFile,
  StartupState,
  WindowState,
} from '../src/contracts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const position = (page = 1): ReadingPosition => ({
  page,
  scale: 1,
  layout: 'horizontal',
  columns: 1,
  zoomMode: 'custom',
  fitPages: 1,
  scrollInput: 'auto',
  left: 12,
  top: 720,
});
const readerState = (loaded = true, page = 1): ReaderState => ({
  ...position(page),
  loaded,
  pages: loaded ? 20 : 0,
  zoomChoices: [],
});
const file = (id = 'A', page = 1): OpenedFile => ({
  id,
  name: `${id}.pdf`,
  data: new Uint8Array([id.charCodeAt(0), 2, 3]),
  position: position(page),
});

function desktop() {
  const files = new Set<(file: OpenedFile) => void>();
  const commands = new Set<(command: AppCommand) => void>();
  const windows = new Set<(state: WindowState) => void>();
  const unsubscribers: ReturnType<typeof vi.fn>[] = [];
  function subscribe<T>(listeners: Set<(value: T) => void>, callback: (value: T) => void) {
    listeners.add(callback);
    const unsubscribe = vi.fn(() => {
      listeners.delete(callback);
    });
    unsubscribers.push(unsubscribe);
    return unsubscribe;
  }
  const bridge = {
    platform: 'darwin',
    getStartup: vi.fn(async (): Promise<StartupState> => ({ firstRun: false, file: null })),
    getWindowState: vi.fn(async (): Promise<WindowState> => ({
      maximized: false,
      fullscreen: false,
    })),
    windowAction: vi.fn(async () => {}),
    onWindowState: vi.fn((callback: (state: WindowState) => void) => subscribe(windows, callback)),
    openFile: vi.fn(async (): Promise<OpenedFile | null> => null),
    openRecent: vi.fn(async (id: string) => file(id)),
    openDropped: vi.fn(async (_file: File) => file('drop')),
    getRecent: vi.fn(async (): Promise<RecentFile[]> => []),
    savePosition: vi.fn(async (_id: string, _position: ReadingPosition) => {}),
    openExternal: vi.fn(async (_url: string) => {}),
    onOpenFile: vi.fn((callback: (file: OpenedFile) => void) => subscribe(files, callback)),
    onCommand: vi.fn((callback: (command: AppCommand) => void) => subscribe(commands, callback)),
  } satisfies DesktopBridge;
  return {
    bridge,
    files,
    commands,
    windows,
    unsubscribers,
    open: (opened: OpenedFile) => {
      for (const callback of files) callback(opened);
    },
  };
}

const controllers: AppController[] = [];
function harness(bridge?: DesktopBridge, create = createAppController) {
  let callbacks!: ReaderCallbacks;
  let current: ReadingPosition | null = null;
  const changes: AppState[] = [];
  const events: AppEvent[] = [];
  let observer: ((state: AppState) => void) | undefined;
  const reader = {
    open: vi.fn(async (_data: Uint8Array, restored?: ReadingPosition) => {
      current = { ...(restored ?? position()) };
      callbacks.onState(readerState(true, current.page));
    }),
    close: vi.fn(async () => {
      current = null;
      callbacks.onState(readerState(false));
    }),
    destroy: vi.fn(async () => {
      current = null;
    }),
    getPosition: vi.fn(() => current),
    refreshLayout: vi.fn(),
    setLayout: vi.fn(),
    setColumns: vi.fn(),
    setScale: vi.fn(),
    fitHeight: vi.fn(),
    fitPageCount: vi.fn(),
    setScrollInput: vi.fn(),
    goToPage: vi.fn(),
    zoomBy: vi.fn(),
    find: vi.fn(),
    closeFind: vi.fn(),
    goToOutline: vi.fn(async () => {}),
  } satisfies ReaderController;
  const external = vi.fn();
  const app = create({
    bridge,
    createReader: (value) => {
      callbacks = value;
      return reader;
    },
    onChange: (value) => {
      changes.push(value);
      observer?.(value);
    },
    onEvent: (event) => {
      events.push(event);
    },
    openExternal: external,
  });
  controllers.push(app);
  return {
    app,
    reader,
    callbacks,
    changes,
    events,
    external,
    observe(callback: (state: AppState) => void) {
      observer = callback;
    },
    move(value: ReadingPosition, notify = true) {
      current = value;
      if (notify) callbacks.onPosition(value);
    },
  };
}

// Drain bounded promise continuations without timers, IO, or wall-clock polling.
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((app) => app.dispose()));
  vi.useRealTimers();
});

describe('application lifecycle', () => {
  it('starts once, owns one subscription set, and destroys synchronously and idempotently', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    expect(h.app.reader).toBe(h.reader);
    expect(h.app.getState()).toEqual(initialAppState(true));
    h.app.start();
    h.app.start();
    await h.app.whenIdle();
    expect(d.bridge.getStartup).toHaveBeenCalledTimes(1);
    expect([d.files.size, d.commands.size, d.windows.size]).toEqual([1, 1, 1]);
    const disposed = h.app.dispose();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    expect(h.app.dispose()).toBe(disposed);
    expect([d.files.size, d.commands.size, d.windows.size]).toEqual([0, 0, 0]);
    await disposed;
    for (const unsubscribe of d.unsubscribers) expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('disposal boundaries', () => {
  it('can dispose before start without acquiring desktop subscriptions', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.dispose();
    h.app.start();
    await h.app.open(file());
    h.app.openPicker();
    h.app.closeDocument();
    expect(d.bridge.getStartup).not.toHaveBeenCalled();
    expect(d.unsubscribers).toHaveLength(0);
    expect(h.reader.open).not.toHaveBeenCalled();
    expect(h.reader.close).not.toHaveBeenCalled();
    expect(h.changes).toHaveLength(0);
  });

  it.each(['resolve', 'reject'] as const)(
    'abandons external startup/window waits and ignores their late %s',
    async (outcome) => {
      const d = desktop();
      const startup = deferred<StartupState>();
      const windowState = deferred<WindowState>();
      d.bridge.getStartup.mockReturnValue(startup.promise);
      d.bridge.getWindowState.mockReturnValue(windowState.promise);
      const h = harness(d.bridge);
      h.app.start();
      await drain();
      const native = [...d.files][0]!;
      const command = [...d.commands][0]!;
      const windowEvent = [...d.windows][0]!;
      const state = h.app.getState();
      const changes = h.changes.length;
      await h.app.dispose();
      await h.app.whenIdle();
      if (outcome === 'resolve') {
        startup.resolve({ firstRun: true, file: file(), error: 'Late startup error' });
        windowState.resolve({ maximized: true, fullscreen: true });
      } else {
        startup.reject(new Error('Late startup failure'));
        windowState.reject(new Error('Late window failure'));
      }
      native(file('B'));
      command('open');
      windowEvent({ maximized: true, fullscreen: true });
      h.callbacks.onState(readerState());
      h.callbacks.onOutline([{ title: 'Late', target: 'late', children: [] }]);
      h.callbacks.onPosition(position(10));
      h.callbacks.onFind({ current: 1, total: 2, pending: false, notFound: false });
      h.callbacks.onError('Late PDF failure');
      h.callbacks.onExternalLink('https://example.com/');
      expect(await h.callbacks.onPassword(false)).toBeNull();
      await drain();
      expect(h.app.getState()).toEqual(state);
      expect(h.changes).toHaveLength(changes);
      expect(h.events).toHaveLength(0);
      expect(h.reader.open).not.toHaveBeenCalled();
      expect(d.bridge.getRecent).not.toHaveBeenCalled();
      expect(d.bridge.savePosition).not.toHaveBeenCalled();
      expect(d.bridge.openExternal).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['picker', 'resolve'],
    ['picker', 'reject'],
    ['recent', 'resolve'],
    ['recent', 'reject'],
    ['drop', 'resolve'],
    ['drop', 'reject'],
  ] as const)('abandons a pending %s request and ignores its late %s', async (kind, outcome) => {
    const d = desktop();
    const request = deferred<OpenedFile>();
    d.bridge.openFile.mockReturnValue(request.promise);
    d.bridge.openRecent.mockReturnValue(request.promise);
    d.bridge.openDropped.mockReturnValue(request.promise);
    const h = harness(d.bridge);
    h.app.start();
    await h.app.whenIdle();
    if (kind === 'picker') h.app.openPicker();
    else if (kind === 'recent') h.app.openRecent('A');
    else h.app.openLocal(new File(['PDF'], 'drop.pdf'));
    const queued = h.app.open(file('B'));
    await drain();
    const count = h.changes.length;
    await h.app.dispose();
    await queued;
    await h.app.whenIdle();
    if (outcome === 'resolve') request.resolve(file());
    else request.reject(new Error('Late file request failure'));
    await drain();
    expect(h.reader.open).not.toHaveBeenCalled();
    expect(h.changes).toHaveLength(count);
  });

  it('immediately destroys an opening reader but tracks both open and destroy completion', async () => {
    const h = harness();
    const opening = deferred<void>();
    const destroying = deferred<void>();
    h.reader.open.mockReturnValue(opening.promise);
    h.reader.destroy.mockReturnValue(destroying.promise);
    const opened = h.app.open(file());
    await drain();
    expect(h.app.getState().phase).toBe('opening');
    const count = h.changes.length;
    let finished = false;
    const disposal = h.app.dispose().then(() => {
      finished = true;
    });
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    destroying.resolve();
    await drain();
    expect(finished).toBe(false);
    opening.reject(new Error('Aborted reader'));
    await disposal;
    await opened;
    expect(h.changes).toHaveLength(count);
    expect(h.events.filter((event) => event.type === 'focus-error')).toHaveLength(0);
  });

  it('settles password requests before waiting for reader cleanup and ignores new requests', async () => {
    const h = harness();
    const passwords: (string | null)[] = [];
    h.reader.open.mockImplementation(async () => {
      passwords.push(await h.callbacks.onPassword(false));
      h.callbacks.onError('Password cancelled');
      h.callbacks.onState(readerState(false));
    });
    const opened = h.app.open(file());
    await drain();
    expect(h.app.getState().password).toEqual({ incorrect: false, requestId: 1 });
    const count = h.changes.length;
    const disposal = h.app.dispose();
    expect(h.app.getState().password).toBeNull();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    expect(await h.callbacks.onPassword(true)).toBeNull();
    await disposal;
    await opened;
    expect(passwords).toEqual([null]);
    expect(h.changes).toHaveLength(count);
  });

  it.each(['save', 'destroy'] as const)(
    'captures ready progress and waits for both save and destroy (%s first)',
    async (first) => {
      const d = desktop();
      const h = harness(d.bridge);
      await h.app.open(file());
      const final = position(9);
      h.move(final, false);
      const save = deferred<void>();
      const destroy = deferred<void>();
      d.bridge.savePosition.mockReturnValue(save.promise);
      h.reader.destroy.mockImplementation(() => {
        h.callbacks.onState(readerState(false));
        h.callbacks.onError('Late destroy error');
        return destroy.promise;
      });
      const count = h.changes.length;
      let finished = false;
      const disposal = h.app.dispose().then(() => {
        finished = true;
      });
      expect(h.reader.destroy).toHaveBeenCalledTimes(1);
      final.page = 18;
      await drain();
      expect(d.bridge.savePosition).toHaveBeenCalledWith('A', position(9));
      expect(finished).toBe(false);
      (first === 'save' ? save : destroy).resolve();
      await drain();
      expect(finished).toBe(false);
      (first === 'save' ? destroy : save).resolve();
      await disposal;
      expect(h.changes).toHaveLength(count);
      expect(d.bridge.savePosition).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['close', 'error-cleanup'] as const)(
    'invalidates an in-flight %s continuation',
    async (phase) => {
      const h = harness();
      const closing = deferred<void>();
      if (phase === 'close') {
        await h.app.open(file());
        h.reader.close.mockReturnValue(closing.promise);
        h.app.closeDocument();
      } else {
        h.reader.open.mockImplementation(async () => {
          h.callbacks.onError('Invalid PDF');
          h.callbacks.onState(readerState(false));
        });
        h.reader.close.mockImplementationOnce(async () => {}).mockReturnValue(closing.promise);
        void h.app.open(file());
      }
      await drain();
      expect(h.app.getState().phase).toBe('closing');
      const count = h.changes.length;
      const events = h.events.length;
      let finished = false;
      const disposal = h.app.dispose().then(() => {
        finished = true;
      });
      expect(h.reader.destroy).toHaveBeenCalledTimes(1);
      await drain();
      expect(finished).toBe(false);
      closing.resolve();
      await disposal;
      await h.app.whenIdle();
      expect(h.changes).toHaveLength(count);
      expect(h.events).toHaveLength(events);
    },
  );

  it('destroys before a blocked switch save finishes and never closes or opens afterward', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    h.move(position(8), false);
    const save = deferred<void>();
    d.bridge.savePosition.mockReturnValue(save.promise);
    const opened = h.app.open(file('B'));
    await drain();
    expect(h.app.getState().phase).toBe('closing');
    const closeCount = h.reader.close.mock.calls.length;
    const disposal = h.app.dispose();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    save.reject(new Error('Save failed during disposal'));
    await disposal;
    await opened;
    expect(h.reader.close).toHaveBeenCalledTimes(closeCount);
    expect(h.reader.open).toHaveBeenCalledTimes(1);
    expect(h.app.getState().notice).toBe('');
  });

  it('repeated instances release exactly their own subscriptions', async () => {
    const d = desktop();
    for (let index = 0; index < 4; index++) {
      const h = harness(d.bridge);
      h.app.start();
      await h.app.whenIdle();
      expect([d.files.size, d.commands.size, d.windows.size]).toEqual([1, 1, 1]);
      await h.app.open(file());
      await h.app.dispose();
      expect([d.files.size, d.commands.size, d.windows.size]).toEqual([0, 0, 0]);
    }
    expect(d.unsubscribers).toHaveLength(12);
    for (const unsubscribe of d.unsubscribers) expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('file and save ordering', () => {
  it('publishes opening synchronously before reader.open and keeps old state snapshots stable', async () => {
    const h = harness();
    const initial = h.app.getState();
    h.reader.open.mockImplementation(async () => {
      expect(h.changes.at(-1)?.phase).toBe('opening');
      expect(h.changes.at(-1)?.activeFile).toEqual({ id: 'A', name: 'A.pdf' });
      h.callbacks.onState(readerState());
    });
    await h.app.open(file());
    expect(h.app.getState().phase).toBe('ready');
    expect(initial).toEqual(initialAppState(false));
    expect(h.changes.find((state) => state.phase === 'opening')?.reader).toBeNull();
    expect(h.events.at(-1)).toEqual({ type: 'focus-reader' });
  });

  it('restores current-session A progress after queued native B -> A events with stale disk positions', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    h.app.start();
    await h.app.whenIdle();
    await h.app.open(file());
    const latest = position(9);
    h.move(latest, false);
    const save = deferred<void>();
    d.bridge.savePosition.mockImplementationOnce(() => save.promise);
    const staleA = file('A', 1);
    d.open(file('B', 3));
    d.open(staleA);
    staleA.position!.page = 17;
    staleA.id = 'mutated';
    await drain();
    expect(h.reader.open).toHaveBeenCalledTimes(1);
    expect(d.bridge.savePosition).toHaveBeenCalledWith('A', position(9));
    latest.page = 19;
    h.callbacks.onPosition(position(20));
    save.resolve();
    await h.app.whenIdle();
    expect(h.reader.open.mock.calls.map((call) => call[1]?.page)).toEqual([1, 3, 9]);
    expect(h.app.getState().activeFile).toEqual({ id: 'A', name: 'A.pdf' });
    expect(d.bridge.savePosition.mock.calls.map(([id, saved]) => [id, saved.page])).toEqual([
      ['A', 9],
      ['B', 3],
    ]);
  });

  it('reopening the current ID captures progress before choosing its restore snapshot', async () => {
    const h = harness();
    await h.app.open(file());
    h.move(position(7), false);
    await h.app.open(file('A', 2));
    expect(h.reader.open.mock.calls[1]?.[1]).toEqual(position(7));
  });

  it('serializes writes with immutable identity and values while later writes and switches queue', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    const first = deferred<void>();
    d.bridge.savePosition.mockImplementationOnce(() => first.promise);
    h.move(position(2), false);
    const savedFirst = h.app.flushPosition();
    const second = position(8);
    h.move(second, false);
    const savedSecond = h.app.flushPosition();
    second.page = 18;
    h.move(position(10), false);
    const opened = h.app.open(file('B'));
    await drain();
    expect(d.bridge.savePosition.mock.calls).toEqual([['A', position(2)]]);
    first.resolve();
    await Promise.all([savedFirst, savedSecond, opened]);
    expect(d.bridge.savePosition.mock.calls).toEqual([
      ['A', position(2)],
      ['A', position(8)],
      ['A', position(10)],
    ]);
    h.move(position(4), false);
    await h.app.flushPosition();
    expect(d.bridge.savePosition).toHaveBeenLastCalledWith('B', position(4));
  });

  it('debounces callback snapshots and recovers after a failed write', async () => {
    vi.useFakeTimers();
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    const latest = position(5);
    h.move(latest);
    latest.page = 16;
    await vi.advanceTimersByTimeAsync(449);
    expect(d.bridge.savePosition).not.toHaveBeenCalled();
    d.bridge.savePosition.mockRejectedValueOnce(new Error('Disk unavailable'));
    await vi.advanceTimersByTimeAsync(1);
    expect(d.bridge.savePosition).toHaveBeenLastCalledWith('A', position(5));
    expect(h.app.getState().notice).toContain('阅读位置未能保存');
    h.move(position(6), false);
    await h.app.flushPosition();
    expect(d.bridge.savePosition).toHaveBeenLastCalledWith('A', position(6));
  });

  it('queues startup ahead of synchronous native delivery and keeps the later explicit file', async () => {
    const d = desktop();
    d.bridge.getStartup.mockResolvedValue({ firstRun: false, file: file('A', 4) });
    const subscribe = d.bridge.onOpenFile.getMockImplementation()!;
    d.bridge.onOpenFile.mockImplementation((callback) => {
      const unsubscribe = subscribe(callback);
      callback(file('B', 2));
      return unsubscribe;
    });
    const h = harness(d.bridge);
    h.app.start();
    await h.app.whenIdle();
    expect(h.reader.open.mock.calls.map((call) => call[0][0])).toEqual([65, 66]);
    expect(h.app.getState().activeFile?.id).toBe('B');
    expect(h.app.getState().startupPending).toBe(false);
  });

  it('allows preload acknowledgement while startup reader.open is still pending', async () => {
    vi.useFakeTimers();
    const d = desktop();
    const startup = deferred<StartupState>();
    const opening = deferred<void>();
    const acknowledged = vi.fn(() => d.open(file('B')));
    d.bridge.getStartup.mockImplementation(async () => {
      const result = await startup.promise;
      setTimeout(acknowledged, 0);
      return result;
    });
    const h = harness(d.bridge);
    const open = h.reader.open.getMockImplementation()!;
    h.reader.open.mockImplementationOnce(async (data, restored) => {
      await opening.promise;
      await open(data, restored);
    });
    h.app.start();
    startup.resolve({ firstRun: false, file: file('A') });
    await drain();
    expect(h.reader.open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(acknowledged).toHaveBeenCalledTimes(1);
    expect(h.reader.open).toHaveBeenCalledTimes(1);
    opening.resolve();
    await h.app.whenIdle();
    expect(h.reader.open.mock.calls.map((call) => call[0][0])).toEqual([65, 66]);
  });
});

describe('Effect services and finalizers', () => {
  it('retains an injected TestClock across reader callbacks and cancels debounce on disposal', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make();
          const d = desktop();
          const h = harness(d.bridge, (options) =>
            Effect.runSync(
              makeAppController.pipe(
                Effect.provideService(AppEnvironment, options),
                Effect.provideService(Clock.Clock, clock),
              ),
            ),
          );
          yield* Effect.promise(() => h.app.open(file()));
          h.move(position(5));
          yield* clock.adjust('449 millis');
          expect(d.bridge.savePosition).not.toHaveBeenCalled();
          yield* clock.adjust('1 millis');
          yield* Effect.promise(drain);
          expect(d.bridge.savePosition.mock.calls).toEqual([['A', position(5)]]);
          h.move(position(8));
          yield* Effect.promise(() => h.app.dispose());
          yield* clock.adjust('1 hour');
          expect(d.bridge.savePosition.mock.calls).toEqual([
            ['A', position(5)],
            ['A', position(8)],
          ]);
        }),
      ),
    );
  });

  it('logs finalizer failures through the injected Logger while releasing every resource', async () => {
    const messages: unknown[] = [];
    const logger = Logger.make((entry) => {
      messages.push(entry.message);
    });
    const d = desktop();
    const subscribe = d.bridge.onCommand.getMockImplementation()!;
    d.bridge.onCommand.mockImplementation((callback) => {
      const unsubscribe = subscribe(callback);
      return vi.fn<() => void>(() => {
        unsubscribe();
        throw new Error('Subscription finalizer failed');
      });
    });
    const h = harness(d.bridge, (options) =>
      Effect.runSync(
        makeAppController.pipe(
          Effect.provideService(AppEnvironment, options),
          Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
        ),
      ),
    );
    h.app.start();
    await h.app.whenIdle();
    await h.app.open(file());
    h.reader.destroy.mockImplementation(() => {
      throw new Error('Reader finalizer failed');
    });
    h.move(position(6), false);
    await h.app.dispose();
    expect([d.files.size, d.commands.size, d.windows.size]).toEqual([0, 0, 0]);
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    expect(d.bridge.savePosition).toHaveBeenCalledWith('A', position(6));
    expect(messages.flat()).toEqual(
      expect.arrayContaining(['Application defect', 'Reader destruction failed']),
    );
  });

  it('owns all saves when the first adapter call synchronously disposes before returning its Promise', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    const writes = [deferred<void>(), deferred<void>(), deferred<void>()];
    let disposal!: Promise<void>;
    let done = false;
    d.bridge.savePosition.mockImplementation((_id, saved) => {
      if (saved.page === 1) {
        disposal = h.app.dispose();
        void disposal.then(() => {
          done = true;
        });
      }
      return writes[saved.page - 1]!.promise;
    });
    h.move(position(1), false);
    const first = h.app.flushPosition();
    h.move(position(2), false);
    const second = h.app.flushPosition();
    h.move(position(3), false);
    await drain();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    for (let index = 0; index < writes.length; index++) {
      expect(done).toBe(false);
      expect(d.bridge.savePosition.mock.calls.map(([, saved]) => saved.page)).toEqual(
        [1, 2, 3].slice(0, index + 1),
      );
      writes[index]!.resolve();
      await drain();
    }
    await Promise.all([first, second, disposal]);
    expect(done).toBe(true);
  });
});

describe('Effect queue scheduling', () => {
  it('keeps FIFO and idle when a Promise reaction submits work as a predecessor finishes', async () => {
    const h = harness();
    const first = deferred<void>();
    const second = deferred<void>();
    const order: number[] = [];
    h.reader.open.mockImplementation((data) => {
      order.push(data[0]!);
      h.callbacks.onState(readerState());
      return data[0] === 65 ? first.promise : data[0] === 66 ? second.promise : Promise.resolve();
    });
    const a = h.app.open(file('A'));
    await drain();
    const b = h.app.open(file('B'));
    let c!: Promise<void>;
    void first.promise.then(() => {
      c = h.app.open(file('C'));
    });
    first.resolve();
    await drain();
    let idleSettled = false;
    const idle = h.app.whenIdle().then(() => {
      idleSettled = true;
    });
    await drain();
    const observed = { order: [...order], idleSettled };
    second.resolve();
    await Promise.all([a, b, c, idle]);
    expect(observed).toEqual({ order: [65, 66], idleSettled: false });
    expect(order).toEqual([65, 66, 67]);
    expect(h.app.getState().activeFile?.id).toBe('C');
  });

  it('keeps the final exit save last when close is requested between save completion reactions', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    const first = deferred<void>();
    const second = deferred<void>();
    const completed: number[] = [];
    d.bridge.savePosition.mockImplementation((_id, saved) =>
      (saved.page === 1
        ? first.promise
        : saved.page === 2
          ? second.promise
          : Promise.resolve()
      ).then(() => {
        completed.push(saved.page);
      }),
    );
    h.move(position(1), false);
    const savedFirst = h.app.flushPosition();
    await drain();
    h.move(position(2), false);
    const savedSecond = h.app.flushPosition();
    h.move(position(3), false);
    let closing!: Promise<void>;
    let closed = false;
    void first.promise.then(() => {
      queueMicrotask(() => {
        closing = h.app.requestWindowClose().then(() => {
          closed = true;
        });
      });
    });
    first.resolve();
    await drain();
    const earlyClose = closed;
    let disposed = false;
    const disposal = h.app.dispose().then(() => {
      disposed = true;
    });
    await drain();
    const earlyDisposal = disposed;
    second.resolve();
    await Promise.all([savedFirst, savedSecond, closing, disposal]);
    expect(earlyClose).toBe(false);
    expect(earlyDisposal).toBe(false);
    expect(completed).toEqual([1, 2, 3]);
  });
});

describe('window close is separate from disposal', () => {
  it('captures progress when window close immediately follows a queued document close', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    h.move(position(12), false);
    const closed = h.reader.close.mock.calls.length;
    h.app.closeDocument();
    await h.app.requestWindowClose();
    await h.app.whenIdle();
    expect(d.bridge.savePosition.mock.calls).toEqual([['A', position(12)]]);
    expect(h.reader.close).toHaveBeenCalledTimes(closed);
    expect(h.reader.destroy).not.toHaveBeenCalled();
  });

  it('captures immediately, freezes commands, and waits for the last serialized save without destroying', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    h.app.start();
    await h.app.whenIdle();
    await h.app.open(file());
    const first = deferred<void>();
    const last = deferred<void>();
    d.bridge.savePosition
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => last.promise);
    h.move(position(2), false);
    void h.app.flushPosition();
    h.move(position(9), false);
    const closing = h.app.requestWindowClose();
    expect(h.app.requestWindowClose()).toBe(closing);
    expect(h.app.getState().closingWindow).toBe(true);
    const count = h.changes.length;
    const closeCount = h.reader.close.mock.calls.length;
    const eventCount = h.events.length;
    let finished = false;
    void closing.then(() => {
      finished = true;
    });
    h.move(position(18));
    h.callbacks.onState(readerState(false));
    h.callbacks.onError('Late reader error');
    h.app.openPicker();
    h.app.openRecent('B');
    h.app.openLocal(new File(['PDF'], 'B.pdf'));
    h.app.closeDocument();
    h.app.windowAction('close');
    h.app.notice('Late notice');
    h.app.setStatus('Late status');
    d.open(file('B'));
    for (const command of d.commands) command('zoom-in');
    void h.app.flushPosition();
    await drain();
    expect(d.bridge.savePosition.mock.calls).toEqual([['A', position(2)]]);
    expect(finished).toBe(false);
    first.resolve();
    await drain();
    expect(d.bridge.savePosition.mock.calls).toEqual([
      ['A', position(2)],
      ['A', position(9)],
    ]);
    expect(finished).toBe(false);
    last.resolve();
    await closing;
    expect(h.reader.destroy).not.toHaveBeenCalled();
    expect(h.reader.close).toHaveBeenCalledTimes(closeCount);
    expect(h.reader.open).toHaveBeenCalledTimes(1);
    expect(d.bridge.openFile).not.toHaveBeenCalled();
    expect(d.bridge.openRecent).not.toHaveBeenCalled();
    expect(d.bridge.openDropped).not.toHaveBeenCalled();
    expect(d.bridge.windowAction).not.toHaveBeenCalled();
    expect(h.changes).toHaveLength(count);
    expect(h.events).toHaveLength(eventCount);
    await h.app.dispose();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    expect(d.bridge.savePosition).toHaveBeenCalledTimes(2);
  });

  it('saves an already loaded reader while open is still awaiting the outline', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    const outline = deferred<void>();
    h.reader.open.mockImplementation(async () => {
      h.move(position(6), false);
      h.callbacks.onState(readerState(true, 6));
      await outline.promise;
      h.callbacks.onOutline([{ title: 'Late outline', target: 'late', children: [] }]);
    });
    const opened = h.app.open(file());
    await drain();
    expect(h.app.getState().phase).toBe('opening');
    await h.app.requestWindowClose();
    expect(d.bridge.savePosition).toHaveBeenCalledWith('A', position(6));
    expect(h.reader.destroy).not.toHaveBeenCalled();
    const count = h.changes.length;
    outline.resolve();
    await opened;
    expect(h.changes).toHaveLength(count);
    expect(h.app.getState().outline).toEqual([]);
  });

  it('settles a password request and returns independently of an external startup promise', async () => {
    const d = desktop();
    const startup = deferred<StartupState>();
    d.bridge.getStartup.mockReturnValue(startup.promise);
    const starting = harness(d.bridge);
    starting.app.start();
    await drain();
    await starting.app.requestWindowClose();
    await starting.app.whenIdle();
    expect(starting.reader.destroy).not.toHaveBeenCalled();
    startup.resolve({ firstRun: true, file: file() });
    await drain();
    expect(starting.reader.open).not.toHaveBeenCalled();

    const h = harness();
    let password: string | null | undefined;
    h.reader.open.mockImplementation(async () => {
      password = await h.callbacks.onPassword(false);
    });
    void h.app.open(file());
    await drain();
    await h.app.requestWindowClose();
    await h.app.whenIdle();
    expect(password).toBeNull();
    expect(h.app.getState().password).toBeNull();
    expect(h.reader.destroy).not.toHaveBeenCalled();
  });

  it('disposal can overlap a pending window-close save without a second capture or write', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    await h.app.open(file());
    const save = deferred<void>();
    d.bridge.savePosition.mockReturnValue(save.promise);
    h.move(position(11), false);
    const closing = h.app.requestWindowClose();
    h.move(position(19), false);
    const disposal = h.app.dispose();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
    await drain();
    expect(d.bridge.savePosition.mock.calls).toEqual([['A', position(11)]]);
    save.resolve();
    await Promise.all([closing, disposal]);
  });
});

describe('passwords, callback errors, and recovery', () => {
  it('handles incorrect-password retries with distinct request IDs', async () => {
    const h = harness();
    const answers: (string | null)[] = [];
    h.reader.open.mockImplementation(async () => {
      answers.push(await h.callbacks.onPassword(false));
      answers.push(await h.callbacks.onPassword(true));
      h.callbacks.onState(readerState());
    });
    const opened = h.app.open(file());
    await drain();
    expect(h.app.getState().password).toEqual({ incorrect: false, requestId: 1 });
    h.app.resolvePassword('wrong');
    await drain();
    expect(h.app.getState().password).toEqual({ incorrect: true, requestId: 2 });
    h.app.resolvePassword('correct');
    await opened;
    expect(answers).toEqual(['wrong', 'correct']);
    expect(h.app.getState().phase).toBe('ready');
    expect(h.app.getState().password).toBeNull();
  });

  it.each(['cancel', 'close'] as const)(
    'supports password %s and subsequently opens another file',
    async (action) => {
      const h = harness();
      h.reader.open.mockImplementationOnce(async () => {
        expect(await h.callbacks.onPassword(false)).toBeNull();
        h.callbacks.onState(readerState(false));
      });
      const opened = h.app.open(file());
      await drain();
      if (action === 'cancel') h.app.resolvePassword(null);
      else h.app.closeDocument();
      await opened;
      await h.app.whenIdle();
      expect(h.app.getState().phase).toBe('empty');
      expect(h.app.getState().error).toBe('');
      await h.app.open(file('B'));
      expect(h.app.getState().phase).toBe('ready');
      expect(h.app.getState().activeFile?.id).toBe('B');
    },
  );

  it('cancels a password callback arriving after close was queued', async () => {
    const h = harness();
    const passwordReady = deferred<void>();
    h.reader.open.mockImplementationOnce(async () => {
      await passwordReady.promise;
      expect(await h.callbacks.onPassword(false)).toBeNull();
    });
    void h.app.open(file());
    await drain();
    h.app.closeDocument();
    const reopened = h.app.open(file('B'));
    passwordReady.resolve();
    await reopened;
    expect(h.changes.some((state) => state.password)).toBe(false);
    expect(h.app.getState().activeFile?.id).toBe('B');
    expect(h.app.getState().phase).toBe('ready');
  });

  it.each(['callback', 'rejection'] as const)(
    'shows an open %s failure and recovers on the next file',
    async (failure) => {
      const h = harness();
      h.reader.open.mockImplementationOnce(async () => {
        if (failure === 'rejection') throw new Error('Invalid PDF');
        h.callbacks.onError('Invalid PDF');
        h.callbacks.onState(readerState(false));
      });
      await h.app.open(file());
      expect(h.app.getState().phase).toBe('error');
      expect(h.app.getState().reader).toBeNull();
      expect(h.app.getState().error).toContain('损坏');
      expect(h.events.at(-1)).toEqual({ type: 'focus-error' });
      await h.app.open(file('B'));
      expect(h.app.getState().phase).toBe('ready');
      expect(h.app.getState().error).toBe('');
      expect(h.app.getState().activeFile?.id).toBe('B');
    },
  );

  it('distinguishes a loaded PDF with warnings from a later fatal reader failure', async () => {
    const h = harness();
    h.reader.open.mockImplementationOnce(async () => {
      h.callbacks.onError('PDF 已打开，但无法读取文档目录。');
      h.callbacks.onState(readerState());
    });
    await h.app.open(file());
    expect(h.app.getState().phase).toBe('ready');
    expect(h.app.getState().notice).toContain('目录');
    h.callbacks.onError('Worker stopped');
    h.callbacks.onState(readerState(false));
    expect(h.app.getState().phase).toBe('error');
    expect(h.app.getState().status).toBe('文档不可用');
    const count = h.events.length;
    h.callbacks.onFind({ current: 1, total: 1, notFound: false, pending: false });
    expect(h.events).toHaveLength(count);
    await h.app.open(file('B'));
    expect(h.app.getState().phase).toBe('ready');
  });

  it('recovers from startup and picker errors without poisoning the operation queue', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    d.bridge.getStartup.mockRejectedValueOnce(new Error('Startup unavailable'));
    h.app.start();
    await h.app.whenIdle();
    expect(h.app.getState().startupPending).toBe(false);
    expect(h.app.getState().notice).toContain('无法恢复');
    d.bridge.openFile.mockRejectedValueOnce(new Error('EACCES'));
    h.app.openPicker();
    await h.app.whenIdle();
    expect(h.app.getState().notice).toContain('权限');
    h.app.dismissNotice();
    d.bridge.openFile.mockResolvedValueOnce(file());
    h.app.openPicker();
    await h.app.whenIdle();
    expect(h.app.getState().phase).toBe('ready');
    expect(h.app.getState().notice).toBe('');
  });
});

describe('browser files and background requests', () => {
  it('copies browser bytes on first open and every recent reopen after worker transfer', async () => {
    const h = harness();
    const contents: number[][] = [];
    const open = h.reader.open.getMockImplementation()!;
    h.reader.open.mockImplementation(async (data, restored) => {
      contents.push([...data]);
      structuredClone(data, { transfer: [data.buffer] });
      expect(data.byteLength).toBe(0);
      await open(data, restored);
    });
    h.app.start();
    h.app.openPicker();
    expect(h.events.at(-1)).toEqual({ type: 'pick-file' });
    h.app.openLocal(new File([new Uint8Array([1, 2, 3, 4])], 'local.pdf'));
    await h.app.whenIdle();
    const id = h.app.getState().activeFile!.id;
    h.move(position(7), false);
    h.app.closeDocument();
    await h.app.whenIdle();
    expect(h.app.getState().recent).toEqual([
      { id, name: 'local.pdf', page: 7, lastOpened: expect.any(Number) },
    ]);
    for (let index = 0; index < 2; index++) {
      h.app.openRecent(id);
      await h.app.whenIdle();
      expect(h.reader.open.mock.calls.at(-1)?.[1]).toEqual(position(7));
      h.app.closeDocument();
      await h.app.whenIdle();
    }
    expect(contents).toEqual([
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]);
  });

  it('validates local files and abandons an unresolved browser byte read on disposal', async () => {
    const h = harness();
    h.app.openLocal(new File(['text'], 'text.txt'));
    await h.app.whenIdle();
    expect(h.app.getState().notice).toBe('请选择 PDF 文件。');
    const bytes = deferred<ArrayBuffer>();
    const local = new File(['PDF'], 'local.pdf');
    vi.spyOn(local, 'arrayBuffer').mockReturnValue(bytes.promise);
    h.app.openLocal(local);
    await drain();
    const count = h.changes.length;
    await h.app.dispose();
    await h.app.whenIdle();
    bytes.resolve(new ArrayBuffer(4));
    await drain();
    expect(h.reader.open).not.toHaveBeenCalled();
    expect(h.changes).toHaveLength(count);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an older recent-list request that finishes with %s',
    async (outcome) => {
      const d = desktop();
      const older = deferred<RecentFile[]>();
      const newer: RecentFile[] = [{ id: 'B', name: 'B.pdf', lastOpened: 2, page: 5 }];
      d.bridge.getRecent.mockReturnValueOnce(older.promise).mockResolvedValueOnce(newer);
      const h = harness(d.bridge);
      h.app.start();
      await h.app.whenIdle();
      h.app.closeDocument();
      await h.app.whenIdle();
      expect(h.app.getState().recent).toEqual(newer);
      if (outcome === 'resolve')
        older.resolve([{ id: 'A', name: 'A.pdf', lastOpened: 1, page: 1 }]);
      else older.reject(new Error('Old recent failure'));
      await drain();
      expect(h.app.getState().recent).toEqual(newer);
      expect(h.app.getState().notice).toBe('');
    },
  );

  it('ignores deferred recent, window-action, and external-link errors after disposal', async () => {
    const d = desktop();
    const recent = deferred<RecentFile[]>();
    const action = deferred<void>();
    const link = deferred<void>();
    d.bridge.getRecent.mockReturnValue(recent.promise);
    d.bridge.windowAction.mockReturnValue(action.promise);
    d.bridge.openExternal.mockReturnValue(link.promise);
    const h = harness(d.bridge);
    h.app.start();
    await h.app.whenIdle();
    await h.app.open(file());
    h.app.windowAction('toggle-maximize');
    h.callbacks.onExternalLink('https://example.com/');
    const count = h.changes.length;
    await h.app.dispose();
    recent.reject(new Error('Recent failure'));
    action.reject(new Error('Window action failure'));
    link.reject(new Error('External link failure'));
    await drain();
    expect(h.changes).toHaveLength(count);
    expect(h.app.getState().notice).toBe('');
  });

  it('gives native window events precedence over an older initial window-state response', async () => {
    const d = desktop();
    const initial = deferred<WindowState>();
    d.bridge.getWindowState.mockReturnValue(initial.promise);
    const h = harness(d.bridge);
    h.app.start();
    for (const callback of d.windows) callback({ maximized: true, fullscreen: false });
    initial.resolve({ maximized: false, fullscreen: false });
    await h.app.whenIdle();
    expect(h.app.getState().windowState).toEqual({ maximized: true, fullscreen: false });
  });

  it('forwards native UI commands and find results while filtering unsafe external links', async () => {
    const d = desktop();
    const h = harness(d.bridge);
    h.app.start();
    await h.app.whenIdle();
    await h.app.open(file());
    for (const callback of d.commands) callback('find');
    expect(h.events.at(-1)).toEqual({ type: 'command', command: 'find' });
    const found = { current: 1, total: 3, pending: false, notFound: false };
    h.callbacks.onFind(found);
    expect(h.events.at(-1)).toEqual({ type: 'find', state: found });
    h.callbacks.onExternalLink('file:///private/document.pdf');
    expect(d.bridge.openExternal).not.toHaveBeenCalled();
    expect(h.app.getState().notice).toContain('阻止');
    h.callbacks.onExternalLink('https://example.com/');
    expect(d.bridge.openExternal).toHaveBeenCalledWith('https://example.com/');
  });
});

describe('synchronous lifecycle notifications', () => {
  it('honors disposal from the opening notification before calling reader.open', async () => {
    const h = harness();
    h.observe((state) => {
      if (state.phase === 'opening') void h.app.dispose();
    });
    await h.app.open(file());
    await h.app.dispose();
    expect(h.reader.open).not.toHaveBeenCalled();
    expect(h.reader.destroy).toHaveBeenCalledTimes(1);
  });

  it('tracks an open promise even when a synchronous reader callback disposes its owner', async () => {
    const h = harness();
    const opening = deferred<void>();
    h.reader.open.mockImplementation(() => {
      h.callbacks.onState(readerState());
      return opening.promise;
    });
    h.observe((state) => {
      if (state.reader?.loaded) void h.app.dispose();
    });
    const opened = h.app.open(file());
    await drain();
    let finished = false;
    const disposal = h.app.dispose().then(() => {
      finished = true;
    });
    await drain();
    const early = finished;
    opening.resolve();
    await Promise.all([opened, disposal]);
    expect(early).toBe(false);
  });

  it('releases a subscription whose initial synchronous notification disposes the instance', async () => {
    const d = desktop();
    const subscribe = d.bridge.onWindowState.getMockImplementation()!;
    d.bridge.onWindowState.mockImplementation((callback) => {
      const unsubscribe = subscribe(callback);
      callback({ maximized: true, fullscreen: false });
      return unsubscribe;
    });
    const h = harness(d.bridge);
    h.observe((state) => {
      if (state.windowState.maximized) void h.app.dispose();
    });
    h.app.start();
    await h.app.dispose();
    expect([d.files.size, d.commands.size, d.windows.size]).toEqual([0, 0, 0]);
    for (const unsubscribe of d.unsubscribers) expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
