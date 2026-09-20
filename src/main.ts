/// <reference types="vite/client" />
import './style.css';
import { icon, type IconName } from './icons';
import { createReader } from './reader';
import type { FindState, LayoutMode, OpenedFile, OutlineEntry, ReaderState, ReadingPosition, RecentFile, ScrollInput } from './contracts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}
const ui = {
  container: element<HTMLDivElement>('viewerContainer'), viewer: element<HTMLDivElement>('viewer'),
  filename: element('filename'), empty: element('emptyState'), loading: element('loadingState'), error: element('errorState'),
  page: element<HTMLInputElement>('pageNumber'), zoom: element<HTMLInputElement>('zoomPercent'),
  zoomMode: element<HTMLSelectElement>('zoomMode'), layout: element<HTMLSelectElement>('layoutMode'),
  columns: element<HTMLInputElement>('columns'), scroll: element<HTMLSelectElement>('scrollInput'),
  sidebar: element('sidebar'), search: element<HTMLInputElement>('searchQuery'),
  password: element<HTMLDialogElement>('passwordDialog'), passwordInput: element<HTMLInputElement>('passwordInput'),
  file: element<HTMLInputElement>('browserFile'), status: element('statusMessage'),
};
for (const node of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon as IconName));
}
const bridge = window.panopdf;
const isMac = /mac/i.test(bridge?.platform ?? navigator.platform);
const openShortcut = isMac ? '⌘ O' : 'Ctrl O';
element('openShortcut').textContent = openShortcut;
element('openFile').title = `打开 PDF（${openShortcut}）`;
element('searchToggle').title = `搜索文档（${isMac ? '⌘' : 'Ctrl'} F）`;
if (!bridge) {
  element('privacyNote').textContent = '浏览器预览：文件不上传，阅读位置仅在本次会话保留。';
  element('storageStatus').textContent = '浏览器预览 · 仅本次会话';
}

type Phase = 'empty' | 'opening' | 'ready' | 'error' | 'closing';
type Panel = 'outline' | 'search';
type SavedPosition = { id: string; position: ReadingPosition };
let phase: Phase = 'empty';
let activeFile: Pick<OpenedFile, 'id' | 'name'> | null = null;
let state: ReaderState | null = null;
let panel: Panel | null = null;
let operationTail = Promise.resolve();
let saveTail = Promise.resolve();
let pendingPosition: SavedPosition | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let findTimer: ReturnType<typeof setTimeout> | undefined;
let lastQuery = '';
let openingError = '';
let passwordCancelled = false;
let passwordResolve: ((value: string | null) => void) | null = null;
let passwordFocus: HTMLElement | null = null;
let panelFocus: HTMLElement | null = null;
let disposed = false;
let closingWindow = false;
let allowWindowClose = false;
let recentRequest = 0;
let outlineSequence = 0;
const sessionFiles = new Map<string, { file: OpenedFile; lastOpened: number }>();
// Native open events may carry a disk snapshot older than a queued document switch.
const latestPositions = new Map<string, ReadingPosition>();
const listeners = new AbortController();
const unsubscribers: (() => void)[] = [];

type UIEvents = HTMLElementEventMap & DocumentEventMap & WindowEventMap;
function listen<K extends keyof UIEvents>(node: HTMLElement | Document | Window, event: K, callback: (event: UIEvents[K]) => void) {
  node.addEventListener(event, callback as EventListener, { signal: listeners.signal });
}
function click(id: string, callback: () => void) { listen(element(id), 'click', callback); }
function disabled(id: string, value: boolean) { element<HTMLButtonElement>(id).disabled = value; }
function notice(message: string) {
  if (disposed) return;
  element('noticeText').textContent = message;
  element('notice').hidden = false;
}
function explainError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|密码/i.test(message)) return '未能解锁此 PDF。请重新打开并输入正确密码。';
  if (/invalid.*pdf|invalidpdf|格式|损坏/i.test(message)) return '此文件不是有效的 PDF，或文件已损坏。请尝试其他文件。';
  if (/ENOENT|not found|不存在|已移动/i.test(message)) return '文件已移动或删除。请通过“打开”重新选择文件。';
  if (/permission|EACCES|权限/i.test(message)) return '没有读取此文件的权限。请检查文件权限后重试。';
  return /[\u4e00-\u9fff]/u.test(message) ? message : fallback;
}
function enqueue(operation: () => Promise<void>) {
  operationTail = operationTail.then(async () => {
    if (!disposed && !closingWindow) await operation();
  }).catch(error => {
    console.error('File operation failed', error);
    notice(explainError(error, '无法读取文件。请重新选择本地 PDF。'));
  });
}

// Each queued write owns an immutable document ID and position. Never read activeFile inside the write.
function flushPosition(): Promise<void> {
  clearTimeout(saveTimer);
  const snapshot = pendingPosition;
  pendingPosition = null;
  if (snapshot) {
    saveTail = saveTail.then(async () => {
      if (bridge) {
        await bridge.savePosition(snapshot.id, snapshot.position);
      } else {
        const entry = sessionFiles.get(snapshot.id);
        if (entry) entry.file.position = snapshot.position;
      }
    }).catch(error => {
      console.error('Could not save reading position', error);
      notice('阅读位置未能保存。可以继续阅读，但下次可能无法恢复到这里。');
    });
  }
  return saveTail;
}
function stagePosition(id: string, position: ReadingPosition) {
  const snapshot = { ...position };
  latestPositions.delete(id);
  latestPositions.set(id, snapshot);
  if (latestPositions.size > 64) latestPositions.delete(latestPositions.keys().next().value!);
  pendingPosition = { id, position: snapshot };
}
function rememberPosition(position: ReadingPosition) {
  if (phase !== 'ready' || !activeFile || disposed || closingWindow) return;
  stagePosition(activeFile.id, position);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushPosition(), 450);
}
function capturePosition() {
  if (phase !== 'ready' || !activeFile) return;
  const position = reader.getPosition();
  if (position) stagePosition(activeFile.id, position);
}

const reader = createReader(ui.container, ui.viewer, {
  onState(next) {
    if (disposed || phase === 'closing' || phase === 'empty') return;
    state = next;
    if (phase === 'ready' && !next.loaded) {
      phase = 'error';
      showPanel(null);
      element('errorMessage').textContent = explainError(openingError, 'PDF 渲染已停止，请重新打开文件后重试。');
      ui.status.textContent = '文档不可用';
    }
    renderControls();
  },
  onPosition: rememberPosition,
  onOutline(outline) {
    if (!disposed && (phase === 'opening' || phase === 'ready')) renderOutline(outline);
  },
  onFind(next) {
    if (!disposed && phase === 'ready' && panel === 'search' && ui.search.value.trim() === lastQuery) renderFind(next);
  },
  onError(message) {
    if (disposed || phase === 'closing' || phase === 'empty') return;
    openingError = message;
    if (phase !== 'opening') notice(explainError(message, '部分页面无法显示。请重新打开文件后重试。'));
  },
  onPassword: requestPassword,
  onExternalLink(url) {
    // A PDF is untrusted: never open file:, javascript:, or a custom protocol.
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
        notice('为保护本地文件，已阻止打开此类型的链接。');
        return;
      }
      if (bridge) void bridge.openExternal(parsed.href).catch(() => notice('无法打开链接，请检查默认浏览器设置。'));
      else window.open(parsed.href, '_blank', 'noopener,noreferrer');
    } catch { notice('此链接地址无效。'); }
  },
});

function renderControls() {
  const ready = phase === 'ready' && !!state?.loaded && !closingWindow;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[data-reader]')) control.disabled = !ready;
  disabled('closeFile', !activeFile || phase === 'closing' || closingWindow);
  ui.empty.hidden = phase !== 'empty';
  ui.loading.hidden = phase !== 'opening' && phase !== 'closing';
  ui.error.hidden = phase !== 'error';
  // Keep a measurable scrollport while PDF.js calculates its initial fit and restored anchor.
  ui.container.hidden = phase !== 'ready' && phase !== 'opening';
  ui.container.style.visibility = phase === 'opening' ? 'hidden' : '';
  element('readingArea').setAttribute('aria-busy', String(phase === 'opening' || phase === 'closing'));
  ui.filename.textContent = activeFile?.name ?? 'PanoPDF';
  ui.filename.title = activeFile?.name ?? 'PanoPDF';
  document.title = activeFile ? `${activeFile.name} — PanoPDF` : 'PanoPDF';
  if (!ready || !state) {
    ui.page.value = '—';
    element('pageTotal').textContent = '/ —';
    disabled('previousFind', true);
    disabled('nextFind', true);
    element('documentStatus').textContent = '';
    return;
  }
  if (document.activeElement !== ui.page) ui.page.value = String(state.page);
  if (document.activeElement !== ui.zoom) ui.zoom.value = `${Math.round(state.scale * 100)}%`;
  element('pageTotal').textContent = `/ ${state.pages}`;
  element('pageTotal').setAttribute('aria-label', `共 ${state.pages} 页`);
  disabled('previousPage', state.page <= 1);
  disabled('nextPage', state.page >= state.pages);
  ui.layout.value = state.layout;
  ui.scroll.value = state.scrollInput;
  ui.scroll.hidden = state.layout !== 'horizontal';
  element('columnsControl').hidden = state.layout !== 'vertical';
  if (document.activeElement !== ui.columns) ui.columns.value = String(state.columns);
  for (let count = 1; count <= 4; count++) {
    const option = ui.zoomMode.querySelector<HTMLOptionElement>(`option[value="pages-${count}"]`)!;
    const choice = state.zoomChoices.find(item => item.pages === count);
    option.textContent = choice ? `${Math.round(choice.scale * 100)}% · 容纳 ${count} 页` : `容纳 ${count} 页`;
    option.disabled = !choice;
  }
  ui.zoomMode.value = state.zoomMode === 'pages' ? `pages-${state.fitPages}` : state.zoomMode;
  if (!ui.zoomMode.value) ui.zoomMode.value = 'custom';
  element('documentStatus').textContent = `第 ${state.page} / ${state.pages} 页 · ${Math.round(state.scale * 100)}%`;
}

function resetFind() {
  clearTimeout(findTimer);
  lastQuery = '';
  ui.search.value = '';
  renderFind({ current: 0, total: 0, pending: false, notFound: false });
}
function renderFind(found: FindState) {
  const hasQuery = !!ui.search.value.trim();
  element('findCount').textContent = !hasQuery ? '输入文字开始搜索' : found.pending ? '正在搜索…' : found.notFound || found.total === 0 ? '未找到匹配' : `${found.current} / ${found.total} 处`;
  element('findHelp').textContent = hasQuery && !found.pending && (found.notFound || found.total === 0) ? '试试更短的词，或检查拼写。扫描版 PDF 可能不含可搜索的文字。' : '匹配内容会在页面中高亮显示。';
  disabled('previousFind', !hasQuery || found.pending || found.total === 0);
  disabled('nextFind', !hasQuery || found.pending || found.total === 0);
}
function search(previous = false, again = false) {
  clearTimeout(findTimer);
  if (phase !== 'ready') return;
  const query = ui.search.value.trim();
  const isRepeat = again && query === lastQuery;
  lastQuery = query;
  if (!query) {
    reader.closeFind();
    renderFind({ current: 0, total: 0, pending: false, notFound: false });
    return;
  }
  renderFind({ current: 0, total: 0, pending: true, notFound: false });
  reader.find(query, { previous, again: isRepeat });
}
function showPanel(next: Panel | null, restoreFocus = false) {
  if (next && phase !== 'ready') return;
  const previous = panel;
  if (!panel && next) panelFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  panel = next;
  if (previous === 'search' && next !== 'search') {
    clearTimeout(findTimer);
    reader.closeFind();
  }
  ui.sidebar.hidden = !next;
  element('outlinePanel').hidden = next !== 'outline';
  element('searchPanel').hidden = next !== 'search';
  for (const name of ['outline', 'search'] as const) {
    element(`${name}Toggle`).setAttribute('aria-expanded', String(next === name));
    element(`${name}Tab`).setAttribute('aria-selected', String(next === name));
    element(`${name}Tab`).tabIndex = next === name ? 0 : -1;
  }
  if (next === 'search') {
    ui.search.focus();
    ui.search.select();
    if (ui.search.value.trim()) search();
  } else if (next === 'outline') element('outlineTab').focus();
  else if (restoreFocus) {
    const target = panelFocus?.isConnected && !panelFocus.closest('[hidden]') ? panelFocus : ui.container;
    target.focus();
  }
  if (phase === 'ready') reader.refreshLayout();
}
function renderOutline(entries: OutlineEntry[]) {
  const host = element('outline');
  host.replaceChildren();
  element('outlineEmpty').hidden = entries.length > 0;
  const makeList = (items: OutlineEntry[]): HTMLUListElement => {
    const list = document.createElement('ul');
    list.className = 'outline-list';
    for (const entry of items) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'outline-row';
      const label = entry.title.trim() || '未命名章节';
      if (entry.children.length) {
        const children = makeList(entry.children);
        children.id = `outline-children-${++outlineSequence}`;
        children.hidden = true;
        const toggle = document.createElement('button');
        toggle.className = 'icon-button outline-disclosure';
        toggle.type = 'button';
        toggle.innerHTML = icon('next');
        toggle.setAttribute('aria-label', `展开“${label}”`);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', children.id);
        // Element-owned handlers are collected with the removed outline subtree.
        toggle.onclick = () => {
          children.hidden = !children.hidden;
          toggle.innerHTML = icon(children.hidden ? 'next' : 'down');
          toggle.setAttribute('aria-expanded', String(!children.hidden));
          toggle.setAttribute('aria-label', `${children.hidden ? '展开' : '收起'}“${label}”`);
        };
        row.append(toggle);
        item.append(row, children);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'outline-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        row.append(spacer);
        item.append(row);
      }
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'outline-link';
      link.textContent = label;
      link.disabled = entry.target === null || entry.target === undefined;
      link.onclick = () => {
        if (phase !== 'ready') return;
        const fileId = activeFile?.id;
        void reader.goToOutline(entry.target).catch(() => {
          if (activeFile?.id === fileId) notice('无法跳转到该章节，请通过页码定位。');
        });
      };
      row.append(link);
      list.append(item);
    }
    return list;
  };
  host.append(makeList(entries));
}

function requestPassword(incorrect: boolean): Promise<string | null> {
  if (disposed || closingWindow) return Promise.resolve(null);
  finishPassword(null);
  passwordFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ui.passwordInput.value = '';
  ui.passwordInput.setAttribute('aria-invalid', String(incorrect));
  element('passwordError').hidden = !incorrect;
  ui.password.showModal();
  ui.passwordInput.focus();
  return new Promise(resolve => { passwordResolve = resolve; });
}
function finishPassword(value: string | null) {
  if (!passwordResolve) return;
  const resolve = passwordResolve;
  passwordResolve = null;
  passwordCancelled = value === null;
  if (ui.password.open) ui.password.close();
  ui.passwordInput.value = '';
  if (passwordFocus?.isConnected && !passwordFocus.closest('[hidden]')) passwordFocus.focus();
  else element('openFile').focus();
  passwordFocus = null;
  resolve(value);
}
listen(element<HTMLFormElement>('passwordForm'), 'submit', event => {
  event.preventDefault();
  finishPassword(ui.passwordInput.value);
});
click('cancelPassword', () => finishPassword(null));
listen(ui.password, 'cancel', event => { event.preventDefault(); finishPassword(null); });
listen(ui.password, 'close', () => { if (!ui.password.open) finishPassword(null); });
listen(ui.passwordInput, 'input', () => {
  ui.passwordInput.removeAttribute('aria-invalid');
  element('passwordError').hidden = true;
});

async function releaseDocument() {
  capturePosition();
  phase = 'closing';
  showPanel(null);
  resetFind();
  renderControls();
  // Freeze the old identity before awaiting IO; close must finish before assigning a new identity.
  await flushPosition();
  await reader.close();
  activeFile = null;
  state = null;
  renderOutline([]);
}
async function openDocument(file: OpenedFile) {
  if (disposed || closingWindow) return;
  // Prefer current-session progress over snapshots captured by native events before their delivery.
  const savedPosition = latestPositions.get(file.id) ?? file.position;
  const restoredPosition = phase === 'ready' && activeFile?.id === file.id ? reader.getPosition() ?? savedPosition : savedPosition;
  await releaseDocument();
  if (disposed || closingWindow) return;
  activeFile = { id: file.id, name: file.name };
  phase = 'opening';
  openingError = '';
  passwordCancelled = false;
  element('loadingTitle').textContent = '正在打开 PDF…';
  element('loadingFilename').textContent = file.name;
  ui.status.textContent = '正在读取文档…';
  renderControls();
  try {
    await reader.open(file.data, restoredPosition);
    if (disposed || closingWindow) return;
    if (passwordCancelled) {
      await closeDocument();
      ui.status.textContent = '已取消打开';
      return;
    }
    if (!state?.loaded) throw new Error(openingError || 'PDF did not load');
    phase = 'ready';
    renderControls();
    reader.refreshLayout();
    ui.container.focus();
    ui.status.textContent = '就绪';
    if (openingError) notice(explainError(openingError, '文档已打开，但部分内容无法显示。'));
    const position = reader.getPosition();
    if (position) rememberPosition(position);
  } catch (error) {
    if (disposed || closingWindow) return;
    if (passwordCancelled) {
      await closeDocument();
      ui.status.textContent = '已取消打开';
    } else {
      console.error('PDF open failed', error);
      // Quiesce reader callbacks before presenting the failure or processing the next file.
      phase = 'closing';
      await reader.close();
      state = null;
      phase = 'error';
      element('errorMessage').textContent = explainError(error, '无法读取此 PDF。文件可能已损坏或格式不受支持，请尝试其他文件。');
      ui.status.textContent = '打开失败';
      renderControls();
      element('errorOpen').focus();
    }
  }
}
async function closeDocument() {
  await releaseDocument();
  phase = 'empty';
  ui.status.textContent = '打开 PDF 开始阅读';
  renderControls();
  element('emptyOpen').focus();
  void loadRecent();
}
async function localFile(file: File): Promise<OpenedFile> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('请选择 PDF 文件。');
  const opened: OpenedFile = { id: `session:${crypto.randomUUID()}`, name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
  sessionFiles.set(opened.id, { file: opened, lastOpened: Date.now() });
  return opened;
}
function openPicker() {
  if (disposed || closingWindow || ui.password.open) return;
  if (!bridge) { ui.file.click(); return; }
  enqueue(async () => {
    const file = await bridge.openFile();
    if (file) await openDocument(file);
  });
}
async function loadRecent() {
  const request = ++recentRequest;
  try {
    const files: RecentFile[] = bridge ? await bridge.getRecent() : [...sessionFiles.values()].map(({ file, lastOpened }) => ({ id: file.id, name: file.name, lastOpened, page: file.position?.page ?? 1 }));
    if (request !== recentRequest || disposed) return;
    const list = element('recentList');
    list.replaceChildren();
    element('recentTitle').textContent = bridge ? '最近打开' : '本次会话';
    for (const recent of files.sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 5)) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-button';
      button.innerHTML = icon('document');
      button.title = recent.name;
      const name = document.createElement('span');
      name.className = 'recent-name';
      name.textContent = recent.name;
      const page = document.createElement('span');
      page.className = 'recent-page';
      page.textContent = `第 ${recent.page} 页`;
      button.append(name, page);
      button.onclick = () => enqueue(async () => {
        let opened: OpenedFile;
        if (bridge) opened = await bridge.openRecent(recent.id);
        else {
          const entry = sessionFiles.get(recent.id);
          if (!entry) throw new Error('本次会话中的文件已不可用，请重新打开。');
          entry.lastOpened = Date.now();
          // PDF.js may transfer its input buffer to the worker. Keep the session's original intact.
          opened = { ...entry.file, data: entry.file.data.slice() };
        }
        await openDocument(opened);
      });
      item.append(button);
      list.append(item);
    }
    element('recentSection').hidden = files.length === 0;
  } catch (error) {
    console.error('Could not load recent files', error);
    if (request === recentRequest) notice('无法读取最近文件列表。仍可通过“打开”选择 PDF。');
  }
}

for (const id of ['openFile', 'emptyOpen', 'errorOpen']) click(id, openPicker);
click('closeFile', () => { finishPassword(null); enqueue(closeDocument); });
click('backToEmpty', () => enqueue(closeDocument));
click('dismissNotice', () => { element('notice').hidden = true; });
listen(ui.file, 'change', () => {
  const file = ui.file.files?.[0];
  ui.file.value = '';
  if (file) enqueue(async () => {
    const opened = await localFile(file);
    await openDocument({ ...opened, data: opened.data.slice() });
  });
});
for (const name of ['outline', 'search'] as const) {
  click(`${name}Toggle`, () => showPanel(panel === name ? null : name, true));
  click(`${name}Tab`, () => showPanel(name));
  listen(element(`${name}Tab`), 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'outline' : event.key === 'End' ? 'search' : name === 'outline' ? 'search' : 'outline';
    showPanel(next);
    element(`${next}Tab`).focus();
  });
}
click('closePanel', () => showPanel(null, true));
click('previousPage', () => { if (state) reader.goToPage(state.page - 1); });
click('nextPage', () => { if (state) reader.goToPage(state.page + 1); });
click('zoomOut', () => reader.zoomBy(1 / 1.1));
click('zoomIn', () => reader.zoomBy(1.1));
click('previousFind', () => search(true, true));
click('nextFind', () => search(false, true));
listen(ui.search, 'input', () => {
  clearTimeout(findTimer);
  if (!ui.search.value.trim()) { search(); return; }
  renderFind({ current: 0, total: 0, pending: true, notFound: false });
  findTimer = setTimeout(() => search(), 220);
});
listen(ui.search, 'keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); search(event.shiftKey, true); }
});
function commitNumber(input: HTMLInputElement, value: () => string, commit: (number: number) => void, valid: (number: number) => boolean) {
  const apply = () => {
    const text = input.value.trim().replace(/%$/, '').trim();
    const number = Number(text);
    if (text && Number.isFinite(number) && valid(number)) {
      input.removeAttribute('aria-invalid');
      commit(number);
    } else {
      input.setAttribute('aria-invalid', 'true');
      ui.status.textContent = input === ui.page ? `请输入 1 到 ${state?.pages ?? 1} 之间的整数页码。` : input === ui.columns ? '每行页数请输入 1 到 32 之间的整数。' : '缩放比例请输入 10% 到 2500% 之间的数值。';
    }
    input.value = value();
  };
  listen(input, 'change', apply);
  listen(input, 'keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); ui.container.focus(); }
    else if (event.key === 'Escape') { input.value = value(); input.removeAttribute('aria-invalid'); }
  });
  listen(input, 'focus', () => input.select());
  listen(input, 'input', () => input.removeAttribute('aria-invalid'));
}
commitNumber(ui.page, () => String(state?.page ?? 1), number => reader.goToPage(number), number => Number.isInteger(number) && number >= 1 && number <= (state?.pages ?? 1));
commitNumber(ui.zoom, () => `${Math.round((state?.scale ?? 1) * 100)}%`, number => reader.setScale(number / 100), number => number >= 10 && number <= 2500);
commitNumber(ui.columns, () => String(state?.columns ?? 1), number => reader.setColumns(number), number => Number.isInteger(number) && number >= 1 && number <= 32);
listen(ui.layout, 'change', () => reader.setLayout(ui.layout.value as LayoutMode));
listen(ui.scroll, 'change', () => reader.setScrollInput(ui.scroll.value as ScrollInput));
listen(ui.zoomMode, 'change', () => {
  const value = ui.zoomMode.value;
  if (value === 'height') reader.fitHeight();
  else if (value === 'actual') reader.setScale(1);
  else if (value.startsWith('pages-')) reader.fitPageCount(Number(value.slice(6)));
  else { ui.zoom.focus(); ui.zoom.select(); }
  renderControls();
});

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && (!!target.closest('input, textarea, select') || target.isContentEditable);
}
function command(value: 'open' | 'find' | 'zoom-in' | 'zoom-out' | 'actual-size') {
  if (disposed || closingWindow || ui.password.open) return;
  if (value === 'open') { openPicker(); return; }
  if (value === 'find') { showPanel('search'); return; }
  if (phase !== 'ready' || isEditable(document.activeElement)) return;
  if (value === 'zoom-in') reader.zoomBy(1.1);
  else if (value === 'zoom-out') reader.zoomBy(1 / 1.1);
  else reader.setScale(1);
}
listen(document, 'keydown', event => {
  if (event.defaultPrevented || event.isComposing || ui.password.open) return;
  const modified = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (modified && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'o' || key === 'f') {
      event.preventDefault();
      if (!event.repeat) command(key === 'o' ? 'open' : 'find');
    } else if (!isEditable(event.target) && phase === 'ready') {
      if (key === '+' || key === '=') { event.preventDefault(); command('zoom-in'); }
      else if (key === '-') { event.preventDefault(); command('zoom-out'); }
      else if (key === '0') { event.preventDefault(); command('actual-size'); }
    }
  } else if (event.key === 'Escape' && panel && !event.altKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    showPanel(null, true);
  }
});

let dragDepth = 0;
const isFileDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
listen(document, 'dragenter', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  if (!ui.password.open) element('dropOverlay').hidden = false;
});
listen(document, 'dragover', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = ui.password.open ? 'none' : 'copy';
});
listen(document, 'dragleave', event => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) element('dropOverlay').hidden = true;
});
listen(document, 'drop', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  element('dropOverlay').hidden = true;
  if (ui.password.open) return;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length !== 1) { notice('请一次拖入一个 PDF 文件。'); return; }
  const file = files[0];
  if (!file) return;
  enqueue(async () => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('请选择 PDF 文件。');
    const opened = bridge ? await bridge.openDropped(file) : await localFile(file);
    await openDocument(bridge ? opened : { ...opened, data: opened.data.slice() });
  });
});
listen(window, 'blur', () => { dragDepth = 0; element('dropOverlay').hidden = true; });
listen(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') { capturePosition(); void flushPosition(); }
});
listen(window, 'pagehide', () => { capturePosition(); void flushPosition(); });
// Electron honors a cancelled beforeunload. Retry closing only after the final IPC save has settled.
listen(window, 'beforeunload', event => {
  if (!bridge || allowWindowClose || disposed) { capturePosition(); void flushPosition(); return; }
  event.preventDefault();
  event.returnValue = '';
  if (closingWindow) return;
  capturePosition();
  closingWindow = true;
  finishPassword(null);
  void flushPosition().finally(() => {
    allowWindowClose = true;
    window.close();
  });
});

renderControls();
void loadRecent();
if (bridge) {
  unsubscribers.push(bridge.onOpenFile(file => enqueue(() => openDocument(file))));
  unsubscribers.push(bridge.onCommand(command));
}
// ResizeObserver catches toolbar wrapping and sidebar changes, not just window resizes.
let layoutFrame = 0;
const resize = new ResizeObserver(() => {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => { if (!disposed && phase === 'ready') reader.refreshLayout(); });
});
resize.observe(element('readingArea'));

function dispose() {
  if (disposed) return;
  capturePosition();
  disposed = true;
  finishPassword(null);
  clearTimeout(findTimer);
  clearTimeout(saveTimer);
  cancelAnimationFrame(layoutFrame);
  resize.disconnect();
  listeners.abort();
  for (const unsubscribe of unsubscribers) unsubscribe();
  void flushPosition();
  // Let any in-flight open finish before destroying its reader.
  void operationTail.finally(() => reader.destroy());
}
import.meta.hot?.dispose(dispose);
listen(window, 'unload', dispose);
