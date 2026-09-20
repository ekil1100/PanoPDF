import { test, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const security = require('../electron/security.cjs');
const { SettingsStore, sanitizeSettings, atomicWrite } = require('../electron/settings.cjs');

const position = { page: 3, scale: 1.25, layout: 'horizontal', columns: 2, zoomMode: 'custom', fitPages: 3, scrollInput: 'auto', left: 12, top: -5 };
const localPdf = (name: string) => path.resolve('.agents', `${name}.pdf`);
async function workspace(t: TestContext) {
  const root = path.resolve('.agents');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'security-'));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('external URLs accept only bounded credential-free HTTP(S)', () => {
  assert.equal(security.validateExternalUrl('https://example.com/a#b'), 'https://example.com/a#b');
  assert.equal(security.validateExternalUrl('http://localhost:8000/'), 'http://localhost:8000/');
  for (const url of [null, {}, 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', '//example.com',
    'https://u:p@example.com', ' https://example.com', 'https://example.com\n', `https://example.com/${'a'.repeat(2048)}`]) {
    assert.throws(() => security.validateExternalUrl(url));
  }
});

test('development URL is limited to an explicit loopback HTTP port', () => {
  assert.equal(security.validateDevUrl('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/');
  for (const value of ['https://example.com/', 'http://localhost:5173/', 'http://127.0.0.1/',
    'http://127.0.0.1:5173/other', 'http://u@127.0.0.1:5173/', 'http://127.0.0.1:5173/?x']) {
    assert.throws(() => security.validateDevUrl(value));
  }
});

test('IPC rejects subframes, other windows and untrusted documents', () => {
  const frame = { url: security.APP_URL };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  assert.doesNotThrow(() => security.validateSender(event, contents));
  assert.throws(() => security.validateSender({ ...event, sender: {} }, contents));
  assert.throws(() => security.validateSender({ ...event, senderFrame: { url: security.APP_URL } }, contents));
  assert.throws(() => security.validateSender({ ...event, senderFrame: null }, contents));
  for (const url of ['pano://evil/index.html', 'pano://app/other.html', 'file:///index.html',
    'https://example.com/', 'pano://user@app/index.html', 'pano://app/index.html?x']) {
    frame.url = url;
    assert.throws(() => security.validateSender(event, contents));
  }
  frame.url = 'http://127.0.0.1:5173/';
  assert.doesNotThrow(() => security.validateSender(event, contents, frame.url));
  assert.throws(() => security.validateSender(event, contents, 'http://127.0.0.1:5174/'));
  contents.isDestroyed = () => true;
  assert.throws(() => security.validateSender(event, contents, frame.url));
});

test('network policy blocks remote resources and file URLs', () => {
  for (const url of ['pano://app/index.html', 'pano://app/pdfjs/wasm/qcms_bg.wasm', 'blob:pano://app/id', 'data:image/png;base64,AA']) {
    assert.equal(security.allowedRequest(url), true);
  }
  for (const url of ['file:///etc/passwd', 'https://example.com/a.js', 'pano://evil/a', 'blob:https://evil.com/a', 'blob:null/id']) {
    assert.equal(security.allowedRequest(url), false);
  }
  const dev = 'http://127.0.0.1:5173/';
  assert.equal(security.allowedRequest('ws://127.0.0.1:5173/', dev), true);
  assert.equal(security.allowedRequest('http://127.0.0.1:5174/', dev), false);
  assert.equal(security.allowedRequest('http://user@127.0.0.1:5173/', dev), false);
  const csp = security.contentSecurityPolicy(dev);
  assert.match(csp, /wasm-unsafe-eval/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /'unsafe-eval'|script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(security.contentSecurityPolicy(), /https?:|wss?:/);
});

test('packaged asset resolution cannot escape dist or reveal hidden files', () => {
  const root = path.resolve('.agents', 'dist');
  assert.equal(security.assetPath(root, 'pano://app/assets/main.js'), path.join(root, 'assets/main.js'));
  for (const url of ['pano://evil/assets/main.js', 'file:///etc/passwd', 'pano://app/.env',
    'pano://app/%2e%2e%2fsecret', 'pano://app/%2e%2e%5csecret', 'pano://app/a%00b', 'pano://app/%FF']) {
    assert.equal(security.assetPath(root, url), null);
  }
  assert.equal(security.isWithin(root, `${root}-other/x`), false);
  assert.equal(security.isWithin(root, root), false);
});

test('reading positions reject unknown fields, deep values and unreasonable numbers', () => {
  assert.deepEqual(security.validatePosition(position), position);
  const invalid = [null, [], { ...position, extra: true }, { ...position, page: 0 },
    { ...position, page: 1_000_001 }, { ...position, scale: Infinity }, { ...position, scale: 101 },
    { ...position, columns: 33 }, { ...position, columns: 1.5 }, { ...position, fitPages: 0 },
    { ...position, top: NaN }, { ...position, left: 1e12 }, { ...position, layout: {} },
    { ...position, zoomMode: 'fit' }, { ...position, scrollInput: 'gesture' }];
  for (const value of invalid) assert.throws(() => security.validatePosition(value));
  assert.throws(() => security.validateId(localPdf('arbitrary')));
  assert.throws(() => security.validateId('x'.repeat(10000)));
});

test('PDF reader requires a regular .pdf file, valid magic and bounded size', async t => {
  const directory = await workspace(t);
  const good = path.join(directory, 'valid.PDF');
  await fs.writeFile(good, '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const canonical = await security.resolvePdf(good);
  assert.match(Buffer.from(await security.readPdf(canonical)).toString(), /^%PDF-1.7/);
  assert.equal(security.hasPdfMagic(Buffer.from('not a PDF')), false);
  assert.equal(security.hasPdfMagic(Buffer.from(`${'x'.repeat(1024)}%PDF-1.7`)), false);
  const fake = path.join(directory, 'fake.pdf');
  await fs.writeFile(fake, 'This is not a PDF document');
  await assert.rejects(security.readPdf(fake), /有效的 PDF/);
  const folder = path.join(directory, 'folder.pdf');
  await fs.mkdir(folder);
  await assert.rejects(security.resolvePdf(folder), /普通 PDF/);
  const huge = path.join(directory, 'huge.pdf');
  await fs.writeFile(huge, '%PDF-1.7');
  await fs.truncate(huge, security.MAX_PDF_BYTES + 1);
  await assert.rejects(security.resolvePdf(huge), /256 MiB/);
  await assert.rejects(security.readPdf(huge), /256 MiB/);
  for (const value of ['relative.pdf', '/tmp/a.txt', '/tmp/a\nb.pdf', '/tmp/a\0.pdf', {}]) {
    assert.throws(() => security.validatePath(value));
  }
});

test.skipIf(process.platform === 'win32')('final-component symlink replacement is rejected when supported', async t => {
  const directory = await workspace(t);
  const target = path.join(directory, 'target.pdf');
  const link = path.join(directory, 'link.pdf');
  await fs.writeFile(target, '%PDF-1.7\n%%EOF');
  await fs.symlink(target, link);
  assert.equal(await security.resolvePdf(link), await fs.realpath(target));
  await assert.rejects(security.readPdf(link));
});

test('settings sanitization drops corrupt entries, deduplicates and bounds recents', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: randomUUID(), path: localPdf(`file-${i}`), lastOpened: i }));
  const sanitized = sanitizeSettings({ version: 1, recents: [
    {}, { ...entries[0], path: 'relative.pdf' }, ...entries, entries[0],
    { id: randomUUID(), path: entries[1].path, lastOpened: 50 },
  ] });
  assert.equal(sanitized.recents.length, 20);
  assert.equal(sanitized.recents[0].lastOpened, 29);
  assert.deepEqual(sanitizeSettings({ version: 2, recents: entries }), { version: 1, hasLaunched: false, recents: [] });
  assert.equal(sanitizeSettings({ version: 1, recents: [{ ...entries[0], position: { bad: true } }] }).recents[0].position, undefined);
});

test('missing, corrupt and oversized settings recover without crashing', async t => {
  const directory = await workspace(t);
  const file = path.join(directory, 'settings.json');
  const warnings: string[] = [];
  const store = new SettingsStore(file, { warn: (message: string) => warnings.push(message) });
  await store.load();
  assert.deepEqual(store.recent(), []);
  await fs.writeFile(file, '{broken');
  await store.load();
  assert.deepEqual(store.recent(), []);
  await fs.truncate(file, security.MAX_SETTINGS_BYTES + 1);
  await store.load();
  assert.deepEqual(store.recent(), []);
  assert.equal(warnings.length, 2);
  await store.remember(localPdf('recovery'));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).recents.length, 1);
});

test.skipIf(process.platform === 'win32')('FIFO settings cannot hang startup, including through a symlink', async t => {
  const directory = await workspace(t);
  const fifo = path.join(directory, 'settings.pipe');
  execFileSync('mkfifo', [fifo]);
  const link = path.join(directory, 'settings.json');
  await fs.symlink(fifo, link);
  for (const file of [fifo, link]) {
    // Isolate the read: a blocking FIFO open cannot be cancelled by a test timeout.
    const child = spawnSync(process.execPath, ['-e', `
      const { SettingsStore } = require(${JSON.stringify(require.resolve('../electron/settings.cjs'))});
      const store = new SettingsStore(process.argv[1], { warn: () => {} });
      store.load().then(() => console.log(JSON.stringify(store.recent())));
    `, file], { timeout: 2000, encoding: 'utf8' });
    assert.equal(child.error, undefined, `Settings load did not finish: ${child.error?.message}`);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), '[]');
  }
});

test('atomic settings writes replace complete JSON and leave no temporary files', async t => {
  const directory = await workspace(t);
  const file = path.join(directory, 'settings.json');
  await atomicWrite(file, { version: 1, recents: [] });
  await atomicWrite(file, { version: 1, recents: [{ id: 'complete' }] });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { version: 1, recents: [{ id: 'complete' }] });
  assert.deepEqual(await fs.readdir(directory), ['settings.json']);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('settings serialize concurrent updates, persist positions and expose no paths', async t => {
  const directory = await workspace(t);
  const file = path.join(directory, 'settings.json');
  let writing = 0;
  const store = new SettingsStore(file, { write: async (target: string, state: unknown) => {
    assert.equal(writing++, 0);
    try { await atomicWrite(target, state); } finally { writing--; }
  } });
  await store.load();
  const entry = await store.remember(localPdf('first'));
  await Promise.all([
    store.savePosition(entry.id, { ...position, page: 2 }),
    store.savePosition(entry.id, { ...position, page: 4 }),
    store.remember(localPdf('second')),
    store.savePosition(entry.id, { ...position, page: 8 }),
  ]);
  await store.flush();
  assert.equal(store.authorized(entry.id).position.page, 8);
  assert.equal('path' in store.recent()[0], false);
  const restored = new SettingsStore(file);
  await restored.load();
  assert.equal(restored.authorized(entry.id).position.page, 8);
  assert.equal((await restored.remember(localPdf('first'))).id, entry.id);
  assert.throws(() => restored.authorized(randomUUID()), /最近打开/);
  await assert.rejects(restored.savePosition(randomUUID(), position), /最近打开/);
  for (let i = 0; i < 21; i++) await restored.remember(localPdf(`bounded-${i}`));
  assert.equal(restored.recent().length, security.MAX_RECENTS);
  assert.throws(() => restored.authorized(entry.id), /最近打开/);
});

test('shutdown flush waits for the final queued position to commit', async t => {
  const directory = await workspace(t);
  const file = path.join(directory, 'settings.json');
  const store = new SettingsStore(file);
  const entry = await store.remember(localPdf('shutdown'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  store.write = async (target: string, state: unknown) => { await gate; await atomicWrite(target, state); };
  const saving = store.savePosition(entry.id, { ...position, page: 9 });
  let flushed = false;
  const flushing = store.flush().then(() => { flushed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(flushed, false);
  assert.equal(store.authorized(entry.id).position, undefined);
  release();
  await flushing;
  await saving;
  assert.equal(store.authorized(entry.id).position.page, 9);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).recents[0].position.page, 9);
});

test('failed writes do not poison the queue or mutate committed state', async t => {
  const directory = await workspace(t);
  let fails = true;
  const store = new SettingsStore(path.join(directory, 'settings.json'), {
    warn: () => {}, write: async (file: string, value: unknown) => {
      if (fails) throw new Error('Disk full');
      await atomicWrite(file, value);
    },
  });
  await assert.rejects(store.remember(localPdf('failure')), /无法保存/);
  assert.equal(store.recent().length, 0);
  fails = false;
  await store.remember(localPdf('success'));
  assert.equal(store.recent().length, 1);
});

test('the settings write queue is bounded', async t => {
  const directory = await workspace(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = new SettingsStore(path.join(directory, 'settings.json'), { write: () => gate });
  const pending = Array.from({ length: 32 }, (_, i) => store.remember(localPdf(`queued-${i}`)));
  await assert.rejects(store.remember(localPdf('overload')), /频繁/);
  release();
  await Promise.all(pending);
  assert.equal(store.recent().length, 20);
});
