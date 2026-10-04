/* @refresh skip */
// The app/main HMR owner must release the reader and finish saves before replacing its DOM.
import type { AppPhase } from '../app-controller';

export function ReaderHost(props: {
  phase: AppPhase;
  containerRef: (node: HTMLDivElement) => void;
  viewerRef: (node: HTMLDivElement) => void;
}) {
  // These nodes persist across all phases. PDF.js owns every viewer descendant,
  // layout dataset and layout style; Solid writes only host visibility.
  return (
    <div
      id="viewerContainer"
      ref={props.containerRef}
      tabindex="0"
      aria-label="PDF 页面"
      hidden={props.phase === 'empty' || props.phase === 'error'}
      style={{
        visibility: props.phase === 'opening' || props.phase === 'closing' ? 'hidden' : undefined,
      }}
    >
      <div id="viewer" class="pdfViewer" ref={props.viewerRef} />
    </div>
  );
}
