export type LayoutMode = 'horizontal' | 'vertical';
export type ScrollInput = 'auto' | 'page' | 'smooth';
export type ZoomMode = 'custom' | 'height' | 'pages';

export interface ReadingPosition {
  page: number;
  scale: number;
  layout: LayoutMode;
  columns: number;
  zoomMode: ZoomMode;
  fitPages: number;
  scrollInput: ScrollInput;
  // PDF coordinates anchor the same content across zoom and layout changes.
  left?: number;
  top?: number;
}

export interface OpenedFile {
  id: string;
  name: string;
  data: Uint8Array;
  position?: ReadingPosition;
}

export interface RecentFile {
  id: string;
  name: string;
  lastOpened: number;
  page: number;
}

export type AppCommand = 'open' | 'close-document' | 'find' | 'zoom-in' | 'zoom-out' | 'actual-size';
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close';
export interface WindowState { maximized: boolean; fullscreen: boolean }
export interface StartupState { firstRun: boolean; file: OpenedFile | null; error?: string }

export interface DesktopBridge {
  platform: string;
  getStartup(): Promise<StartupState>;
  getWindowState(): Promise<WindowState>;
  windowAction(action: WindowAction): Promise<void>;
  onWindowState(callback: (state: WindowState) => void): () => void;
  openFile(): Promise<OpenedFile | null>;
  openRecent(id: string): Promise<OpenedFile>;
  openDropped(file: File): Promise<OpenedFile>;
  getRecent(): Promise<RecentFile[]>;
  savePosition(id: string, position: ReadingPosition): Promise<void>;
  openExternal(url: string): Promise<void>;
  onOpenFile(callback: (file: OpenedFile) => void): () => void;
  onCommand(callback: (command: AppCommand) => void): () => void;
}

declare global {
  interface Window { panopdf?: DesktopBridge }
}

export interface OutlineEntry {
  title: string;
  children: OutlineEntry[];
  // The target stays opaque to the UI and is resolved by the reader.
  target: unknown;
}

export interface ReaderState {
  loaded: boolean;
  page: number;
  pages: number;
  scale: number;
  layout: LayoutMode;
  columns: number;
  zoomMode: ZoomMode;
  fitPages: number;
  scrollInput: ScrollInput;
  zoomChoices: { pages: number; scale: number }[];
}

export interface FindState {
  current: number;
  total: number;
  pending: boolean;
  notFound: boolean;
}

export interface ReaderCallbacks {
  onState(state: ReaderState): void;
  onPosition(position: ReadingPosition): void;
  onOutline(outline: OutlineEntry[]): void;
  onFind(state: FindState): void;
  onError(message: string): void;
  onPassword(incorrect: boolean): Promise<string | null>;
  onExternalLink(url: string): void;
}

export interface ReaderController {
  open(data: Uint8Array, position?: ReadingPosition): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;
  setLayout(mode: LayoutMode): void;
  setColumns(columns: number): void;
  setScale(scale: number): void;
  fitHeight(): void;
  fitPageCount(count: number): void;
  setScrollInput(input: ScrollInput): void;
  goToPage(page: number): void;
  zoomBy(factor: number): void;
  find(query: string, options?: { previous?: boolean; again?: boolean }): void;
  closeFind(): void;
  goToOutline(target: unknown): Promise<void>;
  refreshLayout(): void;
  getPosition(): ReadingPosition | null;
}
