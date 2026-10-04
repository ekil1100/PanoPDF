import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { AppState } from '../app-controller';
import type { FindState, OutlineEntry, ReaderController } from '../contracts';
import { Icon } from './icon';

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
  function tabKey(event: KeyboardEvent, name: Panel) {
    if (event.isComposing || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'outline'
        : event.key === 'End'
          ? 'search'
          : name === 'outline'
            ? 'search'
            : 'outline';
    props.showPanel(next);
    (next === 'outline' ? outlineTab : searchTab).focus();
  }
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
                    <button
                      class="icon-button outline-disclosure"
                      type="button"
                      aria-label={`${expanded() ? '收起' : '展开'}“${label}”`}
                      aria-expanded={expanded()}
                      aria-controls={childrenId}
                      onClick={() => setExpanded((value) => !value)}
                    >
                      <Icon name={expanded() ? 'down' : 'next'} />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="outline-link"
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
                  </button>
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
      <div class="sidebar-header">
        <div class="panel-tabs" role="tablist" aria-label="导航方式">
          <button
            ref={(node) => {
              outlineTab = node;
            }}
            id="outlineTab"
            type="button"
            role="tab"
            aria-selected={props.panel === 'outline'}
            aria-controls="outlinePanel"
            tabindex={props.panel === 'outline' ? 0 : -1}
            onClick={() => props.showPanel('outline')}
            onKeyDown={(event) => tabKey(event, 'outline')}
          >
            目录
          </button>
          <button
            ref={(node) => {
              searchTab = node;
            }}
            id="searchTab"
            type="button"
            role="tab"
            aria-selected={props.panel === 'search'}
            aria-controls="searchPanel"
            tabindex={props.panel === 'search' ? 0 : -1}
            onClick={() => props.showPanel('search')}
            onKeyDown={(event) => tabKey(event, 'search')}
          >
            搜索
          </button>
        </div>
        <button
          id="closePanel"
          class="icon-button"
          type="button"
          aria-label="收起侧栏"
          title="收起侧栏（Esc）"
          data-icon="close"
          onClick={() => props.showPanel(null, true)}
        >
          <Icon name="close" />
        </button>
      </div>
      <section
        id="outlinePanel"
        class="panel-content"
        role="tabpanel"
        aria-labelledby="outlineTab"
        hidden={props.panel !== 'outline'}
      >
        <p id="outlineEmpty" class="muted panel-message" hidden={props.state.outline.length > 0}>
          此文档没有目录。可通过页码或搜索定位内容。
        </p>
        <nav id="outline" aria-label="文档目录">
          <OutlineList entries={props.state.outline} />
        </nav>
      </section>
      <section
        id="searchPanel"
        class="panel-content"
        role="tabpanel"
        aria-labelledby="searchTab"
        hidden={props.panel !== 'search'}
      >
        <label class="field-label" for="searchQuery">
          在文档中查找
        </label>
        <input
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
          <button
            id="previousFind"
            class="icon-button"
            type="button"
            aria-label="上一个匹配"
            title="上一个匹配（Shift+Enter）"
            data-icon="up"
            disabled={!canNavigate()}
            onClick={() => search(true, true)}
          >
            <Icon name="up" />
          </button>
          <button
            id="nextFind"
            class="icon-button"
            type="button"
            aria-label="下一个匹配"
            title="下一个匹配（Enter）"
            data-icon="down"
            disabled={!canNavigate()}
            onClick={() => search(false, true)}
          >
            <Icon name="down" />
          </button>
        </div>
        <p id="findHelp" class="muted panel-message">
          {hasQuery() && !found().pending && noMatches()
            ? '试试更短的词，或检查拼写。扫描版 PDF 可能不含可搜索的文字。'
            : '匹配内容会在页面中高亮显示。'}
        </p>
      </section>
    </aside>
  );
}
