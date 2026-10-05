/* @refresh skip */
// main.tsx owns app-module replacement so final saves finish before the next mount.
// Child modules retain Solid's component-level HMR.
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createAppController,
  initialAppState,
  type AppController,
  type AppEvent,
} from './app-controller';
import type { AppCommand, DesktopBridge } from './contracts';
import { createReader } from './reader';
import { EmptyState } from './components/empty-state';
import { Icon } from './components/icon';
import { Button } from './components/ui/button';
import { Alert, AlertDescription } from './components/ui/alert';
import { Progress } from './components/ui/progress';
import { WindowControls } from './components/window-controls';
import { PasswordDialog } from './components/password-dialog';
import { ReaderHost } from './components/reader-host';
import { ReaderToolbar } from './components/reader-toolbar';
import { Sidebar, type Panel, type SidebarHandle } from './components/sidebar';

export interface MountApplicationOptions {
  bridge?: DesktopBridge;
  createReader?: typeof createReader;
}
export interface ApplicationMount {
  dispose(): Promise<void>;
}

/** Mount one application instance. The host is the existing #app layout root. */
export function mountApplication(
  host: HTMLElement,
  options: MountApplicationOptions = {},
): ApplicationMount {
  let unmount: (() => void) | undefined;
  let release: (() => Promise<void>) | undefined;
  let disposal: Promise<void> | undefined;
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    // Publish before resource release or root cleanup can re-enter this disposer.
    const completion = Promise.withResolvers<void>();
    disposal = completion.promise;
    try {
      const pending = release?.() ?? Promise.resolve();
      unmount?.();
      void pending.then(completion.resolve, completion.reject);
    } catch (error) {
      completion.reject(error);
    }
    return disposal;
  }
  unmount = render(
    () => (
      <Application
        options={options}
        dispose={dispose}
        registerRelease={(callback) => {
          release = callback;
        }}
      />
    ),
    host,
  );
  return { dispose };
}

function Application(props: {
  options: MountApplicationOptions;
  dispose(): Promise<void>;
  registerRelease(callback: () => Promise<void>): void;
}) {
  const bridge = props.options.bridge ?? window.panopdf;
  const isMac = bridge ? bridge.platform === 'darwin' : /mac/i.test(navigator.platform);
  const [state, setState] = createSignal(initialAppState(!!bridge));
  const [panel, setPanel] = createSignal<Panel | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [toolbarHovered, setToolbarHovered] = createSignal(false);
  let toolbar!: HTMLElement;
  let controller: AppController | undefined;
  let container!: HTMLDivElement;
  let viewer!: HTMLDivElement;
  let readingArea!: HTMLElement;
  let emptyOpen!: HTMLButtonElement;
  let errorOpen!: HTMLButtonElement;
  let fileInput!: HTMLInputElement;
  let sidebar!: SidebarHandle;
  let panelFocus: HTMLElement | null = null;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let dragDepth = 0;
  let layoutFrame = 0;
  let resize: ResizeObserver | undefined;
  let allowWindowClose = false;
  let closeRequested = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new AbortController();
  const ready = () =>
    state().phase === 'ready' && !!state().reader?.loaded && !state().closingWindow;
  const reader = () => controller!.reader;
  const focusReader = () => container.focus();
  const notice = (message: string) => controller?.notice(message);
  const openPicker = () => controller?.openPicker();
  const closeDocument = () => controller?.closeDocument();
  function showPanel(next: Panel | null, restoreFocus = false) {
    if (disposed || (next && !ready())) return;
    const previous = panel();
    if (!previous && next)
      panelFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (previous === 'search' && next !== 'search') sidebar.deactivate();
    setPanel(next);
    if (next) sidebar.activate(next);
    else if (restoreFocus) {
      const target =
        panelFocus?.isConnected && !panelFocus.closest('[hidden]') ? panelFocus : container;
      target.focus();
    }
    if (ready()) reader().refreshLayout();
  }
  function isEditable(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      (!!target.closest('input, textarea, select') || target.isContentEditable)
    );
  }
  function command(value: AppCommand) {
    if (disposed || state().closingWindow || state().password) return;
    if (value === 'open') {
      openPicker();
      return;
    }
    if (value === 'close-document') {
      if (state().activeFile) closeDocument();
      return;
    }
    if (value === 'find') {
      showPanel('search');
      return;
    }
    if (!ready() || isEditable(document.activeElement)) return;
    if (value === 'zoom-in') reader().zoomBy(1.1);
    else if (value === 'zoom-out') reader().zoomBy(1 / 1.1);
    else reader().setScale(1);
  }
  function onEvent(event: AppEvent) {
    if (disposed) return;
    switch (event.type) {
      case 'focus-reader':
        focusReader();
        break;
      case 'focus-empty':
        emptyOpen.focus();
        break;
      case 'focus-error':
        errorOpen.focus();
        break;
      case 'pick-file':
        fileInput.click();
        break;
      case 'reset-document':
        showPanel(null);
        sidebar.reset();
        break;
      case 'command':
        command(event.command);
        break;
      case 'find':
        sidebar.receiveFind(event.state);
        break;
    }
  }
  createEffect(() => {
    document.title = state().activeFile?.name ?? 'PanoPDF';
  });
  function release(): Promise<void> {
    if (disposal) return disposal;
    const completion = Promise.withResolvers<void>();
    disposal = completion.promise;
    disposed = true;
    try {
      listeners.abort();
      clearTimeout(closeTimer);
      cancelAnimationFrame(layoutFrame);
      resize?.disconnect();
      // Capture final progress and abort the reader before removing its DOM.
      completion.resolve(controller?.dispose());
    } catch (error) {
      completion.reject(error);
    }
    return disposal;
  }
  props.registerRelease(release);
  onCleanup(() => {
    // Component cleanup releases its resources; only the mount owner unmounts the root.
    void release().catch((error) => console.error('Application disposal failed', error));
  });
  onMount(() => {
    controller = createAppController({
      bridge,
      createReader: (callbacks) =>
        (props.options.createReader ?? createReader)(container, viewer, callbacks),
      onChange(next) {
        if (disposed) return;
        // Shallow snapshots preserve opaque reader resources. Updates are synchronous
        // so opening exposes a measurable scrollport before reader.open runs.
        setState(next);
        if (next.phase !== 'ready' || next.closingWindow) showPanel(null);
      },
      onEvent,
      openExternal: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    });
    type UIEvents = DocumentEventMap & WindowEventMap;
    function listen<K extends keyof UIEvents>(
      node: Document | Window,
      name: K,
      callback: (event: UIEvents[K]) => void,
    ) {
      node.addEventListener(name, callback as EventListener, { signal: listeners.signal });
    }
    listen(document, 'keydown', (event) => {
      if (event.defaultPrevented || event.isComposing || state().password) return;
      const modified = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (modified && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'o' || key === 'f') {
          event.preventDefault();
          if (!event.repeat) command(key === 'o' ? 'open' : 'find');
        } else if (key === 'w' && !event.shiftKey) {
          event.preventDefault();
          if (!event.repeat) command('close-document');
        } else if (!isEditable(event.target) && ready()) {
          if (key === '+' || key === '=') {
            event.preventDefault();
            command('zoom-in');
          } else if (key === '-') {
            event.preventDefault();
            command('zoom-out');
          } else if (key === '0') {
            event.preventDefault();
            command('actual-size');
          }
        }
      } else if (
        event.key === 'Escape' &&
        panel() &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        showPanel(null, true);
      }
    });
    const isFileDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
    const clearDrag = () => {
      dragDepth = 0;
      setDragging(false);
    };
    listen(document, 'dragenter', (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth++;
      if (!state().password) setDragging(true);
    });
    listen(document, 'dragover', (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = state().password ? 'none' : 'copy';
    });
    listen(document, 'dragleave', (event) => {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) setDragging(false);
    });
    listen(document, 'drop', (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      clearDrag();
      if (state().password) return;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length !== 1) {
        notice('请一次拖入一个 PDF 文件。');
        return;
      }
      if (files[0]) controller!.openLocal(files[0]);
    });
    listen(window, 'blur', clearDrag);
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') void controller!.flushPosition();
    });
    listen(window, 'pagehide', () => {
      void controller!.flushPosition();
    });
    listen(window, 'beforeunload', (event) => {
      if (!bridge || allowWindowClose || disposed) {
        void controller!.flushPosition();
        return;
      }
      event.preventDefault();
      event.returnValue = '';
      if (closeRequested) return;
      closeRequested = true;
      const retry = () => {
        if (disposed) return;
        // Even a synchronously settled save must leave the cancelled close task.
        closeTimer = setTimeout(() => {
          if (disposed) return;
          allowWindowClose = true;
          window.close();
        }, 0);
      };
      void controller!.requestWindowClose().then(retry, (error) => {
        console.error('Window close preparation failed', error);
        retry();
      });
    });
    listen(window, 'unload', () => {
      void props.dispose().catch((error) => console.error('Application disposal failed', error));
    });
    // Toolbar wrapping and sidebar changes resize the reading surface independently
    // of the window; defer refresh until all shell geometry has settled.
    resize = new ResizeObserver(() => {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        if (!disposed && ready()) reader().refreshLayout();
      });
    });
    resize.observe(readingArea);
    controller.start();
  });
  return (
    <>
      <div
        id="titlebar"
        class="mac-titlebar"
        hidden={!bridge || !isMac || state().windowState.fullscreen}
      >
        <WindowControls action={(action) => controller?.windowAction(action)} />
        <span class="mac-titlebar-title" hidden={state().phase === 'empty'}>
          {state().activeFile?.name ?? 'PanoPDF'}
        </span>
      </div>
      <Alert
        id="notice"
        variant="destructive"
        class="notice ui:flex ui:items-center ui:gap-3 ui:rounded-none ui:border-x-0 ui:border-t-0 ui:px-3 ui:py-1"
        hidden={!state().notice}
      >
        <AlertDescription id="noticeText" class="ui:flex-1">
          {state().notice}
        </AlertDescription>
        <Button
          id="dismissNotice"
          variant="ghost"
          size="icon"
          type="button"
          aria-label="关闭提示"
          data-icon="close"
          onClick={() => controller?.dismissNotice()}
        >
          <Icon name="close" />
        </Button>
      </Alert>
      <div id="workspace" class="workspace">
        <Sidebar
          state={state()}
          panel={panel()}
          reader={reader}
          showPanel={showPanel}
          notice={notice}
          sidebarRef={(handle) => {
            sidebar = handle;
          }}
        />
        <main
          ref={(node) => {
            readingArea = node;
          }}
          id="readingArea"
          class="reading-area"
          aria-label="PDF 阅读区"
          onPointerMove={(event) => {
            if (event.buttons !== 0) return;
            const bounds = toolbar.getBoundingClientRect();
            setToolbarHovered(
              event.clientX >= bounds.left &&
                event.clientX <= bounds.right &&
                event.clientY >= bounds.top &&
                event.clientY <= bounds.bottom,
            );
          }}
          onPointerLeave={() => setToolbarHovered(false)}
          aria-busy={state().phase === 'opening' || state().phase === 'closing'}
        >
          <header
            ref={(node) => {
              toolbar = node;
            }}
            data-hovered={toolbarHovered()}
            class="app-header floating-chrome"
            aria-label="阅读工具"
            hidden={state().phase !== 'ready' && state().phase !== 'opening'}
          >
            <ReaderToolbar
              state={state()}
              panel={panel()}
              isMac={isMac}
              reader={reader}
              showPanel={showPanel}
              focusReader={focusReader}
              status={(message) => controller?.setStatus(message)}
            />
          </header>
          <ReaderHost
            phase={state().phase}
            containerRef={(node) => {
              container = node;
            }}
            viewerRef={(node) => {
              viewer = node;
            }}
          />
          <EmptyState
            state={state()}
            desktop={!!bridge}
            isMac={isMac}
            dragging={dragging() && !state().password}
            open={openPicker}
            openRecent={(id) => controller?.openRecent(id)}
            openRef={(node) => {
              emptyOpen = node;
            }}
          />
          <section
            id="loadingState"
            class="center-state"
            aria-labelledby="loadingTitle"
            aria-live="polite"
            hidden={state().phase !== 'opening' && state().phase !== 'closing'}
          >
            <h2 id="loadingTitle">正在打开 PDF…</h2>
            <p id="loadingFilename" class="muted">
              {state().activeFile?.name ?? ''}
            </p>
            <Progress indeterminate class="ui:w-[180px] ui:my-1" aria-label="正在读取文档" />
            <p class="muted">大型文档可能需要稍等片刻。</p>
          </section>
          <section
            id="errorState"
            class="center-state"
            aria-labelledby="errorTitle"
            hidden={state().phase !== 'error'}
          >
            <h2 id="errorTitle">无法打开 PDF</h2>
            <Alert id="errorMessage" variant="destructive" class="ui:w-auto ui:max-w-[56ch]">
              <AlertDescription>{state().error}</AlertDescription>
            </Alert>
            <div class="state-actions">
              <Button
                ref={(node) => {
                  errorOpen = node;
                }}
                id="errorOpen"
                type="button"
                onClick={openPicker}
              >
                打开其他 PDF
              </Button>
              <Button id="backToEmpty" variant="outline" type="button" onClick={closeDocument}>
                返回
              </Button>
            </div>
          </section>
          <div
            id="dropOverlay"
            class="drop-overlay"
            hidden={!dragging() || !!state().password || state().phase === 'empty'}
          >
            <p>松开以打开 PDF</p>
          </div>
        </main>
      </div>
      <span id="statusMessage" class="sr-only" role="status" aria-live="polite">
        {state().status}
      </span>
      <footer
        class="statusbar floating-chrome"
        hidden={!ready()}
        tabindex="0"
        aria-label="阅读进度"
      >
        <span id="documentStatus">
          {ready()
            ? `第 ${state().reader!.page} / ${state().reader!.pages} 页 · ${Math.round(state().reader!.scale * 100)}%`
            : ''}
        </span>
      </footer>
      <input
        ref={(node) => {
          fileInput = node;
        }}
        id="browserFile"
        class="sr-only"
        type="file"
        accept=".pdf,application/pdf"
        tabindex="-1"
        aria-label="选择本地 PDF"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) controller?.openLocal(file);
        }}
      />
      <PasswordDialog
        request={state().password}
        resolve={(value) => controller?.resolvePassword(value)}
        focusFallback={() => {
          if (ready()) focusReader();
          else if (state().phase === 'error') errorOpen.focus();
          else emptyOpen.focus();
        }}
      />
    </>
  );
}
