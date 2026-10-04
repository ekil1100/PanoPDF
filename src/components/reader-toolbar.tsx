import { For } from 'solid-js';
import type { AppState } from '../app-controller';
import type { LayoutMode, ReaderController, ScrollInput } from '../contracts';
import { Icon } from './icon';
import { NumberInput } from './number-input';
import type { Panel } from './sidebar';

export function ReaderToolbar(props: {
  state: AppState;
  panel: Panel | null;
  isMac: boolean;
  reader(): ReaderController;
  showPanel(panel: Panel | null, restoreFocus?: boolean): void;
  focusReader: () => void;
  status: (message: string) => void;
}) {
  const ready = () =>
    props.state.phase === 'ready' && !!props.state.reader?.loaded && !props.state.closingWindow;
  const state = () => props.state.reader;
  const zoomMode = () =>
    state()?.zoomMode === 'pages' ? `pages-${state()!.fitPages}` : (state()?.zoomMode ?? 'custom');
  const selectedZoom = () =>
    ['height', 'pages-1', 'pages-2', 'pages-3', 'pages-4'].includes(zoomMode())
      ? zoomMode()
      : 'custom';
  let zoom!: HTMLInputElement;
  return (
    <div
      id="readerToolbar"
      class="reader-toolbar"
      aria-label="文档操作"
      hidden={props.state.phase !== 'ready' && props.state.phase !== 'opening'}
    >
      <div class="control-group">
        <button
          id="outlineToggle"
          class="icon-button"
          type="button"
          aria-label="文档目录"
          title="文档目录"
          aria-controls="sidebar"
          aria-expanded={props.panel === 'outline'}
          data-icon="outline"
          data-reader
          disabled={!ready()}
          onClick={() => props.showPanel(props.panel === 'outline' ? null : 'outline', true)}
        >
          <Icon name="outline" />
        </button>
        <button
          id="searchToggle"
          class="icon-button"
          type="button"
          aria-label="搜索文档"
          title={`搜索文档（${props.isMac ? '⌘' : 'Ctrl'} F）`}
          aria-controls="sidebar"
          aria-expanded={props.panel === 'search'}
          data-icon="search"
          data-reader
          disabled={!ready()}
          onClick={() => props.showPanel(props.panel === 'search' ? null : 'search', true)}
        >
          <Icon name="search" />
        </button>
      </div>
      <span class="divider" aria-hidden="true" />
      <div class="control-group page-controls">
        <button
          id="previousPage"
          class="icon-button"
          type="button"
          aria-label="上一页"
          title="上一页"
          data-icon="previous"
          data-reader
          disabled={!ready() || (state()?.page ?? 1) <= 1}
          onClick={() => props.reader().goToPage(state()!.page - 1)}
        >
          <Icon name="previous" />
        </button>
        <label class="sr-only" for="pageNumber">
          页码
        </label>
        <NumberInput
          id="pageNumber"
          class="number-input page-input"
          inputmode="numeric"
          disabled={!ready()}
          value={ready() ? String(state()!.page) : '—'}
          valid={(number) =>
            Number.isInteger(number) && number >= 1 && number <= (state()?.pages ?? 1)
          }
          commit={(number) => props.reader().goToPage(number)}
          error={`请输入 1 到 ${state()?.pages ?? 1} 之间的整数页码。`}
          status={props.status}
          focusReader={props.focusReader}
        />
        <span
          id="pageTotal"
          class="page-total"
          aria-label={ready() ? `共 ${state()!.pages} 页` : '总页数'}
        >
          {ready() ? `/ ${state()!.pages}` : '/ —'}
        </span>
        <button
          id="nextPage"
          class="icon-button"
          type="button"
          aria-label="下一页"
          title="下一页"
          data-icon="next"
          data-reader
          disabled={!ready() || state()!.page >= state()!.pages}
          onClick={() => props.reader().goToPage(state()!.page + 1)}
        >
          <Icon name="next" />
        </button>
      </div>
      <span class="divider" aria-hidden="true" />
      <div class="control-group zoom-controls">
        <button
          id="zoomOut"
          class="icon-button"
          type="button"
          aria-label="缩小"
          title="缩小"
          data-icon="minus"
          data-reader
          disabled={!ready()}
          onClick={() => props.reader().zoomBy(1 / 1.1)}
        >
          <Icon name="minus" />
        </button>
        <label class="sr-only" for="zoomPercent">
          缩放百分比
        </label>
        <NumberInput
          id="zoomPercent"
          class="number-input zoom-input"
          inputmode="decimal"
          disabled={!ready()}
          inputRef={(node) => {
            zoom = node;
          }}
          value={`${Math.round((state()?.scale ?? 1) * 100)}%`}
          valid={(number) => number >= 10 && number <= 2500}
          commit={(number) => props.reader().setScale(number / 100)}
          error="缩放比例请输入 10% 到 2500% 之间的数值。"
          status={props.status}
          focusReader={props.focusReader}
        />
        <button
          id="zoomIn"
          class="icon-button"
          type="button"
          aria-label="放大"
          title="放大"
          data-icon="plus"
          data-reader
          disabled={!ready()}
          onClick={() => props.reader().zoomBy(1.1)}
        >
          <Icon name="plus" />
        </button>
        <label class="sr-only" for="zoomMode">
          缩放方式
        </label>
        <select
          id="zoomMode"
          class="zoom-select"
          data-reader
          disabled={!ready()}
          value={selectedZoom()}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'height') props.reader().fitHeight();
            else if (value === 'actual') props.reader().setScale(1);
            else if (value.startsWith('pages-'))
              props.reader().fitPageCount(Number(value.slice(6)));
            else {
              zoom.focus();
              zoom.select();
            }
            event.currentTarget.value = selectedZoom();
          }}
        >
          <option value="custom">自定义缩放</option>
          <option value="height">适应高度</option>
          <For each={[1, 2, 3, 4]}>
            {(count) => {
              const choice = () => state()?.zoomChoices.find((item) => item.pages === count);
              return (
                <option value={`pages-${count}`} disabled={!choice()}>
                  {choice()
                    ? `${Math.round(choice()!.scale * 100)}% · 容纳 ${count} 页`
                    : `容纳 ${count} 页`}
                </option>
              );
            }}
          </For>
          <option value="actual">100% · 实际大小</option>
        </select>
      </div>
      <span class="divider" aria-hidden="true" />
      <div class="control-group layout-controls">
        <label class="sr-only" for="layoutMode">
          页面布局
        </label>
        <select
          id="layoutMode"
          data-reader
          disabled={!ready()}
          value={state()?.layout ?? 'horizontal'}
          onChange={(event) => props.reader().setLayout(event.currentTarget.value as LayoutMode)}
        >
          <option value="horizontal">横向连续</option>
          <option value="vertical">纵向滚动</option>
        </select>
        <label id="columnsControl" class="inline-label" hidden={state()?.layout !== 'vertical'}>
          每行{' '}
          <NumberInput
            id="columns"
            class="number-input columns-input"
            type="number"
            min={1}
            max={32}
            label="每行页数"
            disabled={!ready()}
            value={String(state()?.columns ?? 1)}
            valid={(number) => Number.isInteger(number) && number >= 1 && number <= 32}
            commit={(number) => props.reader().setColumns(number)}
            error="每行页数请输入 1 到 32 之间的整数。"
            status={props.status}
            focusReader={props.focusReader}
          />{' '}
          页
        </label>
        <label class="sr-only" for="scrollInput">
          横向滚动方式
        </label>
        <select
          id="scrollInput"
          title="横向滚动方式：自动判断鼠标或触控板，也可手动选择"
          data-reader
          disabled={!ready()}
          hidden={!!state() && state()!.layout !== 'horizontal'}
          value={state()?.scrollInput ?? 'auto'}
          onChange={(event) =>
            props.reader().setScrollInput(event.currentTarget.value as ScrollInput)
          }
        >
          <option value="auto">滚动：自动</option>
          <option value="page">滚动：按页</option>
          <option value="smooth">滚动：连续</option>
        </select>
      </div>
    </div>
  );
}
