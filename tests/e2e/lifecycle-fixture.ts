import type { mountApplication as MountApplication, ApplicationMount } from '../../src/app';
import type { createReader as CreateReader } from '../../src/reader';
import type {
  AppCommand,
  DesktopBridge,
  OpenedFile,
  ReaderController,
  ReadingPosition,
  StartupState,
  WindowState,
} from '../../src/contracts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

interface MountOptions {
  bytes?: number[];
  pendingStartup?: boolean;
  pendingWindow?: boolean;
  disposeOnOpen?: boolean;
  holdSave?: boolean;
}

// Loaded only by the lifecycle spec. No test hooks are installed on the application.
export function createLifecycleFixture(
  mountApplication: typeof MountApplication,
  createReader: typeof CreateReader,
) {
  const host = document.getElementById('app')!;
  const NativeWorker = window.Worker;
  const NativeResizeObserver = window.ResizeObserver;
  const workers = new Set<Worker>();
  const observers = new Map<ResizeObserver, Set<Element>>();
  let workersCreated = 0;
  let workerReadyMessages = 0;
  let observersCreated = 0;
  let subscriptions = 0;
  let unsubscriptions = 0;

  // Delegate to native implementations: PDF.js still starts and talks to a real module worker.
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      workersCreated++;
      workers.add(this);
      this.addEventListener('message', (event) => {
        if (event.data?.action === 'ready') workerReadyMessages++;
      });
    }
    override terminate() {
      workers.delete(this);
      super.terminate();
    }
  };
  window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      observersCreated++;
    }
    override observe(target: Element, options?: ResizeObserverOptions) {
      super.observe(target, options);
      const targets = observers.get(this) ?? new Set<Element>();
      targets.add(target);
      observers.set(this, targets);
    }
    override unobserve(target: Element) {
      super.unobserve(target);
      const targets = observers.get(this);
      targets?.delete(target);
      if (!targets?.size) observers.delete(this);
    }
    override disconnect() {
      super.disconnect();
      observers.delete(this);
    }
  };

  function resources() {
    return {
      workers: workers.size,
      workersCreated,
      workerReadyMessages,
      observers: observers.size,
      observersCreated,
      observedTargets: [...observers.values()].reduce((sum, targets) => sum + targets.size, 0),
      subscriptions,
      unsubscriptions,
    };
  }
  function mount(options: MountOptions = {}) {
    const index = instances.length;
    const startup = deferred<StartupState>();
    const windowState = deferred<WindowState>();
    const save = deferred<void>();
    const events: string[] = [];
    const saved: { id: string; position: ReadingPosition; completed: boolean }[] = [];
    const listeners = {
      file: new Set<(value: OpenedFile) => void>(),
      command: new Set<(value: AppCommand) => void>(),
      window: new Set<(value: WindowState) => void>(),
    };
    let oldFile!: (value: OpenedFile) => void;
    let oldCommand!: (value: AppCommand) => void;
    let oldWindow!: (value: WindowState) => void;
    function subscribe<T>(set: Set<(value: T) => void>, callback: (value: T) => void) {
      subscriptions++;
      set.add(callback);
      return () => {
        unsubscriptions++;
        set.delete(callback);
      };
    }
    let startupCalls = 0;
    let windowCalls = 0;
    let recentCalls = 0;
    let pickerCalls = 0;
    let openCalls = 0;
    let openSettled = false;
    let destroyCalls = 0;
    let destroySettled = false;
    let passwordRequests = 0;
    const passwords: (string | null)[] = [];
    let disposal: Promise<void> | undefined;
    let disposalSettled = false;
    let samePromise = false;
    let disposing = false;
    let mountHandle!: ApplicationMount;
    let reader!: ReaderController;
    let detachedNodes: Node[] = [];
    let openHost:
      | {
          width: number;
          height: number;
          connected: boolean;
          hidden: boolean;
          visibility: string;
          busy: string | null;
        }
      | undefined;
    let openingResources: ReturnType<typeof resources> | undefined;
    let positionAtDestroy: ReadingPosition | null = null;
    let synchronousDisposal:
      | { destroyCalls: number; childNodes: number; listeners: number[]; observers: number }
      | undefined;
    const file = (bytes: number[], name = `lifecycle-${index}.pdf`): OpenedFile => ({
      id: `lifecycle-${index}`,
      name,
      data: new Uint8Array(bytes),
    });
    const bridge: DesktopBridge = {
      platform: 'linux',
      getStartup: () => {
        startupCalls++;
        return startup.promise;
      },
      getWindowState: () => {
        windowCalls++;
        return windowState.promise;
      },
      getRecent: async () => {
        recentCalls++;
        return [];
      },
      openFile: async () => {
        pickerCalls++;
        return null;
      },
      openRecent: async () => {
        throw new Error('Unexpected recent-file request');
      },
      openDropped: async () => {
        throw new Error('Unexpected dropped-file request');
      },
      windowAction: async () => {
        throw new Error('Unexpected native window action');
      },
      openExternal: async () => {
        throw new Error('Unexpected external-link request');
      },
      savePosition: async (id, position) => {
        const entry = { id, position: { ...position }, completed: false };
        saved.push(entry);
        events.push('save-started');
        if (options.holdSave) await save.promise;
        entry.completed = true;
        events.push('save-completed');
      },
      onOpenFile: (callback) => {
        oldFile = callback;
        return subscribe(listeners.file, callback);
      },
      onCommand: (callback) => {
        oldCommand = callback;
        return subscribe(listeners.command, callback);
      },
      onWindowState: (callback) => {
        oldWindow = callback;
        return subscribe(listeners.window, callback);
      },
    };
    function dispose() {
      if (!disposal) {
        detachedNodes = [...host.childNodes];
        disposing = true;
        events.push('dispose-called');
        disposal = mountHandle.dispose();
        samePromise = mountHandle.dispose() === disposal;
        synchronousDisposal = {
          destroyCalls,
          childNodes: host.childNodes.length,
          listeners: [listeners.file.size, listeners.command.size, listeners.window.size],
          observers: observers.size,
        };
        void disposal.then(() => {
          disposalSettled = true;
          events.push('dispose-completed');
        });
      } else samePromise = samePromise && mountHandle.dispose() === disposal;
      return snapshot();
    }
    function snapshot() {
      return {
        resources: resources(),
        startupCalls,
        windowCalls,
        recentCalls,
        pickerCalls,
        listeners: [listeners.file.size, listeners.command.size, listeners.window.size],
        openCalls,
        openSettled,
        openHost,
        openingResources,
        destroyCalls,
        destroySettled,
        passwordRequests,
        passwords: [...passwords],
        disposalSettled,
        samePromise,
        synchronousDisposal,
        positionAtDestroy,
        saved: saved.map((entry) => ({ ...entry })),
        events: [...events],
      };
    }
    mountHandle = mountApplication(host, {
      bridge,
      createReader(container, viewer, callbacks) {
        const actual = createReader(container, viewer, {
          ...callbacks,
          onPassword(incorrect) {
            passwordRequests++;
            const result = callbacks.onPassword(incorrect);
            void result.then((value) => {
              passwords.push(value);
            });
            return result;
          },
        });
        reader = actual;
        return {
          ...actual,
          open(data, position) {
            openCalls++;
            openHost = {
              width: container.clientWidth,
              height: container.clientHeight,
              connected: container.isConnected,
              hidden: container.hidden !== false,
              visibility: getComputedStyle(container).visibility,
              busy: document.getElementById('readingArea')!.getAttribute('aria-busy'),
            };
            const result = actual.open(data, position);
            events.push('open-returned');
            openingResources = resources();
            // Same JS task as actual.open(): its first worker-ready await has not resumed.
            if (options.disposeOnOpen) dispose();
            void result.then(() => {
              openSettled = true;
              events.push('open-completed');
            });
            return result;
          },
          getPosition() {
            const position = actual.getPosition();
            if (disposing) {
              events.push('capture-position');
              positionAtDestroy = position;
            }
            return position;
          },
          destroy() {
            destroyCalls++;
            events.push('destroy-called');
            const result = actual.destroy();
            void result.then(() => {
              destroySettled = true;
              events.push('destroy-completed');
            });
            return result;
          },
        };
      },
    });
    if (!options.pendingStartup)
      startup.resolve({ firstRun: false, file: options.bytes ? file(options.bytes) : null });
    if (!options.pendingWindow) windowState.resolve({ maximized: false, fullscreen: false });
    return {
      snapshot,
      dispose,
      async waitDisposed() {
        if (!disposal) throw new Error('Disposal has not started');
        await disposal;
      },
      getPosition() {
        return reader.getPosition();
      },
      moveAndDispose(page: number) {
        reader.goToPage(page);
        return dispose();
      },
      releaseSave() {
        save.resolve();
      },
      async completeLate(bytes: number[], outcome: 'resolve' | 'reject') {
        const markup = () => ({
          host: host.innerHTML,
          title: document.title,
          detached: detachedNodes.map((node) =>
            node instanceof Element ? node.outerHTML : node.textContent,
          ),
        });
        const before = markup();
        let mutations = 0;
        const observer = new MutationObserver((records) => {
          mutations += records.length;
        });
        for (const node of [host, document.querySelector('title')!, ...detachedNodes]) {
          observer.observe(node, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
        }
        if (outcome === 'resolve') {
          startup.resolve({
            firstRun: true,
            file: file(bytes, 'stale-startup.pdf'),
            error: 'Late startup error',
          });
          windowState.resolve({ maximized: true, fullscreen: true });
        } else {
          startup.reject(new Error('Late startup failure'));
          windowState.reject(new Error('Late window failure'));
        }
        // Model bridge deliveries already queued before unsubscribe.
        oldFile(file(bytes, 'stale-native.pdf'));
        oldCommand('open');
        oldWindow({ maximized: true, fullscreen: true });
        // One task boundary drains all promise continuations and mutation deliveries.
        await new Promise((resolve) => setTimeout(resolve, 0));
        mutations += observer.takeRecords().length;
        observer.disconnect();
        return { before, after: markup(), mutations };
      },
    };
  }
  const instances: ReturnType<typeof mount>[] = [];
  return {
    mount(options: MountOptions = {}) {
      instances.push(mount(options));
      return instances.length - 1;
    },
    instance(index: number) {
      return instances[index]!;
    },
    resources,
    cleanup() {
      for (const instance of instances) {
        instance.releaseSave();
        instance.dispose();
      }
      window.Worker = NativeWorker;
      window.ResizeObserver = NativeResizeObserver;
    },
  };
}

export type LifecycleFixture = ReturnType<typeof createLifecycleFixture>;
