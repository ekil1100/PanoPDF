import { createMemo } from 'solid-js';
import type { AppState } from '../app-controller';
import type { LayoutMode, ReaderController, ScrollInput } from '../contracts';
import { Icon } from './icon';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { ReaderSelect, type ReaderChoice } from './reader-select';
import { Separator } from './ui/separator';
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
  const zoomChoices = createMemo<ReaderChoice[]>(() => [
    { value: 'custom', label: '自定义缩放' },
    { value: 'height', label: '适应高度' },
    ...[1, 2, 3, 4].map((count) => {
      const choice = state()?.zoomChoices.find((item) => item.pages === count);
      return {
        value: `pages-${count}`,
        label: choice
          ? `${Math.round(choice.scale * 100)}% · 容纳 ${count} 页`
          : `容纳 ${count} 页`,
        disabled: !choice,
      };
    }),
    { value: 'actual', label: '100% · 实际大小' },
  ]);
  const layouts: ReaderChoice[] = [
    { value: 'horizontal', label: '横向连续' },
    { value: 'vertical', label: '纵向滚动' },
  ];
  const scrollModes: ReaderChoice[] = [
    { value: 'auto', label: '滚动：自动' },
    { value: 'page', label: '滚动：按页' },
    { value: 'smooth', label: '滚动：连续' },
  ];
  let zoom!: HTMLInputElement;
  let focusZoomOnClose = false;
  return (
    <div
      id="readerToolbar"
      class="reader-toolbar"
      aria-label="文档操作"
      hidden={props.state.phase !== 'ready' && props.state.phase !== 'opening'}
    >
      <div class="control-group">
        <Button
          variant="ghost"
          size="icon"
          id="outlineToggle"
          class="icon-button ui:aria-expanded:bg-accent ui:aria-expanded:text-accent-foreground"
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
        </Button>
        <Button
          variant="ghost"
          size="icon"
          id="searchToggle"
          class="icon-button ui:aria-expanded:bg-accent ui:aria-expanded:text-accent-foreground"
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
        </Button>
      </div>
      <Separator
        as="span"
        orientation="vertical"
        class="divider ui:data-[orientation=vertical]:h-5"
        aria-hidden="true"
      />
      <div class="control-group page-controls">
        <Button
          variant="ghost"
          size="icon"
          id="previousPage"
          class="icon-button ui:aria-expanded:bg-accent ui:aria-expanded:text-accent-foreground"
          type="button"
          aria-label="上一页"
          title="上一页"
          data-icon="previous"
          data-reader
          disabled={!ready() || (state()?.page ?? 1) <= 1}
          onClick={() => props.reader().goToPage(state()!.page - 1)}
        >
          <Icon name="previous" />
        </Button>
        <Label class="sr-only" for="pageNumber">
          页码
        </Label>
        <NumberInput
          id="pageNumber"
          class="number-input page-input ui:w-12 ui:px-1"
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
        <Button
          variant="ghost"
          size="icon"
          id="nextPage"
          class="icon-button ui:aria-expanded:bg-accent ui:aria-expanded:text-accent-foreground"
          type="button"
          aria-label="下一页"
          title="下一页"
          data-icon="next"
          data-reader
          disabled={!ready() || state()!.page >= state()!.pages}
          onClick={() => props.reader().goToPage(state()!.page + 1)}
        >
          <Icon name="next" />
        </Button>
      </div>
      <Separator
        as="span"
        orientation="vertical"
        class="divider ui:data-[orientation=vertical]:h-5"
        aria-hidden="true"
      />
      <div class="control-group zoom-controls">
        <Button
          variant="ghost"
          size="icon"
          id="zoomOut"
          class="icon-button ui:aria-expanded:bg-accent ui:aria-expanded:text-accent-foreground"
          type="button"
          aria-label="缩小"
          title="缩小"
          data-icon="minus"
          data-reader
          disabled={!ready()}
          onClick={() => props.reader().zoomBy(1 / 1.1)}
        >
          <Icon name="minus" />
        </Button>
        <Label class="sr-only" for="zoomPercent">
          缩放百分比
        </Label>
        <NumberInput
          id="zoomPercent"
          class="number-input zoom-input ui:w-16 ui:px-1"
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
        <Button
          variant="ghost"
          size="icon"
          id="zoomIn"
          class="icon-button ui:aria-expanded:bg-accent ui:aria-expanded:text-accent-foreground"
          type="button"
          aria-label="放大"
          title="放大"
          data-icon="plus"
          data-reader
          disabled={!ready()}
          onClick={() => props.reader().zoomBy(1.1)}
        >
          <Icon name="plus" />
        </Button>
        <ReaderSelect
          id="zoomMode"
          label="缩放方式"
          class="zoom-select ui:w-[156px]"
          disabled={!ready()}
          value={selectedZoom()}
          options={zoomChoices()}
          onChange={(value) => {
            if (value === 'height') props.reader().fitHeight();
            else if (value === 'actual') props.reader().setScale(1);
            else if (value.startsWith('pages-'))
              props.reader().fitPageCount(Number(value.slice(6)));
            else focusZoomOnClose = true;
          }}
          onCloseAutoFocus={(event) => {
            if (!focusZoomOnClose) return;
            event.preventDefault();
            focusZoomOnClose = false;
            zoom.focus();
            zoom.select();
          }}
        />
      </div>
      <Separator
        as="span"
        orientation="vertical"
        class="divider ui:data-[orientation=vertical]:h-5"
        aria-hidden="true"
      />
      <div class="control-group layout-controls">
        <ReaderSelect
          id="layoutMode"
          label="页面布局"
          class="ui:w-28"
          disabled={!ready()}
          value={state()?.layout ?? 'horizontal'}
          options={layouts}
          onChange={(value) => props.reader().setLayout(value as LayoutMode)}
        />
        <Label
          id="columnsControl"
          class="inline-label"
          for="columns"
          hidden={state()?.layout !== 'vertical'}
        >
          每行{' '}
          <NumberInput
            id="columns"
            class="number-input columns-input ui:w-12 ui:px-1"
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
        </Label>
        <ReaderSelect
          id="scrollInput"
          label="横向滚动方式"
          class="ui:w-32"
          title="横向滚动方式：自动判断鼠标或触控板，也可手动选择"
          disabled={!ready()}
          hidden={!!state() && state()!.layout !== 'horizontal'}
          value={state()?.scrollInput ?? 'auto'}
          options={scrollModes}
          onChange={(value) => props.reader().setScrollInput(value as ScrollInput)}
        />
      </div>
    </div>
  );
}
