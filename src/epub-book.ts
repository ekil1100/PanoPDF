import DOMPurify from 'dompurify';
import { Effect } from 'effect';
import type { OutlineEntry } from './contracts';
import {
  EPUB_LIMITS,
  epubAttempt,
  publicationTarget,
  requireEpub,
  withEpubArchive,
} from './epub-archive';
import type { EpubArchive } from './epub-archive';

export interface EpubChapter {
  path: string;
  title: string;
  content: DocumentFragment;
  text: string;
}
export interface EpubBook {
  chapters: EpubChapter[];
  outline: OutlineEntry[];
  images: Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>;
}
interface ManifestItem {
  id: string;
  path: string;
  type: string;
  properties: string[];
}
const elements = (root: Document | Element, name: string) => [
  ...root.getElementsByTagNameNS('*', name),
];
const tokens = (value: string | null) => (value ?? '').split(/\s+/).filter(Boolean);
const tags = [
  'p',
  'div',
  'span',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'br',
  'hr',
  'ol',
  'ul',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'figure',
  'figcaption',
  'a',
  'img',
  'ruby',
  'rt',
  'rp',
];
const rasterTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function parseEpubXml(source: string): Document {
  requireEpub(
    !/<!ENTITY/i.test(source) && !/<!DOCTYPE[^>]*\[/i.test(source),
    'EPUB 包含不支持的 XML 实体声明。',
  );
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  requireEpub(!elements(xml, 'parsererror').length, 'EPUB XML 内容无效或已损坏。');
  return xml;
}

/** Common EPUB cover pages wrap a local bitmap in SVG. Extract only its image
 * references into ordinary HTML; SVG scripts, links and styling never reach the DOM. */
function unwrapRasterCovers(body: Element, path: string) {
  const namespace = 'http://www.w3.org/2000/svg';
  // Snapshot the live collection before replacing its SVG elements.
  const covers = elements(body, 'svg').filter((element) => element.namespaceURI === namespace);
  for (const svg of covers) {
    const replacement = body.ownerDocument.createDocumentFragment();
    for (const image of svg.getElementsByTagNameNS(namespace, 'image')) {
      const href =
        image.getAttribute('href') ??
        image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
        '';
      if (!publicationTarget(path, href)) continue;
      const img = body.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'img');
      img.setAttribute('src', href);
      img.setAttribute('alt', svg.getAttribute('aria-label') ?? '');
      replacement.append(img);
    }
    svg.replaceWith(replacement);
  }
}

/** Detached, allowlisted content only. Publication IDs and URLs never become app IDs,
 * classes, CSS, executable attributes, or live resource/navigation URLs. */
export function sanitizeChapter(source: string, path: string): DocumentFragment {
  const xml = parseEpubXml(source);
  const body = elements(xml, 'body')[0];
  requireEpub(body, 'EPUB 章节缺少正文。');
  unwrapRasterCovers(body, path);
  const content = DOMPurify.sanitize(new XMLSerializer().serializeToString(body), {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [
      'id',
      'href',
      'src',
      'alt',
      'title',
      'lang',
      'dir',
      'colspan',
      'rowspan',
      'start',
      'value',
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
    FORBID_CONTENTS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'svg',
      'math',
      'audio',
      'video',
    ],
  });
  for (const node of content.querySelectorAll('*')) {
    const id = node.getAttribute('id');
    node.removeAttribute('id');
    if (id) node.setAttribute('data-epub-id', id);
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      node.removeAttribute('href');
      const external = Effect.runSync(
        epubAttempt(() => {
          const url = new URL(href);
          return ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            url.href.length <= 2048
            ? url.href
            : null;
        }).pipe(Effect.catch(() => Effect.succeed(null))),
      );
      const internal = publicationTarget(path, href);
      if (external || internal) {
        node.setAttribute('href', '#');
        node.setAttribute(
          external ? 'data-epub-external' : 'data-epub-target',
          external ?? JSON.stringify(internal),
        );
      }
    }
    if (node.tagName === 'IMG') {
      const target = publicationTarget(path, node.getAttribute('src') ?? '');
      node.removeAttribute('src');
      if (target) node.setAttribute('data-epub-image', target.path);
    }
  }
  return content;
}

function packageInfo(xml: Document, path: string) {
  const pkg = xml.documentElement;
  requireEpub(
    pkg.localName === 'package' && /^(2|3)\./.test(pkg.getAttribute('version') ?? ''),
    '仅支持 EPUB 2 和 EPUB 3。',
  );
  requireEpub(
    !elements(xml, 'meta').some(
      (meta) =>
        (meta.getAttribute('property') === 'rendition:layout' &&
          meta.textContent?.trim() === 'pre-paginated') ||
        (meta.getAttribute('name') === 'fixed-layout' && meta.getAttribute('content') === 'true'),
    ) &&
      !elements(xml, 'itemref').some((item) =>
        tokens(item.getAttribute('properties')).includes('rendition:layout-pre-paginated'),
      ),
    '暂不支持固定版式 EPUB，请使用可重排版 EPUB。',
  );
  const manifest = new Map<string, ManifestItem>();
  for (const item of elements(xml, 'manifest')[0]?.children ?? []) {
    const id = item.getAttribute('id') ?? '';
    const target = publicationTarget(path, item.getAttribute('href') ?? '');
    requireEpub(id && target && !manifest.has(id), 'EPUB 资源清单无效。');
    manifest.set(id, {
      id,
      path: target.path,
      type: item.getAttribute('media-type') ?? '',
      properties: tokens(item.getAttribute('properties')),
    });
  }
  const spine = elements(xml, 'spine')[0];
  requireEpub(spine, 'EPUB 缺少阅读顺序。');
  const chapters = [...spine.children]
    .filter((node) => node.localName === 'itemref')
    .map((item) => {
      const resource = manifest.get(item.getAttribute('idref') ?? '');
      requireEpub(
        resource && resource.type === 'application/xhtml+xml',
        'EPUB 章节必须为 XHTML；暂不支持此书的章节类型。',
      );
      return resource;
    });
  requireEpub(
    chapters.length > 0 &&
      chapters.length <= EPUB_LIMITS.chapters &&
      new Set(chapters.map((chapter) => chapter.path)).size === chapters.length,
    'EPUB 阅读顺序为空、重复或超过 1024 章限制。',
  );
  return {
    manifest,
    chapters,
    nav: [...manifest.values()].find((item) => item.properties.includes('nav')),
    ncx: manifest.get(spine.getAttribute('toc') ?? ''),
  };
}

function navigation(xml: Document, path: string, chapters: EpubChapter[]): OutlineEntry[] {
  const allowed = new Set(chapters.map((chapter) => chapter.path));
  const entry = (title: string, href: string, children: OutlineEntry[]): OutlineEntry[] => {
    const target = publicationTarget(path, href);
    return target && allowed.has(target.path)
      ? [{ title: title.trim() || '未命名章节', children, target }]
      : children;
  };
  const nav = elements(xml, 'nav').find((node) =>
    tokens(
      node.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? node.getAttribute('epub:type'),
    ).includes('toc'),
  );
  if (nav) {
    const list = (node: Element): OutlineEntry[] =>
      [...node.children].flatMap((li) => {
        if (li.localName !== 'li') return [];
        const label = [...li.children].find((child) => ['a', 'span'].includes(child.localName));
        const nested = [...li.children].find((child) => child.localName === 'ol');
        return entry(
          label?.textContent ?? '',
          label?.getAttribute('href') ?? '',
          nested ? list(nested) : [],
        );
      });
    const root = [...nav.children].find((child) => child.localName === 'ol');
    return root ? list(root) : [];
  }
  const ncx = (root: Element): OutlineEntry[] =>
    [...root.children].flatMap((node) =>
      node.localName === 'navPoint'
        ? entry(
            elements(node, 'navLabel')[0]?.textContent ?? '',
            [...node.children]
              .find((child) => child.localName === 'content')
              ?.getAttribute('src') ?? '',
            ncx(node),
          )
        : [],
    );
  const root = elements(xml, 'navMap')[0];
  return root ? ncx(root) : [];
}

export function loadEpub(data: Uint8Array) {
  return withEpubArchive(data, (archive: EpubArchive) => {
    const cache = new Map<string, Uint8Array<ArrayBuffer>>();
    const read = (path: string) =>
      cache.has(path)
        ? Effect.succeed(cache.get(path)!)
        : archive.read(path).pipe(
            Effect.tap((bytes) =>
              Effect.sync(() => {
                cache.set(path, bytes);
              }),
            ),
          );
    let textSize = 0;
    let nodes = 0;
    const text = (path: string) =>
      read(path).pipe(
        Effect.flatMap((bytes) =>
          epubAttempt(() => {
            textSize += bytes.length;
            requireEpub(textSize <= EPUB_LIMITS.text, 'EPUB 文本超过 32 MiB 限制。');
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          }),
        ),
      );
    const xml = (path: string) =>
      text(path).pipe(Effect.flatMap((source) => epubAttempt(() => parseEpubXml(source))));
    return read('mimetype').pipe(
      Effect.flatMap((bytes) =>
        epubAttempt(() =>
          requireEpub(
            new TextDecoder().decode(bytes) === 'application/epub+zip',
            '此 ZIP 文件不是有效的 EPUB。',
          ),
        ),
      ),
      Effect.andThen(xml('META-INF/container.xml')),
      Effect.flatMap((container) =>
        epubAttempt(() => {
          const path = elements(container, 'rootfile')
            .find((node) => node.getAttribute('media-type') === 'application/oebps-package+xml')
            ?.getAttribute('full-path');
          requireEpub(path && archive.paths.has(path), 'EPUB 缺少有效的 OPF 包文件。');
          return path;
        }),
      ),
      Effect.flatMap((path) =>
        xml(path).pipe(Effect.flatMap((doc) => epubAttempt(() => packageInfo(doc, path)))),
      ),
      Effect.flatMap((info) =>
        Effect.all(
          info.chapters.map((item) =>
            text(item.path).pipe(
              Effect.flatMap((source) =>
                epubAttempt(() => {
                  const content = sanitizeChapter(source, item.path);
                  nodes += content.querySelectorAll('*').length;
                  requireEpub(nodes <= EPUB_LIMITS.nodes, 'EPUB 正文结构超过安全限制。');
                  return {
                    path: item.path,
                    title:
                      content.querySelector('h1,h2,h3')?.textContent?.trim() ||
                      `章节 ${info.chapters.indexOf(item) + 1}`,
                    text: content.textContent ?? '',
                    content,
                  };
                }),
              ),
            ),
          ),
          { concurrency: 1 },
        ).pipe(Effect.map((chapters) => ({ info, chapters }))),
      ),
      Effect.flatMap(({ info, chapters }) => {
        const needed = new Set(
          chapters.flatMap((chapter) =>
            [...chapter.content.querySelectorAll('[data-epub-image]')].map((img) =>
              img.getAttribute('data-epub-image')!,
            ),
          ),
        );
        const images = Effect.all(
          [...info.manifest.values()]
            .filter((item) => rasterTypes.has(item.type) && needed.has(item.path))
            .map((item) =>
              read(item.path).pipe(
                Effect.map((bytes) => [item.path, { bytes, type: item.type }] as const),
              ),
            ),
          { concurrency: 1 },
        ).pipe(Effect.map((items) => new Map(items)));
        const nav = info.nav ?? info.ncx;
        const outline = nav
          ? xml(nav.path).pipe(
              Effect.flatMap((doc) => epubAttempt(() => navigation(doc, nav.path, chapters))),
            )
          : Effect.succeed([] as OutlineEntry[]);
        return Effect.all({ images, outline }).pipe(
          Effect.map(({ images, outline }): EpubBook => ({
            chapters,
            images,
            outline: outline.length
              ? outline
              : chapters.map((chapter) => ({
                  title: chapter.title,
                  children: [],
                  target: { path: chapter.path, fragment: '' },
                })),
          })),
        );
      }),
    );
  });
}
