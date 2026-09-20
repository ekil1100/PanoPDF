'use strict';

const { UserError, friendlyError } = require('./security.cjs');

// One initial document per window. Native paths share the application's FIFO.
class StartupSession {
  constructor({ paths, lastPath, open, firstRun, error }) {
    this.paths = paths;
    this.lastPath = lastPath;
    this.open = open;
    this.firstRun = firstRun;
    this.error = error;
    this.loading = undefined;
    this.delivered = false;
    this.ready = false;
    this.disposed = false;
    this.nativePath = undefined;
  }
  empty(error = this.error) {
    return { firstRun: this.firstRun, file: null, ...(error ? { error } : {}) };
  }
  async get() {
    if (this.loading) {
      await this.loading;
      return this.empty();
    }
    this.loading = this.load();
    const result = await this.loading;
    this.loading = Promise.resolve(); // Do not retain the PDF's bytes for the window's lifetime.
    this.delivered = true;
    return result;
  }
  async load() {
    let restoring = this.paths.length === 0;
    let filePath = restoring ? this.lastPath : (this.nativePath = this.paths.shift());
    while (filePath && !this.disposed) {
      let file;
      let error;
      try { file = await this.open(filePath); }
      catch (failure) { error = friendlyError(failure); }
      if (this.disposed) return this.empty();
      // An explicit OS open arriving during restoration wins, even if restoration failed.
      if (restoring && this.paths.length) {
        restoring = false;
        this.nativePath = this.paths.shift();
        if (this.nativePath !== filePath || error) {
          filePath = this.nativePath;
          continue;
        }
      }
      if (error) return this.empty([this.error, error].filter(Boolean).join('\n'));
      return { ...this.empty(), file };
    }
    return this.empty();
  }
  acknowledge() {
    if (!this.delivered || this.disposed) throw new UserError('启动尚未完成，请稍后重试。');
    this.ready = true;
    this.nativePath = undefined;
  }
  dispose() {
    this.disposed = true;
    this.ready = false;
    // Preserve a native request if its window closes before the preload acknowledges it.
    if (this.nativePath) {
      this.paths.unshift(this.nativePath);
      this.nativePath = undefined;
    }
  }
}

module.exports = { StartupSession };
