import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';

const fixtureDate = new Date('2026-01-01T00:00:00Z');
function fixMetadata(pdf: PDFDocument) {
  pdf.setCreationDate(fixtureDate);
  pdf.setModificationDate(fixtureDate);
}

// Synthetic fixtures are generated locally; no user documents enter the test suite.
export async function readerFixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  fixMetadata(pdf);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 12; index++) {
    const page = pdf.addPage(index === 9 ? [842, 595] : [595, 842]);
    const { height } = page.getSize();
    page.drawText(`PanoPDF test document / ${index + 1}`, {
      x: 48,
      y: height - 64,
      size: 24,
      font,
    });
    page.drawText('A panorama of pages, read at your own scale.', {
      x: 48,
      y: height - 104,
      size: 14,
      font,
    });
    for (let line = 0; line < 18; line++) {
      page.drawText(`Reading line ${line + 1}: selection, navigation, and local rendering.`, {
        x: 48,
        y: height - 156 - line * 25,
        size: 12,
        font,
        color: rgb(0.2, 0.24, 0.28),
      });
    }
  }
  const outlineRef = pdf.context.nextRef();
  const chapter = pdf.context.obj({
    Title: PDFString.of('Chapter four'),
    Parent: outlineRef,
    Dest: [pdf.getPage(3).ref, PDFName.of('Fit')],
  });
  const chapterRef = pdf.context.register(chapter);
  pdf.context.assign(
    outlineRef,
    pdf.context.obj({
      Type: 'Outlines',
      First: chapterRef,
      Last: chapterRef,
      Count: 1,
    }),
  );
  pdf.catalog.set(PDFName.of('Outlines'), outlineRef);
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [540, 760, 560, 780],
      Contents: PDFString.of('Existing annotation in the source PDF.'),
      Name: 'Comment',
    }),
  );
  pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
  return pdf.save();
}

// A synthetic scan: raster-only pages with deterministic paper noise and ink bars.
// This exercises image decoding without copying any personal document or claiming OCR coverage.
export async function scannedFixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  fixMetadata(pdf);
  const width = 768;
  const height = 1024;
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = x > 64 && x < 680 && y > 96 && y < 940 && y % 36 < 8 && x % 83 < 70;
      const gray = ink ? 40 + ((x + y) % 24) : 240 + ((x * 17 + y * 13) % 16);
      pixels.fill(gray, (y * width + x) * 3, (y * width + x + 1) * 3);
    }
  }
  const stream = pdf.context.flateStream(pixels, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  });
  const image = pdf.context.register(stream);
  for (const size of [
    [595, 842],
    [842, 595],
    [420, 595],
  ] as [number, number][]) {
    const page = pdf.addPage(size);
    const key = page.node.newXObject('Scan', image);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(size[0], 0, 0, size[1], 0, 0),
      drawObject(key),
      popGraphicsState(),
    );
  }
  return pdf.save();
}

// A one-page synthetic PDF encrypted once with macOS PDFKit. Embedded for portable tests.
// Regeneration source: .agents/verification/electron/encrypt-fixture.swift.
export const fixturePassword = 'pano-test-password';
export function encryptedFixture(): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      'JVBERi0xLjcKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwgL0NvdW50IDEgL0tpZHMgWyAyIDAgUiBdIC9UeXBlIC9QYWdlcyA+Pgpl' +
        'bmRvYmoKMyAwIG9iago8PCAvUGFnZXMgMSAwIFIgL1R5cGUgL0NhdGFsb2cgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0NyZWF0aW9u' +
        'RGF0ZSAo7EFTJGHFjFwwMDZcMDAypjr5rEFO9GwpIC9DcmVhdG9yIDw1Njg0NjE2NDUzOTdiYzUxMzJiYTBhYTU5YzE4N2VhNjM2' +
        'MzRmYWNjYzM3ZGNlZWM4OTRlYTY5NTkyMWFkYTYwZDcxMDRjMzM0ZDQ0Zjc3MWZjMWU0OGRhMmQ4MWM1NWFiYTY2N2M3N2YxNzJm' +
        'YTYwNDBjNjI5YjM0MThmN2ZkOTlkNDk0Y2VhZmM0ODE4MWJhNjY5ZjNjZWYxODdkZGZiZWNlYjBjNDFlNDc4YjA5YTIwMGU+Ci9N' +
        'b2REYXRlICjsQVMkYcWMXDAwNlwwMDKmOvmsQU70bCkgL1Byb2R1Y2VyIDw1Njg0NjE2NDUzOTdiYzUxMzJiYTBhYTU5YzE4N2Vh' +
        'NjM2MzRmYWNjYzM3ZGNlZWM4OTRlYTY5NTkyMWFkYTYwZDcxMDRjMzM0ZDQ0Zjc3MWZjMWU0OGRhMmQ4MWM1NWFiYTY2N2M3N2Yx' +
        'NzJmYTYwNDBjNjI5YjM0MThmN2ZkOTlkNDk0Y2VhZmM0ODE4MWJhNjY5ZjNjZWYxODdkZGZiZWNlYjBjNDFlNDc4YjA5YTIwMGU+' +
        'Cj4+CmVuZG9iagoyIDAgb2JqCjw8IC9Db250ZW50cyBbIDUgMCBSIF0gL01lZGlhQm94IFsgMCAwIDU5NS4yOCA4NDEuODkgXSAv' +
        'UmVzb3VyY2VzIDw8IC9FeHRHU3RhdGUKPDwgPj4gL1hPYmplY3QgPDwgPj4gL0ZvbnQgPDwgL0hlbHZldGljYS03MDk4NDgwNzg5' +
        'IDYgMCBSID4+ID4+IC9Bbm5vdHMgWwpdIC9QYXJlbnQgMSAwIFIgL1R5cGUgL1BhZ2UgPj4KZW5kb2JqCjYgMCBvYmoKPDwgL0Vu' +
        'Y29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL0Jhc2VGb250IC9IZWx2ZXRpY2EgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+' +
        'CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTI2IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IApzdHJlYW0Kykt3NybYztqYYd2W' +
        'Ix3Jo6Ux6vehTFGQBzSdh39ib9dSj+4/2pLwcME07u4jzEUckFL4YZOsvccBc8X95p9n8PRZK1DnQ8FkbcBkmC0NMLOhwd04BIAF' +
        '8N/5F9H+cjjqIPLR03ppy5XJRu40nMezgAswh2+FSmjp8PsxjcJoCmVuZHN0cmVhbQplbmRvYmoKNyAwIG9iago8PCAvRmlyc3Qg' +
        'MjYgL0xlbmd0aCAzNjUgL1R5cGUgL09ialN0bSAvTiA1IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IApzdHJlYW0Ko1a/q1iTJmi+' +
        '6R4wtR33bNPz6AIv7T70wBUp6N0K6s0vjZ6Rd50w3/1ZdHOIJXbSgsljbFappQ3Ycthv+EBDZ16lKXOZ/HvM2GPIiJbCHijd/Tuw' +
        'Ym6E8uQc7Uz0Px5oCphjjjXMcqP/KQZzsBaxawdcrs7+ED9rObIJEHqjCLccgLHoR6xj3V7BYB0Elf1LfQ1NeqWqu+xqWgBPlsUB' +
        'MDDMBk5vi9Ez/X12xZT/bKzJOP6haegMays9+htgmMxuC74odTHiG8H/vM+tyr3CHvlaQO4EZXA2YGXlKwFvUTmfJCHzjMsn4I5z' +
        '6dAebmvPqyxIa5zqlXZZDEQO44mk5bPUTSjfX/y2Pq9hreTUVUhL+xoSlGkQoQbJ81zUMgTZe+qz+ZYfOKxoMROguTrPiKqp3BfA' +
        'P3dJ+haUO9Ed5cJx3tZrGK54ArqhTOJ51V0L03UgBWV0QG/CAFdBWr0Vc0QhypQXPAHmsjKf/RkKZW5kc3RyZWFtCmVuZG9iago4' +
        'IDAgb2JqCjw8IC9JbmRleCBbIDAgOSBdIC9XIFsgMSAyIDIgXSAvTGVuZ3RoIDQyIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlIC9JbmZv' +
        'IDQgMCBSCi9TaXplIDkgL1R5cGUgL1hSZWYgL1Jvb3QgMyAwIFIgPj4gCnN0cmVhbQoR4N/W4ZPx/JhlfeC+sp+RFX401YKLlCn0' +
        'q3LFlW9nDJ1Uh31XDoW28wEKZW5kc3RyZWFtCmVuZG9iago5IDAgb2JqCjw8IC9QIC00IC9VIDw0MjNiOTFiOTU4ZWZiMGRkMTAy' +
        'YTc5NzZiYjY1OWI4NjAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwPgovViAyIC9PIDxhY2IzMmQzZmY4ZjNkYjNhNzc5' +
        'OWQwOTg2YTJlN2MzYWM1OGIxZjhmZDhjNTdkMDM1ZjMyZTJlYzc3MjRhOWJiPgovTGVuZ3RoIDEyOCAvUiAzIC9GaWx0ZXIgL1N0' +
        'YW5kYXJkID4+CmVuZG9iagp4cmVmCjAgMTAKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDIyIDAwMDAwIG4gCjAwMDAwMDA2' +
        'MTEgMDAwMDAgbiAKMDAwMDAwMDA4MSAwMDAwMCBuIAowMDAwMDAwMTMwIDAwMDAwIG4gCjAwMDAwMDA5MDggMDAwMDAgbiAKMDAw' +
        'MDAwMDgxMSAwMDAwMCBuIAowMDAwMDAxMTA3IDAwMDAwIG4gCjAwMDAwMDE1NzQgMDAwMDAgbiAKMDAwMDAwMTc2MCAwMDAwMCBu' +
        'IAoKdHJhaWxlcgo8PCAvRW5jcnlwdCA5IDAgUiAvSW5mbyA0IDAgUiAvSUQgWyA8NWIyYjg0MjM2NzNhOWJlMzYxNmQ5NWQ0NTI0' +
        'ZWFkZTY+IDw1YjJiODQyMzY3M2E5YmUzNjE2ZDk1ZDQ1MjRlYWRlNj4KXSAvUm9vdCAzIDAgUiAvU2l6ZSAxMCA+PiAKc3RhcnR4' +
        'cmVmCjE5NjcKJSVFT0YK',
      'base64',
    ),
  );
}
