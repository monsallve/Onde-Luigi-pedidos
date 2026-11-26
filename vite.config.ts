import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

function extractAutoservicioHtmlAssets(html: string): string[] {
  const assets = new Set<string>();
  const attrRegex = /\b(?:src|href)=["']([^"']*\/assets\/[^"'?#]+)["']/gi;
  let match: RegExpExecArray | null = attrRegex.exec(html);
  while (match) {
    const rawRef = match[1];
    if (rawRef) {
      assets.add(rawRef);
    }
    match = attrRegex.exec(html);
  }
  return Array.from(assets);
}

function isolatedAutoservicioPwaPlugin(): Plugin {
  const attachAutoservicioRouting = (
    middlewares: {
      use: (
        fn: (
          req: { url?: string },
          res: { statusCode: number; setHeader: (k: string, v: string) => void; end: () => void },
          next: () => void
        ) => void
      ) => void;
    }
  ) => {
    middlewares.use((req, res, next) => {
      const rawUrl = req.url || '/';
      const qIndex = rawUrl.indexOf('?');
      const pathname = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;
      const search = qIndex >= 0 ? rawUrl.slice(qIndex) : '';

      if (/\/autoservicio$/i.test(pathname)) {
        res.statusCode = 302;
        res.setHeader('Location', `${pathname}/${search}`);
        res.end();
        return;
      }

      if (/\/autoservicio\/$/i.test(pathname)) {
        req.url = `/autoservicio/index.html${search}`;
      }

      next();
    });
  };

  return {
    name: 'isolated-autoservicio-pwa',
    configureServer(server) {
      attachAutoservicioRouting(server.middlewares);
    },
    configurePreviewServer(server) {
      attachAutoservicioRouting(server.middlewares);
    },
    closeBundle(error?: Error): void {
      if (error) {
        return;
      }
      const distDir = path.resolve(__dirname, 'dist');
      const autoservicioHtmlPath = path.resolve(distDir, 'autoservicio/index.html');
      const autoservicioSwPath = path.resolve(distDir, 'autoservicio/sw.js');

      if (!fs.existsSync(autoservicioHtmlPath) || !fs.existsSync(autoservicioSwPath)) {
        return;
      }

      const html = fs.readFileSync(autoservicioHtmlPath, 'utf8');
      const precacheAssets = extractAutoservicioHtmlAssets(html);
      const swContent = fs.readFileSync(autoservicioSwPath, 'utf8');
      const placeholder = '/* @__AUTOSERVICIO_PRECACHE__ */ []';

      if (swContent.includes(placeholder)) {
        const updatedSw = swContent.replace(
          placeholder,
          JSON.stringify(precacheAssets)
        );
        fs.writeFileSync(autoservicioSwPath, updatedSw, 'utf8');
      }
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      isolatedAutoservicioPwaPlugin(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          autoservicio: path.resolve(__dirname, 'autoservicio/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      allowedHosts: true as const,
      port: 3000,
      host: '0.0.0.0',
    },
  };
});
