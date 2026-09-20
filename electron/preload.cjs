'use strict';

// Sandboxed preloads may require Electron, but not local Node modules.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const callbacks = { file: new Set(), command: new Set() };
const commands = new Set(['open', 'find', 'zoom-in', 'zoom-out', 'actual-size']);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error('文件标识无效。');
  return value;
}
function position(value) {
  const keys = ['page', 'scale', 'layout', 'columns', 'zoomMode', 'fitPages', 'scrollInput', 'left', 'top'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > keys.length
      || Object.keys(value).some(key => !keys.includes(key))) throw new Error('阅读位置无效。');
  // Reject large/nested values before IPC serialization. The main process validates ranges.
  const result = {};
  for (const key of keys) {
    const v = value[key];
    if (v === undefined) continue;
    if (!((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 16))) {
      throw new Error('阅读位置无效。');
    }
    result[key] = v;
  }
  return result;
}
async function invoke(channel, ...args) {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    const message = String(error?.message || '操作失败，请重试。').replace(/^Error invoking remote method '[^']+': Error: /, '');
    throw new Error(message);
  }
}
function subscribe(kind, callback) {
  if (typeof callback !== 'function') throw new TypeError('Expected an event callback');
  if (callbacks[kind].size >= 32) throw new Error('Too many event listeners');
  const wrapped = value => callback(value);
  callbacks[kind].add(wrapped);
  if (callbacks[kind].size === 1) {
    void invoke('pano:listen', kind, true).catch(error => console.error('Event subscription failed:', error.name));
  }
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    callbacks[kind].delete(wrapped);
    if (callbacks[kind].size === 0) {
      void invoke('pano:listen', kind, false).catch(error => console.error('Event unsubscription failed:', error.name));
    }
  };
}
for (const kind of ['file', 'command']) {
  ipcRenderer.on(`pano:${kind}`, (_event, value) => {
    if (kind === 'command' && !commands.has(value)) return;
    for (const callback of [...callbacks[kind]]) {
      try { callback(value); } catch (error) { console.error('Desktop event callback failed:', error?.name || 'Error'); }
    }
  });
}
contextBridge.exposeInMainWorld('panopdf', {
  platform: process.platform,
  openFile: () => invoke('pano:open'),
  openRecent: async value => invoke('pano:recent-open', id(value)),
  openDropped: async file => {
    // getPathForFile rejects non-File values; synthetic browser Files have no native path.
    let filePath;
    try { filePath = webUtils.getPathForFile(file); } catch { throw new Error('请拖入本地 PDF 文件。'); }
    if (!filePath || filePath.length > 4096 || /[\x00-\x1f\x7f]/.test(filePath) || !/\.pdf$/i.test(filePath)) {
      throw new Error('请拖入本地 PDF 文件。');
    }
    return invoke('pano:drop', filePath);
  },
  getRecent: () => invoke('pano:recent'),
  savePosition: async (value, readingPosition) => invoke('pano:position', id(value), position(readingPosition)),
  openExternal: async url => {
    if (typeof url !== 'string' || url.length > 2048 || /[\s\x00-\x1f\x7f]/.test(url)) {
      throw new Error('此链接不允许打开。');
    }
    return invoke('pano:external', url);
  },
  onOpenFile: callback => subscribe('file', callback),
  onCommand: callback => subscribe('command', callback),
});
