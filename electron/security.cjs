'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');

const MAX_PDF_BYTES = 256 * 1024 * 1024;
const MAX_RECENTS = 20;
const MAX_SETTINGS_BYTES = 1024 * 1024;
const APP_URL = 'pano://app/index.html';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class UserError extends Error {}
function fail(message = '请求参数无效。') { throw new UserError(message); }
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function validId(value) { return typeof value === 'string' && ID_PATTERN.test(value); }
function validateId(value) { if (!validId(value)) fail(); return value; }
function validatePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)
      || !path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.pdf') {
    fail('请选择本地 PDF 文件。');
  }
  return value;
}
function validateWindowAction(value) {
  if (!['minimize', 'toggle-maximize', 'close'].includes(value)) fail();
  return value;
}
function validatePosition(value) {
  const keys = ['page', 'scale', 'layout', 'columns', 'zoomMode', 'fitPages', 'scrollInput', 'left', 'top'];
  if (!record(value) || Object.keys(value).length > keys.length
      || Object.keys(value).some(key => !keys.includes(key))) fail();
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (!integer(value.page, 1, 1_000_000)
      || !Number.isFinite(value.scale) || value.scale < 0.01 || value.scale > 100
      || !['horizontal', 'vertical'].includes(value.layout)
      || !integer(value.columns, 1, 32)
      || !['custom', 'height', 'pages'].includes(value.zoomMode)
      || !integer(value.fitPages, 1, 32)
      || !['auto', 'page', 'smooth'].includes(value.scrollInput)) fail();
  for (const key of ['left', 'top']) {
    if (value[key] !== undefined && (!Number.isFinite(value[key]) || Math.abs(value[key]) > 10_000_000)) fail();
  }
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) fail('此链接不允许打开。');
  let url;
  try { url = new URL(value); } catch { fail('此链接不允许打开。'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    fail('仅允许在系统浏览器中打开 HTTP 或 HTTPS 链接。');
  }
  return url.href;
}
function validateDevUrl(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid development URL');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
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
  } catch { return false; }
}
function validateSender(event, contents, devUrl) {
  if (!contents || contents.isDestroyed() || event.sender !== contents || !event.senderFrame
      || event.senderFrame !== contents.mainFrame || !trustedDocument(event.senderFrame.url, devUrl)) {
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
  } catch { return false; }
}
function contentSecurityPolicy(devUrl) {
  const connections = devUrl ? ` ${new URL(devUrl).origin} ws://${new URL(devUrl).host}` : '';
  return [
    "default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data: blob:",
    `connect-src 'self'${connections}`, "object-src 'none'", "frame-src 'none'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
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
    if (parts.some(part => part.startsWith('.'))) return null;
    const target = path.resolve(root, ...parts);
    return isWithin(root, target) ? target : null;
  } catch { return null; }
}
function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
async function resolvePdf(value) {
  validatePath(value);
  const canonical = await fs.realpath(value);
  validatePath(canonical);
  const stat = await fs.stat(canonical);
  checkPdfStat(stat);
  return canonical;
}
function checkPdfStat(stat) {
  if (!stat.isFile()) fail('只能打开普通 PDF 文件。');
  if (stat.size < 8 || stat.size > MAX_PDF_BYTES) fail('PDF 文件为空、无效或超过 256 MiB 大小限制。');
}
function hasPdfMagic(bytes) { return /%PDF-(?:1\.[0-7]|2\.0)/.test(Buffer.from(bytes).subarray(0, 1024).toString('latin1')); }
async function readPdf(canonical) {
  validatePath(canonical);
  // Nonblocking + no-follow prevents replacement by a FIFO or final-component symlink.
  const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    checkPdfStat(stat);
    const header = Buffer.alloc(Math.min(1024, stat.size));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!hasPdfMagic(header.subarray(0, bytesRead))) fail('该文件不是有效的 PDF 文件。');
    // Allocate from the checked size, never read an unbounded growing file.
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const result = await handle.read(data, offset, Math.min(1024 * 1024, data.length - offset), offset);
      if (!result.bytesRead) fail('读取时文件发生变化，请重试。');
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('读取时文件发生变化，请重试。');
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally { await handle.close(); }
}
function friendlyError(error) {
  if (error instanceof UserError) return error.message;
  if (error?.code === 'ENOENT') return '文件已移动或删除，请重新选择。';
  if (['EACCES', 'EPERM'].includes(error?.code)) return '无法访问文件，请检查文件权限。';
  return '操作失败，请重试或重新选择文件。';
}

module.exports = {
  APP_URL, MAX_PDF_BYTES, MAX_RECENTS, MAX_SETTINGS_BYTES, UserError, fail, record,
  validId, validateId, validatePath, validateWindowAction, validatePosition, validateExternalUrl, validateDevUrl,
  trustedDocument, validateSender, allowedRequest, contentSecurityPolicy, assetPath, isWithin,
  resolvePdf, readPdf, hasPdfMagic, friendlyError,
};
