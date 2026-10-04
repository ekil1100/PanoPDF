import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { AppState } from '../app-controller';
import type { FindState, OutlineEntry, ReaderController } from '../contracts';
import { Icon } from './icon';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

export type Panel = 'outline' | 'search';
export interface SidebarHandle {
  activate(panel: Panel): void;
  deactivate(): void;
  reset(): void;
  receiveFind(state: FindState): void;
}
const emptyFind = (): FindState => ({ current: 0, total: 0, pending: false, notFound: false });

export function Sidebar(props: {
  state: AppState;
  panel: Panel | null;
  reader(): ReaderController;
  showPanel(panel: Panel | null, restoreFocus?: boolean): void;
  notice(message: string): void;
  sidebarRef(handle: SidebarHandle): void;
}) {
  let searchInput!: HTMLInputElement;
  let outlineTab!: HTMLButtonElement;
  let searchTab!: HTMLButtonElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastQuery = '';
  let composing = false;
  let disposed = false;
  let outlineSequence = 0;
  const [query, setQuery] = createSignal('');
  const [found, setFound] = createSignal(emptyFind());
  const ready = () =>
    props.state.phase === 'ready' && !!props.state.reader?.loaded && !props.state.closingWindow;
  const hasQuery = () => !!query().trim();
  const noMatches = () => found().notFound || found().total === 0;
  const canNavigate = () => ready() && hasQuery() && !found().pending && found().total > 0;
  function search(previous = false, again = false) {
    clearTimeout(timer);
    if (!ready() || composing) return;
    const text = query().trim();
    const isRepeat = again && text === lastQuery;
    lastQuery = text;
    if (!text) {
      props.reader().closeFind();
      setFound(emptyFind());
      return;
    }
    setFound({ ...emptyFind(), pending: true });
    props.reader().find(text, { previous, again: isRepeat });
  }
  function scheduleSearch() {
    clearTimeout(timer);
    if (composing) return;
    if (!query().trim()) {
      search();
      return;
    }
    setFound({ ...emptyFind(), pending: true });
    timer = setTimeout(() => search(), 220);
  }
  props.sidebarRef({
    activate(panel) {
      if (panel === 'search') {
        searchInput.focus();
        searchInput.select();
        if (query().trim()) search();
      } else outlineTab.focus();
    },
    deactivate() {
      clearTimeout(timer);
      props.reader().closeFind();
    },
    reset() {
      clearTimeout(timer);
      lastQuery = '';
      composing = false;
      setQuery('');
      setFound(emptyFind());
    },
    receiveFind(state) {
      if (ready() && props.panel === 'search' && query().trim() === lastQuery) setFound(state);
    },
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });
  function OutlineList(list: { entries: OutlineEntry[]; id?: string; hidden?: boolean }) {
    return (
      <ul class="outline-list" id={list.id} hidden={list.hidden}>
        <For each={list.entries}>
          {(entry) => {
            const [expanded, setExpanded] = createSignal(false);
            const label = entry.title.trim() || '未命名章节';
            const childrenId = entry.children.length
              ? `outline-children-${++outlineSequence}`
              : undefined;
            return (
              <li>
                <div class="outline-row">
                  <Show
                    when={entry.children.length > 0}
                    fallback={<span class="outline-spacer" aria-hidden="true" />}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="icon-button outline-disclosure ui-w-6 ui-p-1 aria-expanded:ui-bg-accent aria-expanded:ui-text-accent-foreground"
                      type="button"
                      aria-label={`${expanded() ? '收起' : '展开'}“${label}”`}
                      aria-expanded={expanded()}
                      aria-controls={childrenId}
                      onClick={() => setExpanded((value) => !value)}
                    >
                      <Icon name={expanded() ? 'down' : 'next'} />
                    </Button>
                  </Show>
                  <Button
                    variant="ghost"
                    type="button"
                    class="outline-link ui-h-auto ui-whitespace-normal ui-justify-start ui-text-left ui-px-2 ui-py-1.5 ui-leading-normal"
                    disabled={entry.target === null || entry.target === undefined}
                    onClick={() => {
                      if (!ready()) return;
                      const fileId = props.state.activeFile?.id;
                      void props
                        .reader()
                        .goToOutline(entry.target)
                        .catch(() => {
                          if (!disposed && props.state.activeFile?.id === fileId)
                            props.notice('无法跳转到该章节，请通过页码定位。');
                        });
                    }}
                  >
                    {label}
                  </Button>
                </div>
                <Show when={entry.children.length > 0}>
                  <OutlineList entries={entry.children} id={childrenId} hidden={!expanded()} />
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    );
  }
  return (
    <aside id="sidebar" class="reader-sidebar" aria-label="文档导航" hidden={!props.panel}>
      <Tabs
        class="ui-flex ui-min-h-0 ui-flex-1 ui-flex-col"
        value={props.panel ?? 'outline'}
        onChange={(value) => {
          if (value !== 'outline' && value !== 'search') return;
          props.showPanel(value);
          (value === 'outline' ? outlineTab : searchTab).focus();
        }}
      >
        <div class="sidebar-header">
          <TabsList class="panel-tabs" aria-label="导航方式">
            <TabsTrigger
              value="outline"
              ref={(node) => {
                outlineTab = node;
              }}
              id="outlineTab"
              type="button"
            >
              目录
            </TabsTrigger>
            <TabsTrigger
              value="search"
              ref={(node) => {
                searchTab = node;
              }}
              id="searchTab"
              type="button"
            >
              搜索
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            id="closePanel"
            size="icon"
            class="icon-button"
            type="button"
            aria-label="收起侧栏"
            title="收起侧栏（Esc）"
            data-icon="close"
            onClick={() => props.showPanel(null, true)}
          >
            <Icon name="close" />
          </Button>
        </div>
        <TabsContent
          value="outline"
          forceMount
          id="outlinePanel"
          class="panel-content ui-px-2 ui-py-3"
          hidden={props.panel !== 'outline'}
        >
          <p id="outlineEmpty" class="muted panel-message" hidden={props.state.outline.length > 0}>
            此文档没有目录。可通过页码或搜索定位内容。
          </p>
          <nav id="outline" aria-label="文档目录">
            <OutlineList entries={props.state.outline} />
          </nav>
        </TabsContent>
        <TabsContent
          value="search"
          forceMount
          id="searchPanel"
          class="panel-content ui-px-3 ui-py-4"
          hidden={props.panel !== 'search'}
        >
          <Label class="field-label" for="searchQuery">
            在文档中查找
          </Label>
          <Input
            ref={(node) => {
              searchInput = node;
            }}
            id="searchQuery"
            type="search"
            placeholder="输入文字"
            autocomplete="off"
            spellcheck={false}
            data-reader
            disabled={!ready()}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              scheduleSearch();
            }}
            onCompositionStart={() => {
              composing = true;
              clearTimeout(timer);
            }}
            onCompositionEnd={(event) => {
              composing = false;
              setQuery(event.currentTarget.value);
              scheduleSearch();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.isComposing && !composing) {
                event.preventDefault();
                search(event.shiftKey, true);
              }
            }}
          />
          <div class="search-navigation">
            <span id="findCount" role="status" aria-live="polite">
              {!hasQuery()
                ? '输入文字开始搜索'
                : found().pending
                  ? '正在搜索…'
                  : noMatches()
                    ? '未找到匹配'
                    : `${found().current} / ${found().total} 处`}
            </span>
            <Button
              variant="ghost"
              id="previousFind"
              size="icon"
              class="icon-button"
              type="button"
              aria-label="上一个匹配"
              title="上一个匹配（Shift+Enter）"
              data-icon="up"
              disabled={!canNavigate()}
              onClick={() => search(true, true)}
            >
              <Icon name="up" />
            </Button>
            <Button
              variant="ghost"
              id="nextFind"
              size="icon"
              class="icon-button"
              type="button"
              aria-label="下一个匹配"
              title="下一个匹配（Enter）"
              data-icon="down"
              disabled={!canNavigate()}
              onClick={() => search(false, true)}
            >
              <Icon name="down" />
            </Button>
          </div>
          <p id="findHelp" class="muted panel-message">
            {hasQuery() && !found().pending && noMatches()
              ? '试试更短的词，或检查拼写。扫描版 PDF 可能不含可搜索的文字。'
              : '匹配内容会在页面中高亮显示。'}
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
