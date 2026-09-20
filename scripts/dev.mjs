import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
let server;
let child;
let stopping;
async function shutdown(code = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else child.kill('SIGKILL');
      }, 3000);
      killTimer.unref();
      await exited;
      clearTimeout(killTimer);
    }
    await server?.close();
    process.exitCode = code;
  })();
  return stopping;
}
process.once('SIGINT', () => { void shutdown(130); });
process.once('SIGTERM', () => { void shutdown(143); });
try {
  // Resolve the binary first so a missing Electron install does not leave Vite running.
  const electron = require('electron');
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1' } });
  await server.listen();
  if (stopping) await server.close();
  else {
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port');
    const url = `http://127.0.0.1:${address.port}/`;
    console.log(`Vite ready at ${url}`);
    const env = { ...process.env, PANO_DEV_SERVER_URL: url };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
    child.once('error', error => {
      console.error('Failed to start Electron:', error.message);
      child = undefined;
      void shutdown(1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) void shutdown(code ?? (signal ? 1 : 0));
    });
  }
} catch (error) {
  console.error('Development startup failed:', error.message);
  await shutdown(1);
}
