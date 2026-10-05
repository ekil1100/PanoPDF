'use strict';

const { Effect } = require('effect');
const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');

const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const MAX_RECENTS = 20;
const MAX_SETTINGS_BYTES = 1024 * 1024;
const APP_URL = 'pano://app/index.html';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class UserError extends Error {}
function fail(message = '请求参数无效。') {
  throw new UserError(message);
}
function record(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
function validateId(value) {
  if (!validId(value)) fail();
  return value;
}
function validatePath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    !path.isAbsolute(value) ||
    !['.pdf', '.epub'].includes(path.extname(value).toLowerCase())
  ) {
    fail('请选择本地 PDF/EPUB 文件。');
  }
  return value;
}
function validateWindowAction(value) {
  if (!['minimize', 'toggle-maximize', 'toggle-fullscreen', 'close'].includes(value)) fail();
  return value;
}
function validatePosition(value) {
  const keys = [
    'page',
    'scale',
    'layout',
    'columns',
    'zoomMode',
    'fitPages',
    'scrollInput',
    'left',
    'top',
    'epub',
  ];
  if (
    !record(value) ||
    Object.keys(value).length > keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail();
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (
    !integer(value.page, 1, 1_000_000) ||
    !Number.isFinite(value.scale) ||
    value.scale < 0.01 ||
    value.scale > 100 ||
    !['horizontal', 'vertical'].includes(value.layout) ||
    !integer(value.columns, 1, 32) ||
    !['custom', 'height', 'pages'].includes(value.zoomMode) ||
    !integer(value.fitPages, 1, 32) ||
    !['auto', 'page', 'smooth'].includes(value.scrollInput)
  )
    fail();
  for (const key of ['left', 'top']) {
    if (
      value[key] !== undefined &&
      (!Number.isFinite(value[key]) || Math.abs(value[key]) > 10_000_000)
    )
      fail();
  }
  const epub = value.epub === undefined ? undefined : validateEpubPosition(value.epub);
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, key === 'epub' ? epub : value[key]]),
  );
}
function validateEpubPosition(value) {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['chapter', 'progress', 'offset'].includes(key)) ||
    !Object.hasOwn(value, 'chapter') ||
    !Object.hasOwn(value, 'progress') ||
    typeof value.chapter !== 'string' ||
    !value.chapter.length ||
    value.chapter.length > 4096 ||
    /[\\\x00-\x1f\x7f]/.test(value.chapter) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value.chapter) ||
    value.chapter.split('/').some((part) => !part || part === '.' || part === '..') ||
    !Number.isFinite(value.progress) ||
    value.progress < 0 ||
    value.progress > 1 ||
    (Object.hasOwn(value, 'offset') &&
      (!Number.isInteger(value.offset) || value.offset < 0 || value.offset > 33_554_432))
  )
    fail();
  return {
    chapter: value.chapter,
    progress: value.progress,
    ...(Object.hasOwn(value, 'offset') ? { offset: value.offset } : {}),
  };
}
function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value))
    fail('此链接不允许打开。');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('此链接不允许打开。');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    fail('仅允许在系统浏览器中打开 HTTP 或 HTTPS 链接。');
  }
  return url.href;
}
function validateDevUrl(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid development URL');
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Development URL must be a loopback HTTP origin');
  }
  return url.href;
}
function trustedDocument(value, devUrl) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search) return false;
    return devUrl
      ? url.origin === new URL(devUrl).origin && ['/', '/index.html'].includes(url.pathname)
      : url.protocol === 'pano:' && url.host === 'app' && url.pathname === '/index.html';
  } catch {
    return false;
  }
}
function validateSender(event, contents, devUrl) {
  if (
    !contents ||
    contents.isDestroyed() ||
    event.sender !== contents ||
    !event.senderFrame ||
    event.senderFrame !== contents.mainFrame ||
    !trustedDocument(event.senderFrame.url, devUrl)
  ) {
    fail('请求来源不受信任。');
  }
}
function allowedRequest(value, devUrl) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'data:') return true;
    if (url.protocol === 'blob:') return allowedRequest(url.pathname, devUrl);
    if (devUrl) {
      const dev = new URL(devUrl);
      return (url.protocol === 'http:' || url.protocol === 'ws:') && url.host === dev.host;
    }
    return url.protocol === 'pano:' && url.host === 'app';
  } catch {
    return false;
  }
}
function contentSecurityPolicy(devUrl) {
  const connections = devUrl ? ` ${new URL(devUrl).origin} ws://${new URL(devUrl).host}` : '';
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    `connect-src 'self'${connections}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
function assetPath(root, requestUrl) {
  if (typeof requestUrl !== 'string' || requestUrl.length > 4096) return null;
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'pano:' || url.host !== 'app' || url.username || url.password) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded)) return null;
    const parts = decoded.split('/').filter(Boolean);
    if (parts.some((part) => part.startsWith('.'))) return null;
    const target = path.resolve(root, ...parts);
    return isWithin(root, target) ? target : null;
  } catch {
    return null;
  }
}
function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
// Preserve filesystem/UserError failures at the Promise boundary used by IPC.
const attempt = (evaluate) => Effect.try({ try: evaluate, catch: (error) => error });
const io = (evaluate) => Effect.tryPromise({ try: evaluate, catch: (error) => error });
function resolveDocument(value) {
  return Effect.runPromise(
    attempt(() => validatePath(value)).pipe(
      Effect.flatMap((filePath) => io(() => fs.realpath(filePath))),
      Effect.tap((canonical) => attempt(() => validatePath(canonical))),
      Effect.tap((canonical) =>
        io(() => fs.stat(canonical)).pipe(
          Effect.flatMap((stat) => attempt(() => checkDocumentStat(stat, canonical))),
        ),
      ),
    ),
  );
}
function checkDocumentStat(stat, filePath) {
  if (!stat.isFile()) fail('只能打开普通 PDF/EPUB 文件。');
  const minimum = path.extname(filePath).toLowerCase() === '.epub' ? 4 : 8;
  if (stat.size < minimum || stat.size > MAX_DOCUMENT_BYTES)
    fail('文档为空、无效或超过 256 MiB 大小限制。');
}
function hasPdfMagic(bytes) {
  return /%PDF-(?:1\.[0-7]|2\.0)/.test(Buffer.from(bytes).subarray(0, 1024).toString('latin1'));
}
function checkDocumentMagic(data, filePath) {
  const epub = path.extname(filePath).toLowerCase() === '.epub';
  const valid = epub
    ? data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4
    : hasPdfMagic(data);
  if (!valid) fail(`该文件不是有效的 ${epub ? 'EPUB' : 'PDF'} 文件。`);
}
function readChunks(handle, data, offset = 0) {
  if (offset === data.length) return Effect.succeed(data);
  return io(() =>
    handle.read(data, offset, Math.min(1024 * 1024, data.length - offset), offset),
  ).pipe(
    Effect.flatMap(({ bytesRead }) =>
      bytesRead
        ? readChunks(handle, data, offset + bytesRead)
        : Effect.fail(new UserError('读取时文件发生变化，请重试。')),
    ),
  );
}
function readHeader(handle, canonical, stat) {
  return attempt(() => {
    checkDocumentStat(stat, canonical);
    return Buffer.alloc(Math.min(1024, stat.size));
  }).pipe(
    Effect.flatMap((header) =>
      io(() => handle.read(header, 0, header.length, 0)).pipe(
        Effect.flatMap(({ bytesRead }) =>
          attempt(() => checkDocumentMagic(header.subarray(0, bytesRead), canonical)),
        ),
      ),
    ),
  );
}
function verifyRead(handle, canonical, stat, data) {
  return io(() => handle.stat()).pipe(
    Effect.flatMap((after) =>
      attempt(() => {
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
          fail('读取时文件发生变化，请重试。');
        checkDocumentMagic(data, canonical);
      }),
    ),
  );
}
function readHandle(handle, canonical) {
  return io(() => handle.stat()).pipe(
    Effect.tap((stat) => readHeader(handle, canonical, stat)),
    Effect.bindTo('stat'),
    // Allocate from the checked size, never read an unbounded growing file.
    Effect.bind('data', ({ stat }) => readChunks(handle, Buffer.alloc(stat.size))),
    Effect.tap(({ stat, data }) => verifyRead(handle, canonical, stat, data)),
    Effect.map(({ data }) => new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
  );
}
function readDocument(canonical) {
  return Effect.runPromise(
    attempt(() => validatePath(canonical)).pipe(
      Effect.flatMap(() =>
        Effect.acquireUseRelease(
          // Nonblocking + no-follow rejects FIFOs and final-component symlink replacement.
          io(() =>
            fs.open(
              canonical,
              constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
            ),
          ),
          (handle) => readHandle(handle, canonical),
          (handle) => io(() => handle.close()),
        ),
      ),
    ),
  );
}
function friendlyError(error) {
  if (error instanceof UserError) return error.message;
  if (error?.code === 'ENOENT') return '文件已移动或删除，请重新选择。';
  if (['EACCES', 'EPERM'].includes(error?.code)) return '无法访问文件，请检查文件权限。';
  return '操作失败，请重试或重新选择文件。';
}

module.exports = {
  APP_URL,
  MAX_DOCUMENT_BYTES,
  MAX_RECENTS,
  MAX_SETTINGS_BYTES,
  UserError,
  fail,
  record,
  validId,
  validateId,
  validatePath,
  validateWindowAction,
  validatePosition,
  validateExternalUrl,
  validateDevUrl,
  trustedDocument,
  validateSender,
  allowedRequest,
  contentSecurityPolicy,
  assetPath,
  isWithin,
  resolveDocument,
  readDocument,
  hasPdfMagic,
  friendlyError,
};
