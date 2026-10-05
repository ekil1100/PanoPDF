import { Effect } from 'effect';
import { Uint8ArrayWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';

export function zipFixture(
  files: Record<string, string | Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  return Effect.runPromise(
    Effect.all(
      Object.entries(files).map(([name, value]) =>
        Effect.promise(() =>
          writer.add(
            name,
            new Uint8ArrayReader(
              typeof value === 'string' ? new TextEncoder().encode(value) : value,
            ),
            { level: name === 'mimetype' ? 0 : 6 },
          ),
        ),
      ),
      { concurrency: 1 },
    ).pipe(Effect.andThen(Effect.promise(() => writer.close()))),
  );
}

export function epubFiles(
  options: { version?: 2 | 3; unsafe?: boolean; imageOnly?: boolean } = {},
): Record<string, string | Uint8Array> {
  const v2 = options.version === 2;
  const body = (value: string) =>
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>${value}</body></html>`;
  const hostile = options.unsafe
    ? `<script>window.epubExecuted = true</script><iframe src="https://evil.invalid/frame"/><object data="file:///etc/passwd"/><style>body { display:none } @import 'https://evil.invalid/style';</style><form action="https://evil.invalid"><input autofocus="autofocus" /></form><svg xmlns="http://www.w3.org/2000/svg"><script>window.epubExecuted = true</script><image href="https://evil.invalid/svg"/></svg><img src="https://evil.invalid/track" onerror="window.epubExecuted=true"/><img src="file:///etc/passwd"/><a href="javascript:alert(1)">Dangerous</a><a href="pano://app/index.html">App URL</a><div id="viewer" class="pdfViewer" style="position:fixed;inset:0" onclick="alert(1)">Safe text</div>`
    : '';
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="${v2 ? '2.0' : '3.0'}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:fixture:epub</dc:identifier><dc:title>EPUB fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="chapters/two.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="cover.png" media-type="image/png"/><item id="nav" href="${v2 ? 'toc.ncx' : 'nav.xhtml'}" media-type="${v2 ? 'application/x-dtbncx+xml' : 'application/xhtml+xml'}" ${v2 ? '' : 'properties="nav"'}/></manifest><spine ${v2 ? 'toc="nav"' : ''}><itemref idref="one"/><itemref idref="two"/></spine></package>`,
    'OPS/one.xhtml': body(
      `<h1>Opening chapter</h1><p>A panorama of books with <em>searchable</em> content.</p><a href="chapters/two.xhtml#destination">Continue reading</a><p><a href="https://example.com/book">External reference</a></p>${hostile}`,
    ),
    'OPS/chapters/two.xhtml': body(
      options.imageOnly
        ? '<img src="../cover.png" alt="Tall illustration"/>'
        : `<h1 id="destination">Second chapter</h1><img src="../cover.png" alt="Local illustration"/><p>Another panorama is here.</p>${Array.from({ length: 80 }, (_, i) => `<p>Reading paragraph ${i + 1}: chapter progress survives resizing and reopening.</p>`).join('')}<a href="../one.xhtml">Back to opening</a>`,
    ),
    'OPS/nav.xhtml': body(
      '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="one.xhtml">Opening chapter</a><ol><li><a href="chapters/two.xhtml#destination">Second chapter</a></li></ol></li></ol></nav>',
    ),
    'OPS/toc.ncx':
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="n1"><navLabel><text>Opening chapter</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="n2"><navLabel><text>Second chapter</text></navLabel><content src="chapters/two.xhtml#destination"/></navPoint></navMap></ncx>',
    'OPS/cover.png': new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
        'base64',
      ),
    ),
  };
}

export const epubFixture = (options?: Parameters<typeof epubFiles>[0]) =>
  zipFixture(epubFiles(options));
