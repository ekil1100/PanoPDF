import { For } from 'solid-js';
import type { AppState } from '../app-controller';
import { Icon } from './icon';
import { Button } from './ui/button';

export function EmptyState(props: {
  state: AppState;
  desktop: boolean;
  isMac: boolean;
  open: () => void;
  openRecent: (id: string) => void;
  openRef: (node: HTMLButtonElement) => void;
}) {
  const recent = () =>
    [...props.state.recent].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 5);
  return (
    <section
      id="emptyState"
      class="empty-state"
      aria-labelledby="emptyTitle"
      hidden={props.state.phase !== 'empty'}
    >
      <div class="empty-content">
        <h1 id="emptyTitle">{props.state.firstRun ? '欢迎使用 PanoPDF' : 'PanoPDF'}</h1>
        <p class="tagline">把 PDF 铺开读。</p>
        <p id="welcomeIntro" class="welcome-intro" hidden={!props.state.firstRun}>
          打开第一份 PDF，找到适合你的阅读方式。
        </p>
        <Button
          ref={props.openRef}
          id="emptyOpen"
          class="primary-button"
          type="button"
          data-icon="open"
          disabled={props.state.startupPending || props.state.closingWindow}
          onClick={props.open}
        >
          <Icon name="open" />
          <span>打开本地 PDF</span>
        </Button>
        <p class="open-hint">
          或将 PDF 拖到此处 · <kbd id="openShortcut">{props.isMac ? '⌘ O' : 'Ctrl O'}</kbd>
        </p>
        <p id="privacyNote" class="muted local-note">
          {props.desktop
            ? '文件仅在本机读取，无需上传。'
            : '浏览器预览：文件不上传，阅读位置仅在本次会话保留。'}
        </p>
        <dl id="welcomeGuide" class="welcome-guide" hidden={!props.state.firstRun}>
          <div>
            <dt>铺开读</dt>
            <dd>横向滚动浏览多页，自由缩放决定看多少。</dd>
          </div>
          <div>
            <dt>换个布局</dt>
            <dd>切换纵向滚动，选择每行显示的页数。</dd>
          </div>
          <div>
            <dt>随时继续</dt>
            <dd>通过目录和搜索定位，下次启动接着读。</dd>
          </div>
        </dl>
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
                    <span class="recent-page">第 {file.page} 页</span>
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
