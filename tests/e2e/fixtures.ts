import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

// Synthetic fixtures are generated locally; no user documents enter the test suite.
export async function readerFixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 12; index++) {
    const page = pdf.addPage(index === 9 ? [842, 595] : [595, 842]);
    const { height } = page.getSize();
    page.drawText(`PanoPDF test document / ${index + 1}`, { x: 48, y: height - 64, size: 24, font });
    page.drawText('A panorama of pages, read at your own scale.', { x: 48, y: height - 104, size: 14, font });
    for (let line = 0; line < 18; line++) {
      page.drawText(`Reading line ${line + 1}: selection, navigation, and local rendering.`, {
        x: 48, y: height - 156 - line * 25, size: 12, font, color: rgb(0.2, 0.24, 0.28),
      });
    }
  }
  const outlineRef = pdf.context.nextRef();
  const chapter = pdf.context.obj({
    Title: PDFString.of('Chapter four'), Parent: outlineRef,
    Dest: [pdf.getPage(3).ref, PDFName.of('Fit')],
  });
  const chapterRef = pdf.context.register(chapter);
  pdf.context.assign(outlineRef, pdf.context.obj({
    Type: 'Outlines', First: chapterRef, Last: chapterRef, Count: 1,
  }));
  pdf.catalog.set(PDFName.of('Outlines'), outlineRef);
  const annotation = pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [540, 760, 560, 780],
    Contents: PDFString.of('Existing annotation in the source PDF.'), Name: 'Comment',
  }));
  pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
  return pdf.save();
}
