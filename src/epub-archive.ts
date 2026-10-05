import { Data, Effect } from 'effect';
import { Uint8ArrayReader, ZipReader, type FileEntry } from '@zip.js/zip.js';

export class EpubError extends Data.TaggedError('EpubError')<{
  message: string;
  cause?: unknown;
}> {}

export const EPUB_LIMITS = {
  archive: 256 * 1024 * 1024,
  expanded: 128 * 1024 * 1024,
  entry: 16 * 1024 * 1024,
  entries: 10000,
  text: 32 * 1024 * 1024,
  chapters: 1024,
  nodes: 200000,
} as const;

export const epubAttempt = <A>(run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof EpubError
        ? cause
        : new EpubError({ message: 'EPUB 内容无效或已损坏。', cause }),
  });

export function requireEpub(condition: unknown, message: string): asserts condition {
  if (!condition) throw new EpubError({ message });
}

export function archivePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4096 &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    !/[\\:#?]/.test(value) &&
    !value.startsWith('/') &&
    value.split('/').every((part) => part !== '.' && part !== '..' && part !== '')
  );
}

/** Resolve publication references without granting access to network or application URLs. */
export function publicationTarget(
  base: string,
  href: string,
): { path: string; fragment: string } | null {
  const result = Effect.runSync(
    epubAttempt(() => {
      if (!href || href.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.includes('?'))
        return null;
      const [path, ...fragment] = href.split('#');
      const decoded = decodeURIComponent(path!);
      if (decoded.includes('\\') || decoded.startsWith('/')) return null;
      const parts = path ? base.split('/').slice(0, -1) : base.split('/');
      if (path) {
        for (const part of decoded.split('/')) {
          if (part === '..') {
            if (!parts.length) return null;
            parts.pop();
          } else if (part !== '.') parts.push(part);
        }
      }
      const resolved = parts.join('/');
      return archivePath(resolved)
        ? { path: resolved, fragment: decodeURIComponent(fragment.join('#')) }
        : null;
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
  return result;
}

export interface EpubArchive {
  paths: ReadonlySet<string>;
  read(path: string): Effect.Effect<Uint8Array<ArrayBuffer>, EpubError>;
}

/** Central-directory limits run before any entry is expanded. The stream sink also
 * enforces actual output size, including archives with dishonest size metadata. */
export const withEpubArchive = <A>(
  data: Uint8Array,
  use: (archive: EpubArchive) => Effect.Effect<A, EpubError>,
): Effect.Effect<A, EpubError> =>
  epubAttempt(() => {
    requireEpub(data.length <= EPUB_LIMITS.archive, 'EPUB 文件超过 256 MiB 大小限制。');
    return new ZipReader(new Uint8ArrayReader(data), {
      useWebWorkers: false,
      useCompressionStream: true,
      strictness: 'strict',
      checkCrc32: true,
      checkOverlappingEntry: true,
    });
  }).pipe(
    Effect.flatMap((reader) =>
      Effect.acquireUseRelease(
        Effect.succeed(reader),
        () =>
          Effect.tryPromise({
            try: () =>
              reader.getEntries({
                onprogress: (index) => {
                  requireEpub(index <= EPUB_LIMITS.entries, 'EPUB 包含过多文件。');
                },
              }),
            catch: (cause) =>
              cause instanceof EpubError
                ? cause
                : new EpubError({ message: 'EPUB ZIP 容器无效或已损坏。', cause }),
          }).pipe(
            Effect.flatMap((entries) =>
              epubAttempt(() => {
                requireEpub(entries.length <= EPUB_LIMITS.entries, 'EPUB 包含过多文件。');
                const files = new Map<string, FileEntry>();
                let total = 0;
                for (const entry of entries) {
                  requireEpub(!entry.encrypted, '暂不支持加密或 DRM 保护的 EPUB。');
                  if (entry.directory) continue;
                  requireEpub(
                    archivePath(entry.filename) && !files.has(entry.filename),
                    'EPUB 包含无效或重复的文件路径。',
                  );
                  requireEpub(
                    Number.isSafeInteger(entry.uncompressedSize) &&
                      entry.uncompressedSize >= 0 &&
                      entry.uncompressedSize <= EPUB_LIMITS.entry,
                    'EPUB 单个资源超过 16 MiB 解压限制。',
                  );
                  total += entry.uncompressedSize;
                  requireEpub(total <= EPUB_LIMITS.expanded, 'EPUB 超过 128 MiB 解压限制。');
                  files.set(entry.filename, entry);
                }
                // Encryption includes DRM and obfuscated fonts; neither is silently misrendered.
                requireEpub(
                  !files.has('META-INF/encryption.xml'),
                  '暂不支持加密、DRM 或字体混淆的 EPUB。',
                );
                let expanded = 0;
                const archive: EpubArchive = {
                  paths: new Set(files.keys()),
                  read: (path) =>
                    Effect.suspend(() => {
                      const entry = files.get(path);
                      if (!entry)
                        return Effect.fail(new EpubError({ message: `EPUB 缺少资源：${path}` }));
                      const chunks: Uint8Array[] = [];
                      let size = 0;
                      const sink = new WritableStream<Uint8Array>({
                        write(chunk) {
                          size += chunk.length;
                          expanded += chunk.length;
                          requireEpub(
                            size <= entry.uncompressedSize &&
                              size <= EPUB_LIMITS.entry &&
                              expanded <= EPUB_LIMITS.expanded,
                            'EPUB 解压数据超过安全限制。',
                          );
                          chunks.push(chunk.slice());
                        },
                      });
                      return Effect.tryPromise({
                        try: (signal) => entry.getData(sink, { signal }),
                        catch: (cause) =>
                          cause instanceof EpubError
                            ? cause
                            : new EpubError({
                                message: 'EPUB 资源解压失败，文件可能已损坏或加密。',
                                cause,
                              }),
                      }).pipe(
                        Effect.flatMap(() =>
                          epubAttempt(() => {
                            requireEpub(
                              size === entry.uncompressedSize,
                              'EPUB 资源大小与目录不一致。',
                            );
                            const bytes = new Uint8Array(size);
                            let offset = 0;
                            chunks.forEach((chunk) => {
                              bytes.set(chunk, offset);
                              offset += chunk.length;
                            });
                            return bytes;
                          }),
                        ),
                      );
                    }),
                };
                return archive;
              }),
            ),
            Effect.flatMap(use),
          ),
        () => Effect.promise(() => reader.close()).pipe(Effect.catchCause(() => Effect.void)),
      ),
    ),
  );
