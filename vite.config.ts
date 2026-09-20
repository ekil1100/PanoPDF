import { defineConfig, type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { cp, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { contentSecurityPolicy } = require('./electron/security.cjs') as {
  contentSecurityPolicy: (devUrl?: string) => string;
};
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const resourceDirectories = ['cmaps', 'standard_fonts', 'wasm', 'images'] as const;
const resourceSource = (directory: string) => path.join(pdfRoot, ...(directory === 'images' ? ['web', 'images'] : [directory]));

function pdfResources(): Plugin {
  let outputDirectory = path.join(projectRoot, 'dist');
  let building = false;
  return {
    name: 'local-pdfjs-resources',
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
      building = config.command === 'build';
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const address = server.httpServer?.address();
        const port = address && typeof address !== 'string' ? address.port : 5173;
        response.setHeader('Content-Security-Policy', contentSecurityPolicy(`http://127.0.0.1:${port}/`));
        response.setHeader('X-Content-Type-Options', 'nosniff');
        let pathname: string;
        try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname); }
        catch { response.statusCode = 400; response.end(); return; }
        if (!pathname.startsWith('/pdfjs/')) { next(); return; }
        if (!['GET', 'HEAD'].includes(request.method || '')) { response.statusCode = 405; response.end(); return; }
        const parts = pathname.slice('/pdfjs/'.length).split('/');
        if (pathname.length > 4096 || !resourceDirectories.includes(parts[0] as typeof resourceDirectories[number])
            || parts.some(part => !part || part.startsWith('.') || /[\\\x00-\x1f\x7f]/.test(part))) {
          response.statusCode = 403; response.end(); return;
        }
        try {
          const file = await realpath(path.join(resourceSource(parts[0]!), ...parts.slice(1)));
          const relative = path.relative(pdfRoot, file);
          if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid resource path');
          const info = await stat(file);
          if (!info.isFile()) throw new Error('Not a file');
          const types: Record<string, string> = {
            '.wasm': 'application/wasm', '.js': 'text/javascript', '.ttf': 'font/ttf', '.otf': 'font/otf',
            '.svg': 'image/svg+xml', '.png': 'image/png',
          };
          response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
          response.setHeader('Content-Length', info.size);
          if (request.method === 'HEAD') { response.end(); return; }
          const stream = createReadStream(file);
          stream.on('error', () => response.destroy());
          response.on('close', () => stream.destroy());
          stream.pipe(response);
        } catch { response.statusCode = 404; response.end(); }
      });
    },
    async closeBundle() {
      if (!building) return;
      const destination = path.join(outputDirectory, 'pdfjs');
      await mkdir(destination, { recursive: true });
      await Promise.all(resourceDirectories.map(directory => cp(
        resourceSource(directory), path.join(destination, directory), { recursive: true },
      )));
    },
  };
}

export default defineConfig({
  root: projectRoot,
  base: './',
  plugins: [pdfResources()],
  server: { host: '127.0.0.1', fs: { strict: true } },
  preview: { host: '127.0.0.1', headers: { 'Content-Security-Policy': contentSecurityPolicy() } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
