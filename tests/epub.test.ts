// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { Effect } from 'effect';
import { loadEpub, parseEpubXml, sanitizeChapter } from '../src/epub-book';
import { EPUB_LIMITS, publicationTarget, withEpubArchive } from '../src/epub-archive';
import { epubFiles, epubFixture, zipFixture } from './epub-fixture';

const load = (bytes: Uint8Array) => Effect.runPromise(loadEpub(bytes));

describe('EPUB publication parsing', () => {
  it.each([2, 3] as const)(
    'reads EPUB %i spine, nested paths, contents and navigation',
    async (version) => {
      const book = await load(await epubFixture({ version }));
      expect(book.chapters.map((chapter) => chapter.path)).toEqual([
        'OPS/one.xhtml',
        'OPS/chapters/two.xhtml',
      ]);
      expect(book.chapters[0]!.text).toContain('searchable content');
      expect(book.images.get('OPS/cover.png')?.type).toBe('image/png');
      const outline = version === 3 ? book.outline[0]!.children[0] : book.outline[1];
      expect(outline).toMatchObject({
        title: 'Second chapter',
        target: { path: 'OPS/chapters/two.xhtml', fragment: 'destination' },
      });
    },
  );

  it.each(['href', 'xlink:href'])(
    'preserves a local raster cover wrapped in SVG using %s without retaining SVG markup',
    (attribute) => {
      const content = sanitizeChapter(
        `<html xmlns="http://www.w3.org/1999/xhtml"><body><div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1200 1600"><image width="1200" height="1600" ${attribute}="cover.png" /></svg></div></body></html>`,
        'OPS/one.xhtml',
      );
      expect(content.querySelector('img')?.getAttribute('data-epub-image')).toBe('OPS/cover.png');
      expect(content.querySelector('svg,image,[src]')).toBeNull();
    },
  );

  it('discards remote SVG images and active attributes while extracting local images', () => {
    const content = sanitizeChapter(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><image href="https://example.com/remote.png" /><image href="data:image/svg+xml,payload" /><image href="../../outside.png" /><image href="cover.png" onerror="alert(1)" style="position:fixed" /></svg></body></html>',
      'OPS/one.xhtml',
    );
    expect(content.querySelectorAll('img')).toHaveLength(1);
    expect(content.querySelector('img')?.getAttribute('data-epub-image')).toBe('OPS/cover.png');
    expect(content.querySelector('svg,script,[src],[style],[onload],[onerror]')).toBeNull();
    expect(content.textContent).not.toContain('alert');
  });

  it('falls back to spine chapters when the publication has no TOC', async () => {
    const files = epubFiles();
    files['OPS/book.opf'] = String(files['OPS/book.opf']).replace('properties="nav"', '');
    expect((await load(await zipFixture(files))).outline).toHaveLength(2);
  });

  it('sanitizes active markup, application IDs, styles, remote resources and URL schemes', async () => {
    const book = await load(await epubFixture({ unsafe: true }));
    const content = book.chapters[0]!.content;
    expect(
      content.querySelector(
        'script,style,iframe,object,form,input,svg,[id],[class],[style],[onclick],[onerror],[src]',
      ),
    ).toBeNull();
    expect(content.textContent).toContain('Safe text');
    expect(content.textContent).not.toContain('epubExecuted');
    expect(
      [...content.querySelectorAll('a[href]')].every((node) => node.getAttribute('href') === '#'),
    ).toBe(true);
    expect(content.querySelector('[data-epub-external]')?.getAttribute('data-epub-external')).toBe(
      'https://example.com/book',
    );
    expect(content.querySelector('img[data-epub-image]')).toBeNull();
  });

  it.each([
    'META-INF/encryption.xml',
    'missing-spine',
    'fixed-layout',
    'invalid-mime',
    'missing-chapter',
  ])('rejects unsupported or invalid books: %s', async (kind) => {
    const files = epubFiles();
    if (kind === 'META-INF/encryption.xml') files[kind] = '<encryption/>';
    if (kind === 'missing-spine')
      files['OPS/book.opf'] = String(files['OPS/book.opf']).replace(/<spine.*<\/spine>/, '');
    if (kind === 'fixed-layout')
      files['OPS/book.opf'] = String(files['OPS/book.opf']).replace(
        '</metadata>',
        '<meta property="rendition:layout">pre-paginated</meta></metadata>',
      );
    if (kind === 'invalid-mime') files.mimetype = 'application/zip';
    if (kind === 'missing-chapter') delete files['OPS/one.xhtml'];
    await expect(load(await zipFixture(files))).rejects.toThrow(/EPUB|ZIP/);
  });

  it('rejects custom XML entities and malformed chapter XML', () => {
    expect(() => parseEpubXml('<!DOCTYPE x [<!ENTITY x "payload">]><x>&x;</x>')).toThrow(/实体/);
    expect(() => sanitizeChapter('<html><body><p></body>', 'chapter.xhtml')).toThrow(/XML/);
  });

  it('resolves only publication-local references, including URL-encoded chapter names', () => {
    expect(publicationTarget('OPS/chapters/two.xhtml', '../one.xhtml#heading')).toEqual({
      path: 'OPS/one.xhtml',
      fragment: 'heading',
    });
    expect(publicationTarget('OPS/one.xhtml', 'chapter%20one.xhtml')).toEqual({
      path: 'OPS/chapter one.xhtml',
      fragment: '',
    });
    for (const href of [
      '../../../secret',
      '/etc/passwd',
      '//host/a',
      'file:///x',
      'https://x/a',
      'data:text/html,a',
      'pano://app/x',
      '..%2f..%2fsecret',
      'a%5cb',
      'a%00b',
      '%broken',
    ])
      expect(publicationTarget('OPS/one.xhtml', href)).toBeNull();
  });
});

describe('EPUB archive limits', () => {
  it('rejects oversized declared expansion before reading entry content', async () => {
    const bytes = await zipFixture({ mimetype: 'application/epub+zip', payload: 'small' });
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50)
        view.setUint32(offset + 24, EPUB_LIMITS.entry + 1, true);
    }
    let used = false;
    await expect(
      Effect.runPromise(
        withEpubArchive(bytes, () =>
          Effect.sync(() => {
            used = true;
          }),
        ),
      ),
    ).rejects.toThrow(/16 MiB/);
    expect(used).toBe(false);
  });

  it('checks the aggregate expansion budget before reading any content', async () => {
    const bytes = await zipFixture(
      Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`part-${index}`, 'small'])),
    );
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50)
        view.setUint32(offset + 24, EPUB_LIMITS.entry, true);
    }
    await expect(
      Effect.runPromise(withEpubArchive(bytes, () => Effect.succeed('unused'))),
    ).rejects.toThrow(/128 MiB/);
  });

  it('rejects output larger than its claimed size even when compressed data is valid', async () => {
    const bytes = await zipFixture({ payload: 'a'.repeat(65536) });
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 16, true);
    }
    await expect(
      Effect.runPromise(withEpubArchive(bytes, (archive) => archive.read('payload'))),
    ).rejects.toThrow(/安全限制|解压失败/);
  });

  it('rejects traversal paths and non-EPUB ZIP files', async () => {
    await expect(load(await zipFixture({ '../outside': 'payload' }))).rejects.toThrow(/路径|ZIP/);
    await expect(load(await zipFixture({ other: 'payload' }))).rejects.toThrow(/mimetype/);
  });
});
