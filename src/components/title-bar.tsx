import { createSignal } from 'solid-js';
import type { AppState } from '../app-controller';
import type { WindowAction } from '../contracts';
import { Icon } from './icon';

export interface FileMenuHandle {
  hide(): void;
  focus(): void;
}

export function TitleBar(props: {
  state: AppState;
  desktop: boolean;
  isMac: boolean;
  menuRef(handle: FileMenuHandle): void;
  open(): void;
  closeDocument(): void;
  windowAction(action: WindowAction): void;
}) {
  let menu!: HTMLDivElement;
  let button!: HTMLButtonElement;
  const [expanded, setExpanded] = createSignal(false);
  const filename = () => props.state.activeFile?.name ?? 'PanoPDF';
  const maximizeLabel = () => (props.state.windowState.maximized ? '还原窗口' : '最大化窗口');
  function hide() {
    if (menu.matches(':popover-open')) menu.hidePopover();
    setExpanded(false);
  }
  function show() {
    menu.showPopover();
    setExpanded(true);
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  props.menuRef({ hide, focus: () => button.focus() });
  return (
    <div id="titlebar" class="titlebar">
      <div class="titlebar-menu">
        <button
          ref={(node) => {
            button = node;
          }}
          id="fileMenuButton"
          class="titlebar-menu-button"
          type="button"
          aria-haspopup="menu"
          aria-controls="fileMenu"
          aria-expanded={expanded()}
          onClick={() => (menu.matches(':popover-open') ? hide() : show())}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !event.isComposing) {
              event.preventDefault();
              show();
            }
          }}
        >
          文件
        </button>
      </div>
      <span id="filename" class="filename" title={filename()}>
        {filename()}
      </span>
      <div
        id="windowControls"
        class="window-controls"
        aria-label="窗口控制"
        hidden={!props.desktop}
      >
        <button
          id="minimizeWindow"
          type="button"
          aria-label="最小化窗口"
          title="最小化窗口"
          data-icon="minus"
          onClick={() => props.windowAction('minimize')}
        >
          <Icon name="minus" />
        </button>
        <button
          id="maximizeWindow"
          type="button"
          aria-label={maximizeLabel()}
          title={maximizeLabel()}
          data-icon="maximize"
          disabled={props.state.windowState.fullscreen}
          onClick={() => props.windowAction('toggle-maximize')}
        >
          <Icon name={props.state.windowState.maximized ? 'restore' : 'maximize'} />
        </button>
        <button
          id="closeWindow"
          type="button"
          aria-label="关闭窗口"
          title="关闭窗口"
          data-icon="close"
          onClick={() => props.windowAction('close')}
        >
          <Icon name="close" />
        </button>
      </div>
      <div
        ref={(node) => {
          menu = node;
        }}
        id="fileMenu"
        class="file-menu"
        role="menu"
        aria-label="文件"
        popover="auto"
        on:toggle={() => setExpanded(menu.matches(':popover-open'))}
        onKeyDown={(event) => {
          if (event.isComposing) return;
          const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            hide();
            button.focus();
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && items.length) {
            event.preventDefault();
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]!.focus();
          } else if (event.key === 'Tab') {
            hide();
            button.focus();
          }
        }}
      >
        <button
          id="openFile"
          type="button"
          role="menuitem"
          data-icon="open"
          title={`打开 PDF（${props.isMac ? '⌘ O' : 'Ctrl O'}）`}
          disabled={props.state.startupPending || props.state.closingWindow}
          onClick={() => {
            hide();
            props.open();
          }}
        >
          <Icon name="open" />
          <span>打开 PDF…</span>
          <kbd id="menuOpenShortcut">{props.isMac ? '⌘ O' : 'Ctrl O'}</kbd>
        </button>
        <button
          id="closeFile"
          type="button"
          role="menuitem"
          data-icon="close"
          disabled={
            !props.state.activeFile || props.state.phase === 'closing' || props.state.closingWindow
          }
          onClick={() => {
            hide();
            props.closeDocument();
          }}
        >
          <Icon name="close" />
          <span>关闭文档</span>
          <kbd id="menuCloseShortcut">{props.isMac ? '⌘ W' : 'Ctrl W'}</kbd>
        </button>
      </div>
    </div>
  );
}
