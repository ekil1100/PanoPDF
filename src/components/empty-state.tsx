import { For } from 'solid-js';
import { formatForDisplay } from '@tanstack/hotkeys';
import type { AppState } from '../app-controller';
import { Icon } from './icon';
import { Button } from './ui/button';
import { Empty } from './ui/empty';
import { Kbd } from './ui/kbd';

const logoUrl = new URL('../../assets/brand/panopdf-logo-white-tile-shadow.png', import.meta.url)
  .href;

export function EmptyState(props: {
  state: AppState;
  desktop: boolean;
  isMac: boolean;
  dragging: boolean;
  open: () => void;
  openRecent: (id: string) => void;
  openRef: (node: HTMLButtonElement) => void;
}) {
  const shortcutKeys = () =>
    formatForDisplay('Mod+O', { platform: props.isMac ? 'mac' : 'windows', parts: true });
  const recent = () =>
    [...props.state.recent].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 5);
  return (
    <section
      id="emptyState"
      class="empty-state"
      aria-label="PanoPDF 欢迎页"
      hidden={props.state.phase !== 'empty'}
    >
      <div class="empty-content">
        <img class="brand-logo" src={logoUrl} alt="" width="96" height="96" />
        <Empty
          id="welcomeDropzone"
          class="welcome-dropzone ui-min-h-[152px] ui-border-0 data-[dragging=true]:ui-bg-primary/5"
          data-dragging={props.dragging ? 'true' : undefined}
          role="group"
          aria-label="拖入 PDF 或 EPUB 文件或使用按钮打开"
        >
          <Button
            ref={props.openRef}
            id="emptyOpen"
            class="primary-button"
            type="button"
            data-icon="open"
            aria-label="打开本地 PDF 或 EPUB"
            aria-keyshortcuts={props.isMac ? 'Meta+O' : 'Control+O'}
            disabled={props.state.startupPending || props.state.closingWindow}
            onClick={props.open}
          >
            <Icon name="open" />
            <span>打开本地 PDF 或 EPUB</span>
            <span id="openShortcut" class="open-shortcut" aria-hidden="true">
              <For each={shortcutKeys()}>
                {(key) => <Kbd class="ui-bg-white/10 ui-text-primary-foreground">{key}</Kbd>}
              </For>
            </span>
          </Button>
        </Empty>
        <section
          id="recentSection"
          class="recent-section"
          aria-labelledby="recentTitle"
          hidden={props.state.recent.length === 0}
        >
          <h2 id="recentTitle">{props.desktop ? '最近打开' : '本次会话'}</h2>
          <ul id="recentList" class="recent-list">
            <For each={recent()}>
              {(file) => (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    class="recent-button ui-h-auto ui-min-h-11 ui-w-full ui-justify-start ui-text-left ui-rounded-none ui-px-1 ui-py-2"
                    title={file.name}
                    onClick={() => props.openRecent(file.id)}
                  >
                    <Icon name="document" />
                    <span class="recent-name">{file.name}</span>
                    <span class="recent-page">
                      第 {file.page} {/\.epub$/i.test(file.name) ? '章' : '页'}
                    </span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </section>
  );
}
