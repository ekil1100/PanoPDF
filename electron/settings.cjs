'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  MAX_RECENTS, MAX_SETTINGS_BYTES, record, validId, validateId, validatePath, validatePosition, UserError,
} = require('./security.cjs');

function sanitizeSettings(value) {
  const empty = { version: 1, recents: [] };
  if (!record(value) || value.version !== 1 || !Array.isArray(value.recents)) return empty;
  const ids = new Set();
  const paths = new Set();
  const recents = [];
  for (const entry of value.recents.slice(0, 1000)) {
    if (!record(entry) || !validId(entry.id) || ids.has(entry.id)
        || !Number.isSafeInteger(entry.lastOpened) || entry.lastOpened < 0) continue;
    let filePath;
    try { filePath = validatePath(entry.path); } catch { continue; }
    if (paths.has(filePath)) continue;
    let position;
    try { position = validatePosition(entry.position); } catch { /* Ignore invalid saved positions. */ }
    ids.add(entry.id);
    paths.add(filePath);
    recents.push({ id: entry.id, path: filePath, lastOpened: entry.lastOpened, ...(position ? { position } : {}) });
  }
  recents.sort((a, b) => b.lastOpened - a.lastOpened);
  return { version: 1, recents: recents.slice(0, MAX_RECENTS) };
}

async function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.settings-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filePath);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

class SettingsStore {
  constructor(filePath, { write = atomicWrite, warn = console.warn } = {}) {
    this.filePath = filePath;
    this.write = write;
    this.warn = warn;
    this.state = { version: 1, recents: [] };
    this.queue = Promise.resolve();
    this.pending = 0;
  }
  async load() {
    try {
      // Nonblocking open lets us reject FIFOs before they can stall startup.
      const handle = await fs.open(this.filePath, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) throw new Error('Settings must be a bounded regular file');
        // Bound the allocation even if the settings file grows during the read.
        const buffer = Buffer.alloc(MAX_SETTINGS_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_SETTINGS_BYTES) throw new Error('Settings file is too large');
        this.state = sanitizeSettings(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
      } finally { await handle.close(); }
    } catch (error) {
      this.state = { version: 1, recents: [] };
      if (error.code !== 'ENOENT') this.warn('Ignoring unreadable or corrupt settings:', error.message);
    }
  }
  recent() {
    return this.state.recents.map(entry => ({
      id: entry.id, name: path.basename(entry.path), lastOpened: entry.lastOpened, page: entry.position?.page ?? 1,
    }));
  }
  authorized(id) {
    validateId(id);
    const entry = this.state.recents.find(item => item.id === id);
    if (!entry) throw new UserError('此文件不在最近打开记录中，请重新选择。');
    return structuredClone(entry);
  }
  mutate(update) {
    if (this.pending >= 32) return Promise.reject(new UserError('保存请求过于频繁，请稍后重试。'));
    this.pending += 1;
    const next = this.queue.then(async () => {
      const state = structuredClone(this.state);
      const result = update(state);
      try { await this.write(this.filePath, state); }
      catch (error) {
        this.warn('Failed to persist settings:', error.message);
        throw new UserError('无法保存阅读记录，请检查应用数据目录的空间和权限。');
      }
      this.state = state;
      return result;
    }).finally(() => { this.pending -= 1; });
    // One failed write must not poison subsequent updates.
    this.queue = next.catch(() => {});
    return next;
  }
  remember(filePath) {
    validatePath(filePath);
    return this.mutate(state => {
      const existing = state.recents.find(entry => entry.path === filePath);
      const entry = { ...existing, id: existing?.id ?? randomUUID(), path: filePath, lastOpened: Date.now() };
      state.recents = [entry, ...state.recents.filter(item => item.path !== filePath)].slice(0, MAX_RECENTS);
      return structuredClone(entry);
    });
  }
  savePosition(id, value) {
    validateId(id);
    const position = validatePosition(value);
    return this.mutate(state => {
      const entry = state.recents.find(item => item.id === id);
      if (!entry) throw new UserError('此文件不在最近打开记录中，请重新选择。');
      entry.position = position;
    });
  }
  flush() { return this.queue; }
}
module.exports = { sanitizeSettings, atomicWrite, SettingsStore };
