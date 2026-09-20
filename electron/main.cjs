'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  APP_URL, UserError, validateDevUrl, validateSender, validateExternalUrl, validatePath, validateWindowAction, trustedDocument,
  allowedRequest, contentSecurityPolicy, assetPath, isWithin, resolvePdf, readPdf, friendlyError,
} = require('./security.cjs');
const { SettingsStore } = require('./settings.cjs');
const { StartupSession } = require('./startup.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'pano', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
app.setName('PanoPDF');
// Test isolation is opt-in and cannot override a packaged application's data directory.
if (!app.isPackaged && process.env.PANO_TEST_MODE === '1' && process.env.PANO_USER_DATA) {
  if (!path.isAbsolute(process.env.PANO_USER_DATA)) throw new Error('PANO_USER_DATA must be an absolute path');
  app.setPath('userData', process.env.PANO_USER_DATA);
}
const devUrl = !app.isPackaged && process.env.PANO_DEV_SERVER_URL
  ? validateDevUrl(process.env.PANO_DEV_SERVER_URL) : undefined;
let window;
let settings;
let launchState;
let startup;
let activeNativePath;
let opening = false;
let openFinished = Promise.resolve();
let draining = false;
let quitting = false;
let flushed = false;
let initialized = false;
const listening = { file: false, command: false, 'window-state': false };
const nativePaths = [];
const commands = [];

function queueNativePath(filePath) {
  try { validatePath(filePath); } catch { return; }
  if (filePath !== startup?.nativePath && filePath !== activeNativePath
      && !nativePaths.includes(filePath) && nativePaths.length < 16) nativePaths.push(filePath);
  if (initialized && !liveWindow() && !quitting) reopenWindow();
  void drainNativePaths();
}
// Register before ready: macOS can send open-file during application startup.
app.on('open-file', (event, filePath) => { event.preventDefault(); queueNativePath(filePath); });
function commandLineFiles(argv) {
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!arg.startsWith('-') && path.extname(arg).toLowerCase() === '.pdf') queueNativePath(path.resolve(arg));
  }
}
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else {
  commandLineFiles(process.argv);
  app.on('second-instance', (_event, argv) => {
    commandLineFiles(argv);
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else if (initialized) reopenWindow();
  });
  app.whenReady().then(start).catch(error => {
    console.error('Application startup failed:', error);
    dialog.showErrorBox('PanoPDF 无法启动', '请先运行 bun run build，或使用 bun run dev 启动开发模式。');
    app.quit();
  });
}

function liveWindow() { return window && !window.isDestroyed() ? window : undefined; }
function emitCommand(command) {
  if (liveWindow() && startup?.ready && listening.command) window.webContents.send('pano:command', command);
  else {
    if (commands.length < 16) commands.push(command);
    if (initialized && !liveWindow() && !quitting) reopenWindow();
  }
}
function reopenWindow() {
  void createWindow().catch(error => {
    console.error('Failed to create application window:', error);
    dialog.showErrorBox('无法打开窗口', '窗口加载失败，请退出后重新启动 PanoPDF。');
  });
}
async function openedFile(filePath) {
  const canonical = await resolvePdf(filePath);
  const data = await readPdf(canonical);
  const entry = await settings.remember(canonical);
  return { id: entry.id, name: path.basename(canonical), data, ...(entry.position ? { position: entry.position } : {}) };
}
async function exclusiveOpen(action) {
  if (opening || quitting) throw new UserError('另一个文件正在打开，请稍后重试。');
  opening = true;
  let finish;
  openFinished = new Promise(resolve => { finish = resolve; });
  try { return await action(); }
  finally { opening = false; finish(); void drainNativePaths(); }
}
function requeueActiveNativePath() {
  if (activeNativePath) {
    nativePaths.unshift(activeNativePath);
    activeNativePath = undefined;
  }
}
async function drainNativePaths() {
  if (draining || opening || quitting || !settings || !liveWindow() || !listening.file || !startup?.ready) return;
  draining = true;
  const target = window;
  const session = startup;
  const available = () => liveWindow() === target && listening.file && session.ready && !quitting;
  try {
    while (nativePaths.length && available()) {
      const filePath = activeNativePath = nativePaths.shift();
      try {
        const file = await exclusiveOpen(() => openedFile(filePath));
        if (!available()) { requeueActiveNativePath(); break; }
        target.webContents.send('pano:file', file);
      } catch (error) {
        console.warn('Native file open failed:', error.code || error.name);
        if (!available()) { requeueActiveNativePath(); break; }
        await dialog.showMessageBox(target, {
          type: 'error', title: '无法打开 PDF', message: friendlyError(error), buttons: ['好'],
        });
      } finally { activeNativePath = undefined; }
    }
  } finally {
    draining = false;
    if (liveWindow() !== target) void drainNativePaths();
  }
}
function windowState(target = liveWindow()) {
  return { maximized: target.isMaximized(), fullscreen: target.isFullScreen() };
}
function emitWindowState() {
  if (liveWindow() && listening['window-state']) window.webContents.send('pano:window-state', windowState());
}
function drainCommands() {
  if (startup?.ready && listening.command) {
    for (const command of commands.splice(0)) emitCommand(command);
  }
}

function installIpc() {
  let tokens = 80;
  let lastRefill = Date.now();
  let lastExternal = 0;
  function handle(channel, argumentCount, action) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        validateSender(event, liveWindow()?.webContents, devUrl);
        if (args.length !== argumentCount) throw new UserError('请求参数无效。');
        // The renderer flushes its final position during beforeunload.
        if (quitting && !['pano:position', 'pano:listen'].includes(channel)) throw new UserError('应用正在退出。');
        const now = Date.now();
        tokens = Math.min(80, tokens + (now - lastRefill) * 0.04);
        lastRefill = now;
        if (tokens < 1) throw new UserError('操作过于频繁，请稍后重试。');
        tokens -= 1;
        return await action(...args);
      } catch (error) {
        console.warn(`IPC request rejected (${channel}):`, error.code || error.name);
        throw new Error(friendlyError(error));
      }
    });
  }
  handle('pano:startup', 0, () => startup.get());
  // The preload acknowledges in a later task, after resolving getStartup to the renderer.
  handle('pano:startup-ready', 0, () => {
    startup.acknowledge();
    drainCommands();
    void drainNativePaths();
  });
  handle('pano:window-state', 0, () => windowState());
  handle('pano:window-action', 1, value => {
    const action = validateWindowAction(value);
    const target = liveWindow();
    if (action === 'minimize') target.minimize();
    else if (action === 'toggle-maximize') {
      if (target.isMaximized()) target.unmaximize();
      else target.maximize();
    } else target.close(); // Normal close preserves beforeunload and its position save.
  });
  handle('pano:open', 0, () => exclusiveOpen(async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '打开 PDF', buttonLabel: '打开', filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return openedFile(result.filePaths[0]);
  }));
  handle('pano:recent-open', 1, id => exclusiveOpen(() => openedFile(settings.authorized(id).path)));
  handle('pano:drop', 1, filePath => exclusiveOpen(async () => {
    // A native File is useful evidence, not proof of a user gesture. Always obtain
    // main-process consent before reading or authorizing a renderer-supplied path.
    validatePath(filePath);
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: '打开拖入的 PDF', message: '允许 PanoPDF 读取此文件吗？',
      detail: `请核对完整文件路径；仅在这是您要打开的文件时允许（若为符号链接，将读取它指向的 PDF）。\n\n${filePath}`,
      buttons: ['取消', '允许打开'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response !== 1) throw new UserError('已取消打开文件。');
    return openedFile(filePath);
  }));
  handle('pano:recent', 0, () => settings.recent());
  handle('pano:position', 2, (id, position) => settings.savePosition(id, position));
  handle('pano:external', 1, async value => {
    const url = validateExternalUrl(value);
    if (Date.now() - lastExternal < 1000) throw new UserError('打开链接过于频繁，请稍后重试。');
    lastExternal = Date.now();
    await shell.openExternal(url);
  });
  handle('pano:listen', 2, (kind, enabled) => {
    if (!['file', 'command', 'window-state'].includes(kind) || typeof enabled !== 'boolean') throw new UserError('请求参数无效。');
    listening[kind] = enabled;
    if (enabled && kind === 'file') void drainNativePaths();
    if (enabled && kind === 'command') drainCommands();
    if (enabled && kind === 'window-state') emitWindowState();
  });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
async function installProtocol() {
  if (devUrl) return;
  const root = await fs.realpath(path.join(__dirname, '..', 'dist'));
  protocol.handle('pano', async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    try {
      const target = assetPath(root, request.url);
      if (!target) return new Response(null, { status: 403 });
      const canonical = await fs.realpath(target);
      if (!isWithin(root, canonical)) return new Response(null, { status: 403 });
      const stat = await fs.stat(canonical);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return new Response(null, { status: 404 });
      return new Response(request.method === 'HEAD' ? null : await fs.readFile(canonical), {
        headers: {
          'Content-Type': mimeTypes[path.extname(canonical).toLowerCase()] || 'application/octet-stream',
          'Content-Security-Policy': contentSecurityPolicy(), 'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch { return new Response(null, { status: 404 }); }
  });
}
function secureSession(session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', event => event.preventDefault());
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedRequest(details.url, devUrl) });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    headers['Content-Security-Policy'] = [contentSecurityPolicy(devUrl)];
    headers['X-Content-Type-Options'] = ['nosniff'];
    callback({ responseHeaders: headers });
  });
}
async function createWindow() {
  if (liveWindow() || quitting) return;
  listening.file = false;
  listening.command = false;
  listening['window-state'] = false;
  window = new BrowserWindow({
    title: 'PanoPDF', width: 1280, height: 820, minWidth: 800, minHeight: 560,
    show: false, frame: false, autoHideMenuBar: true, backgroundColor: '#f1f2f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false, spellcheck: false,
    },
  });
  const created = window;
  const session = startup = new StartupSession({
    paths: nativePaths, lastPath: settings.lastPath(),
    open: async filePath => {
      // A replacement macOS window must wait for its predecessor's in-flight read.
      await openFinished;
      if (session.disposed) throw new UserError('窗口已关闭。');
      return exclusiveOpen(() => openedFile(filePath));
    },
    ...launchState,
  });
  launchState = { firstRun: false };
  if (process.platform !== 'darwin') created.setMenuBarVisibility(false);
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    created.on(event, emitWindowState);
  }
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Only Vite's same-document development reloads may initiate navigation.
  created.webContents.on('will-navigate', event => {
    if (!devUrl || !trustedDocument(event.url, devUrl)) event.preventDefault();
  });
  created.webContents.on('will-frame-navigate', event => {
    if (!devUrl || !event.isMainFrame || !trustedDocument(event.url, devUrl)) event.preventDefault();
  });
  created.webContents.on('will-redirect', event => event.preventDefault());
  created.webContents.on('will-attach-webview', event => event.preventDefault());
  created.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      listening.file = false;
      listening.command = false;
      listening['window-state'] = false;
      session.ready = false;
    }
  });
  created.on('closed', () => {
    session.dispose();
    if (window === created) {
      // Put an in-flight native request back before a replacement window picks its startup file.
      requeueActiveNativePath();
      window = undefined;
      listening.file = false;
      listening.command = false;
      listening['window-state'] = false;
    }
  });
  created.once('ready-to-show', () => created.show());
  await created.loadURL(devUrl || APP_URL);
}
function installMenu() {
  const mac = process.platform === 'darwin';
  const item = (label, accelerator, command) => ({ label, accelerator, click: () => emitCommand(command) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: 'PanoPDF', submenu: [
      { role: 'about', label: '关于 PanoPDF' }, { type: 'separator' },
      { role: 'hide', label: '隐藏 PanoPDF' }, { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '显示全部' }, { type: 'separator' }, { role: 'quit', label: '退出 PanoPDF' },
    ] }] : []),
    { label: '文件', submenu: [item('打开 PDF…', 'CmdOrCtrl+O', 'open'),
      item('关闭文档', 'CmdOrCtrl+W', 'close-document'), { type: 'separator' },
      ...(mac ? [{ role: 'close', label: '关闭窗口', accelerator: 'CmdOrCtrl+Shift+W' }]
        : [{ role: 'quit', label: '退出' }])] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }, { type: 'separator' }, item('查找', 'CmdOrCtrl+F', 'find'),
    ] },
    { label: '视图', submenu: [
      item('放大', 'CmdOrCtrl+Plus', 'zoom-in'), item('缩小', 'CmdOrCtrl+-', 'zoom-out'),
      item('实际大小', 'CmdOrCtrl+0', 'actual-size'), { type: 'separator' },
      { role: 'togglefullscreen', label: '切换全屏' },
    ] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放窗口' }] },
  ]));
}
async function start() {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  await settings.load();
  launchState = await settings.beginLaunch();
  await installProtocol();
  secureSession(require('electron').session.defaultSession);
  installIpc();
  installMenu();
  initialized = true;
  await createWindow();
  app.on('activate', () => { if (!liveWindow()) reopenWindow(); });
}
app.on('window-all-closed', () => { if (quitting || process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; });
// will-quit runs after beforeunload and window closure, so its queue includes the final save.
app.on('will-quit', event => {
  if (settings && !flushed) {
    event.preventDefault();
    void settings.flush().finally(() => { flushed = true; app.quit(); });
  }
});
