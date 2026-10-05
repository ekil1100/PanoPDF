import { Clock, Context, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import {
  AppError,
  attempt,
  errorCause,
  external,
  makeSerialWork,
  reportDefect,
} from './app-effects';
import type {
  AppCommand,
  DesktopBridge,
  FindState,
  OpenedFile,
  OutlineEntry,
  ReaderCallbacks,
  ReaderController,
  ReaderState,
  ReadingPosition,
  RecentFile,
  WindowAction,
  WindowState,
} from './contracts';

export type AppPhase = 'empty' | 'opening' | 'ready' | 'error' | 'closing';
export interface AppState {
  phase: AppPhase;
  firstRun: boolean;
  startupPending: boolean;
  activeFile: Pick<OpenedFile, 'id' | 'name'> | null;
  reader: ReaderState | null;
  outline: OutlineEntry[];
  recent: RecentFile[];
  password: { incorrect: boolean; requestId: number } | null;
  notice: string;
  error: string;
  status: string;
  windowState: WindowState;
  closingWindow: boolean;
}
export type AppEvent =
  | { type: 'focus-reader' | 'focus-empty' | 'focus-error' | 'reset-document' | 'pick-file' }
  | { type: 'command'; command: AppCommand }
  | { type: 'find'; state: FindState };
export interface AppControllerOptions {
  bridge?: DesktopBridge;
  createReader(callbacks: ReaderCallbacks): ReaderController;
  onChange(state: AppState): void;
  onEvent(event: AppEvent): void;
  openExternal?(url: string): void;
}
export interface AppController {
  readonly reader: ReaderController;
  getState(): AppState;
  start(): void;
  open(file: OpenedFile): Promise<void>;
  openPicker(): void;
  openLocal(file: File): void;
  openRecent(id: string): void;
  closeDocument(): void;
  resolvePassword(value: string | null): void;
  dismissNotice(): void;
  notice(message: string): void;
  setStatus(message: string): void;
  windowAction(action: WindowAction): void;
  flushPosition(): Promise<void>;
  requestWindowClose(): Promise<void>;
  dispose(): Promise<void>;
  whenIdle(): Promise<void>;
}

export function initialAppState(desktop: boolean): AppState {
  return {
    phase: 'empty',
    firstRun: !desktop,
    startupPending: desktop,
    activeFile: null,
    reader: null,
    outline: [],
    recent: [],
    password: null,
    notice: '',
    error: '',
    status: '打开 PDF 或 EPUB 开始阅读',
    windowState: { maximized: false, fullscreen: false },
    closingWindow: false,
  };
}

function explainError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|密码/i.test(message)) return '未能解锁此 PDF。请重新打开并输入正确密码。';
  if (/invalid.*pdf|invalidpdf/i.test(message))
    return '此文件不是有效的 PDF，或文件已损坏。请尝试其他文件。';
  if (/ENOENT|not found|不存在|已移动/i.test(message))
    return '文件已移动或删除。请通过“打开”重新选择文件。';
  if (/permission|EACCES|权限/i.test(message))
    return '没有读取此文件的权限。请检查文件权限后重试。';
  return /[\u4e00-\u9fff]/u.test(message) ? message : fallback;
}

// The only platform dependency of the program. Solid and tests provide the same service.
export const AppEnvironment = Context.Service<AppControllerOptions>('PanoPDF/AppEnvironment');

export const makeAppController = Effect.gen(function* () {
  const options = yield* AppEnvironment;
  const context = yield* Effect.context<never>();
  // Event callbacks retain the instance's injected Clock, Logger and other runtime services.
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const runFork = Effect.runForkWith(context);
  const { bridge } = options;
  const lifetime = yield* Scope.make('parallel');
  const externalScope = yield* Scope.fork(lifetime, 'parallel');
  const subscriptionScope = yield* Scope.fork(lifetime);
  const operationScope = yield* Scope.fork(lifetime, 'parallel');
  const saveScope = yield* Scope.fork(lifetime, 'parallel');
  const operations = yield* makeSerialWork(operationScope);
  const saves = yield* makeSerialWork(saveScope);
  let state = initialAppState(!!bridge);
  let started = false;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let windowClose: Promise<void> | undefined;
  let pendingPosition: { readonly id: string; readonly position: ReadingPosition } | null = null;
  let saveTimer: Fiber.Fiber<void> | undefined;
  let openingError = '';
  let passwordCancelled = false;
  let passwordSequence = 0;
  let passwordAnswer: Deferred.Deferred<string | null> | null = null;
  let recentRequest = 0;
  let windowRevision = 0;
  const sessionFiles = new Map<
    string,
    { readonly file: OpenedFile; readonly lastOpened: number }
  >();
  const latestPositions = new Map<string, ReadingPosition>();
  const active = () => !disposed && !state.closingWindow;
  const reading = () => active() && (state.phase === 'opening' || state.phase === 'ready');

  function update(patch: Partial<AppState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    options.onChange({ ...state });
  }
  function event(value: AppEvent) {
    if (active()) options.onEvent(value);
  }
  function notice(message: string) {
    if (active()) update({ notice: message });
  }
  const inform = (message: string) => Effect.sync(() => notice(message));
  const recoverFile = (error: AppError) =>
    inform(explainError(errorCause(error), '无法读取文件。请重新选择本地 PDF 或 EPUB。'));
  function enqueue(task: Effect.Effect<void, AppError>) {
    if (!active()) return Effect.void;
    const fiber = operations.submit(
      Effect.suspend(() => (active() ? task : Effect.void)).pipe(Effect.catch(recoverFile)),
    );
    return Fiber.await(fiber).pipe(Effect.asVoid);
  }
  function background(task: Effect.Effect<unknown>) {
    if (active())
      runSync(
        Effect.forkIn(task.pipe(Effect.catchCause(reportDefect)), externalScope, {
          startImmediately: true,
        }),
      );
  }
  const readFile = <A>(
    operation: Extract<AppError, { _tag: 'FileAccessError' }>['operation'],
    run: () => Promise<A>,
  ) =>
    external(
      attempt(run, (cause) => AppError.FileAccessError({ operation, cause })),
      externalScope,
    );
  const readerTask = (
    operation: Extract<AppError, { _tag: 'ReaderError' }>['operation'],
    run: () => Promise<void>,
  ) => attempt(run, (cause) => AppError.ReaderError({ operation, cause }));
  const platformTask = <A>(
    operation: Extract<AppError, { _tag: 'PlatformError' }>['operation'],
    run: () => Promise<A>,
  ) => attempt(run, (cause) => AppError.PlatformError({ operation, cause }));
  function subscribe(acquire: () => () => void) {
    // acquireRelease also releases a resource acquired during synchronous disposal re-entry.
    runSync(
      Effect.acquireRelease(Effect.sync(acquire), (unsubscribe) =>
        Effect.sync(unsubscribe).pipe(Effect.catchCause(reportDefect)),
      ).pipe(Scope.provide(subscriptionScope)),
    );
  }

  function stagePosition(id: string, position: ReadingPosition) {
    latestPositions.delete(id);
    latestPositions.set(id, { ...position });
    if (latestPositions.size > 64) latestPositions.delete(latestPositions.keys().next().value!);
    pendingPosition = { id, position: { ...position } };
  }
  function capturePosition() {
    // A loaded reader may still be awaiting its outline inside open().
    if (!reading() || !state.activeFile) return;
    const position = reader.getPosition();
    if (position) stagePosition(state.activeFile.id, position);
  }
  function cancelSaveTimer() {
    const timer = saveTimer;
    saveTimer = undefined;
    if (timer) runSync(Fiber.interrupt(timer));
  }
  function flushPending(): Effect.Effect<void> {
    cancelSaveTimer();
    const snapshot = pendingPosition;
    pendingPosition = null;
    if (snapshot) {
      saves.submit(
        Effect.gen(function* () {
          // The effect owns both identity and values, independent of the active document.
          if (bridge)
            yield* attempt(
              () => bridge.savePosition(snapshot.id, snapshot.position),
              (cause) => AppError.PositionSaveError({ id: snapshot.id, cause }),
            );
          else {
            const entry = sessionFiles.get(snapshot.id);
            if (entry)
              sessionFiles.set(snapshot.id, {
                ...entry,
                file: { ...entry.file, position: { ...snapshot.position } },
              });
          }
        }).pipe(
          Effect.catchTag('PositionSaveError', () =>
            inform('阅读位置未能保存。可以继续阅读，但下次可能无法恢复到这里。'),
          ),
        ),
      );
    }
    return saves.idle;
  }
  function rememberPosition(position: ReadingPosition) {
    if (!active() || state.phase !== 'ready' || !state.activeFile) return;
    stagePosition(state.activeFile.id, position);
    cancelSaveTimer();
    saveTimer = runSync(
      Effect.forkIn(
        Effect.sleep('450 millis').pipe(
          Effect.andThen(
            Effect.sync(() => {
              saveTimer = undefined;
              if (active()) flushPending();
            }),
          ),
        ),
        externalScope,
        { startImmediately: true },
      ),
    );
  }

  function finishPassword(value: string | null) {
    const answer = passwordAnswer;
    if (!answer) return;
    passwordAnswer = null;
    passwordCancelled = value === null;
    if (disposed) state = { ...state, password: null };
    else update({ password: null });
    runSync(Deferred.succeed(answer, value));
  }

  const reader = yield* Effect.acquireRelease(
    Effect.sync(() =>
      options.createReader({
        onState(next) {
          if (!reading()) return;
          const snapshot = {
            ...next,
            zoomChoices: next.zoomChoices.map((choice) => ({ ...choice })),
          };
          if (state.phase === 'ready' && !next.loaded) {
            update({
              reader: snapshot,
              phase: 'error',
              outline: [],
              status: '文档不可用',
              error: explainError(openingError, '文档渲染已停止，请重新打开文件后重试。'),
            });
            event({ type: 'reset-document' });
          } else update({ reader: snapshot });
        },
        onPosition: rememberPosition,
        onOutline(outline) {
          if (reading()) update({ outline: [...outline] });
        },
        onFind(next) {
          if (active() && state.phase === 'ready') event({ type: 'find', state: { ...next } });
        },
        onError(message) {
          if (!reading()) return;
          openingError = message;
          if (state.phase !== 'opening')
            notice(explainError(message, '部分页面无法显示。请重新打开文件后重试。'));
        },
        onPassword(incorrect) {
          if (!active() || state.phase !== 'opening' || passwordCancelled)
            return runPromise(Effect.succeed(null));
          finishPassword(null);
          if (!active()) return runPromise(Effect.succeed(null));
          passwordCancelled = false;
          const answer = runSync(Deferred.make<string | null>());
          passwordAnswer = answer;
          update({ password: { incorrect, requestId: ++passwordSequence } });
          return runPromise(Deferred.await(answer));
        },
        onExternalLink(url) {
          if (!active() || state.phase !== 'ready') return;
          const task = Effect.gen(function* () {
            const parsed = yield* Effect.try({
              try: () => new URL(url),
              catch: () => AppError.InputError({ message: '此链接地址无效。' }),
            });
            if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol))
              return yield* Effect.fail(
                AppError.InputError({
                  message: '为保护本地文件，已阻止打开此类型的链接。',
                }),
              );
            if (bridge)
              yield* platformTask('external-link', () => bridge.openExternal(parsed.href));
            else
              yield* Effect.try({
                try: () => options.openExternal?.(parsed.href),
                catch: (cause) => AppError.PlatformError({ operation: 'external-link', cause }),
              });
          }).pipe(
            Effect.catchTags({
              InputError: ({ message }) => inform(message),
              PlatformError: () => inform('无法打开链接，请检查默认浏览器设置。'),
            }),
          );
          background(task);
        },
      }),
    ),
    (owned) =>
      readerTask('destroy', () => owned.destroy()).pipe(
        Effect.catchTag('ReaderError', (error) =>
          Effect.logError('Reader destruction failed', error),
        ),
        Effect.catchCause(reportDefect),
      ),
  ).pipe(Scope.provide(lifetime));

  const loadRecent = Effect.suspend(() => {
    const request = ++recentRequest;
    return Effect.gen(function* () {
      const files = bridge
        ? yield* readFile('recent-list', () => bridge.getRecent())
        : [...sessionFiles.values()].map(({ file, lastOpened }) => ({
            id: file.id,
            name: file.name,
            lastOpened,
            page: file.position?.page ?? 1,
          }));
      if (!active() || request !== recentRequest || !files) return;
      update({
        recent: files
          .map((file) => ({ ...file }))
          .sort((a, b) => b.lastOpened - a.lastOpened)
          .slice(0, 5),
      });
    }).pipe(
      Effect.catchTag('FileAccessError', () =>
        request === recentRequest
          ? inform('无法读取最近文件列表。仍可通过“打开”选择 PDF 或 EPUB。')
          : Effect.void,
      ),
    );
  });

  const releaseDocument = Effect.gen(function* () {
    capturePosition();
    update({ phase: 'closing' });
    event({ type: 'reset-document' });
    yield* flushPending();
    if (!active()) return;
    yield* readerTask('close', () => reader.close());
    if (!active()) return;
    update({ activeFile: null, reader: null, outline: [], error: '' });
  });
  const closeDocument = (status = '打开 PDF 或 EPUB 开始阅读') =>
    Effect.gen(function* () {
      yield* releaseDocument;
      if (!active()) return;
      update({ phase: 'empty', status });
      event({ type: 'focus-empty' });
      background(loadRecent);
    });
  const openDocument = (file: OpenedFile): Effect.Effect<void, AppError> =>
    Effect.gen(function* () {
      if (!active()) return;
      yield* releaseDocument;
      if (!active()) return;
      // Release captures A before choosing a queued B -> A restore snapshot.
      const saved = latestPositions.get(file.id) ?? file.position;
      const restored = saved ? { ...saved } : undefined;
      openingError = '';
      passwordCancelled = false;
      update({
        activeFile: { id: file.id, name: file.name },
        phase: 'opening',
        status: '正在读取文档…',
      });
      // The synchronous UI notification makes the host measurable before reader.open.
      if (!active()) return;
      yield* Effect.gen(function* () {
        yield* readerTask('open', () =>
          reader.open(
            file.data,
            restored,
            file.format ?? (/\.epub$/i.test(file.name) ? 'epub' : 'pdf'),
          ),
        );
        if (!active()) return;
        if (passwordCancelled) return yield* closeDocument('已取消打开');
        // PDF.js may report failure through callbacks and still resolve its open Promise.
        if (!state.reader?.loaded)
          return yield* Effect.fail(
            AppError.ReaderError({
              operation: 'open',
              cause: openingError || 'Document did not load',
            }),
          );
        update({ phase: 'ready', firstRun: false, status: '就绪' });
        if (!active()) return;
        reader.refreshLayout();
        event({ type: 'focus-reader' });
        if (openingError) notice(explainError(openingError, '文档已打开，但部分内容无法显示。'));
        if (active()) {
          const position = reader.getPosition();
          if (position) rememberPosition(position);
        }
      }).pipe(
        Effect.catchTag('ReaderError', (error) =>
          Effect.gen(function* () {
            if (!active()) return;
            if (passwordCancelled) return yield* closeDocument('已取消打开');
            update({ phase: 'closing' });
            if (!active()) return;
            yield* readerTask('close', () => reader.close());
            if (!active()) return;
            update({
              phase: 'error',
              reader: null,
              outline: [],
              status: '打开失败',
              error: explainError(
                error.cause,
                '无法读取此文档。文件可能已损坏或格式不受支持，请尝试其他文件。',
              ),
            });
            event({ type: 'focus-error' });
          }),
        ),
      );
    });

  const canPick = () => active() && !state.startupPending && !state.password;
  const controller: AppController = {
    reader,
    getState: () => ({ ...state }),
    start() {
      if (started || !active()) return;
      started = true;
      if (!bridge) {
        background(loadRecent);
        return;
      }
      // Queue first, subscribe second. Preload acknowledges getStartup on the next task.
      enqueue(
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const startup = yield* readFile('startup', () => bridge.getStartup());
            if (!active() || !startup) return;
            update({ firstRun: startup.firstRun });
            if (startup.error) notice(startup.error);
            if (startup.file) yield* openDocument(startup.file);
          }).pipe(
            Effect.catch((error) =>
              inform(
                explainError(
                  errorCause(error),
                  '无法恢复上次的文档，请从“文件”菜单重新打开 PDF 或 EPUB。',
                ),
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (active()) update({ startupPending: false });
              }),
            ),
          );
          background(loadRecent);
        }),
      );
      subscribe(() =>
        bridge.onOpenFile((file) => {
          void controller.open(file);
        }),
      );
      if (!active()) return;
      subscribe(() =>
        bridge.onCommand((command) => {
          if (active() && !state.password) event({ type: 'command', command });
        }),
      );
      if (!active()) return;
      subscribe(() =>
        bridge.onWindowState((next) => {
          if (!active()) return;
          windowRevision++;
          update({ windowState: { ...next } });
        }),
      );
      if (!active()) return;
      const revision = windowRevision;
      background(
        platformTask('window-state', () => bridge.getWindowState()).pipe(
          Effect.tap((next) =>
            Effect.sync(() => {
              if (active() && revision === windowRevision) update({ windowState: { ...next } });
            }),
          ),
          Effect.catchTag('PlatformError', () => Effect.void),
        ),
      );
    },
    open(file) {
      const snapshot = { ...file, position: file.position ? { ...file.position } : undefined };
      return runPromise(enqueue(openDocument(snapshot)));
    },
    openPicker() {
      if (!canPick()) return;
      if (!bridge) {
        event({ type: 'pick-file' });
        return;
      }
      enqueue(
        Effect.gen(function* () {
          const file = yield* readFile('picker', () => bridge.openFile());
          if (active() && file) yield* openDocument(file);
        }),
      );
    },
    openLocal(file) {
      if (!canPick()) return;
      enqueue(
        Effect.gen(function* () {
          if (
            (!/\.(pdf|epub)$/i.test(file.name) &&
              !['application/pdf', 'application/epub+zip'].includes(file.type)) ||
            file.size > 256 * 1024 * 1024
          )
            return yield* Effect.fail(
              AppError.InputError({ message: '请选择不超过 256 MiB 的 PDF 或 EPUB 文件。' }),
            );
          if (bridge) {
            const opened = yield* readFile('drop', () => bridge.openDropped(file));
            if (active() && opened) yield* openDocument(opened);
          } else {
            const buffer = yield* readFile('bytes', () => file.arrayBuffer());
            if (!active() || !buffer) return;
            const opened: OpenedFile = {
              id: `session:${crypto.randomUUID()}`,
              name: file.name,
              format:
                /\.epub$/i.test(file.name) || file.type === 'application/epub+zip' ? 'epub' : 'pdf',
              data: new Uint8Array(buffer),
            };
            sessionFiles.set(opened.id, {
              file: opened,
              lastOpened: yield* Clock.currentTimeMillis,
            });
            yield* openDocument({ ...opened, data: opened.data.slice() });
          }
        }),
      );
    },
    openRecent(id) {
      if (!canPick()) return;
      enqueue(
        Effect.gen(function* () {
          if (bridge) {
            const opened = yield* readFile('recent', () => bridge.openRecent(id));
            if (active() && opened) yield* openDocument(opened);
          } else {
            const entry = sessionFiles.get(id);
            if (!entry)
              return yield* Effect.fail(
                AppError.InputError({ message: '本次会话中的文件已不可用，请重新打开。' }),
              );
            sessionFiles.set(id, { ...entry, lastOpened: yield* Clock.currentTimeMillis });
            yield* openDocument({ ...entry.file, data: entry.file.data.slice() });
          }
        }),
      );
    },
    closeDocument() {
      if (!active()) return;
      if (state.phase === 'opening') passwordCancelled = true;
      finishPassword(null);
      enqueue(closeDocument());
    },
    resolvePassword(value) {
      if (active()) finishPassword(value);
    },
    dismissNotice() {
      notice('');
    },
    notice,
    setStatus(message) {
      if (active()) update({ status: message });
    },
    windowAction(action) {
      if (bridge)
        background(
          platformTask('window-action', () => bridge.windowAction(action)).pipe(
            Effect.catchTag('PlatformError', () => inform('窗口操作失败，请重试。')),
          ),
        );
    },
    flushPosition() {
      if (active()) capturePosition();
      return runPromise(flushPending());
    },
    requestWindowClose() {
      if (windowClose) return windowClose;
      if (disposed) return disposal!;
      const done = runSync(Deferred.make<void>());
      windowClose = runPromise(Deferred.await(done));
      capturePosition();
      state = { ...state, closingWindow: true };
      const saved = flushPending();
      finishPassword(null);
      runFork(Scope.close(externalScope, Exit.void));
      runFork(saved.pipe(Effect.ensuring(Deferred.succeed(done, undefined))));
      update({ closingWindow: true });
      return windowClose;
    },
    dispose() {
      if (disposal) return disposal;
      const done = runSync(Deferred.make<void>());
      // Publish before synchronous finalizers or UI callbacks can re-enter disposal.
      disposal = runPromise(Deferred.await(done));
      capturePosition();
      disposed = true;
      finishPassword(null);
      flushPending();
      // Parallel scope finalizers start destroy immediately, then await owned work/saves.
      runFork(
        Scope.close(lifetime, Exit.void).pipe(
          Effect.catchCause(reportDefect),
          Effect.ensuring(
            Effect.sync(() => {
              sessionFiles.clear();
              latestPositions.clear();
            }),
          ),
          Effect.ensuring(Deferred.succeed(done, undefined)),
        ),
      );
      return disposal;
    },
    whenIdle: () => runPromise(operations.idle),
  };
  return controller;
});

/** Solid/Promise interop lives at this boundary; the program consumes an Effect service. */
export const createAppController = (options: AppControllerOptions): AppController =>
  Effect.runSync(makeAppController.pipe(Effect.provideService(AppEnvironment, options)));
