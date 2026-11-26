import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

function extractHtmlBundleAssets(html: string): string[] {
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

function injectSwPrecache(
  distDir: string,
  htmlRelPath: string,
  swRelPath: string,
  placeholder: string
): void {
  const htmlPath = path.resolve(distDir, htmlRelPath);
  const swPath = path.resolve(distDir, swRelPath);
  if (!fs.existsSync(htmlPath) || !fs.existsSync(swPath)) {
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const precacheAssets = extractHtmlBundleAssets(html);
  const swContent = fs.readFileSync(swPath, 'utf8');
  if (swContent.includes(placeholder)) {
    const updatedSw = swContent.replace(placeholder, JSON.stringify(precacheAssets));
    fs.writeFileSync(swPath, updatedSw, 'utf8');
  }
}

function dualIsolatedPwaPlugin(): Plugin {
  const attachDualPwaRouting = (
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

      if (/\.webmanifest$/i.test(pathname)) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }

      if (/\/autoservicio$/i.test(pathname)) {
        res.statusCode = 302;
        res.setHeader('Location', `${pathname}/${search}`);
        res.end();
        return;
      }

      if (/\/autoservicio\/$/i.test(pathname)) {
        req.url = `/autoservicio/index.html${search}`;
      }

      if (/\/pos$/i.test(pathname)) {
        res.statusCode = 302;
        res.setHeader('Location', `${pathname}/${search}`);
        res.end();
        return;
      }

      if (/\/pos\/$/i.test(pathname)) {
        req.url = `/pos/index.html${search}`;
      }

      if (/\/admin\/pagos\/?$/i.test(pathname)) {
        const base = pathname.replace(/\/admin\/pagos\/?$/i, '');
        const params = new URLSearchParams(search);
        params.set('tab', 'datos_pago');
        res.statusCode = 302;
        res.setHeader('Location', `${base}/pos/?${params.toString()}`);
        res.end();
        return;
      }

      next();
    });
  };

  return {
    name: 'dual-isolated-pwa-plugin',
    configureServer(server) {
      attachDualPwaRouting(server.middlewares);
    },
    configurePreviewServer(server) {
      attachDualPwaRouting(server.middlewares);
    },
    closeBundle(error?: Error): void {
      if (error) {
        return;
      }
      const distDir = path.resolve(__dirname, 'dist');
      injectSwPrecache(
        distDir,
        'pos/index.html',
        'pos/sw-pos.js',
        '/* @__POS_PRECACHE__ */ []'
      );
      injectSwPrecache(
        distDir,
        'autoservicio/index.html',
        'autoservicio/sw.js',
        '/* @__AUTOSERVICIO_PRECACHE__ */ []'
      );
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      dualIsolatedPwaPlugin(),
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
          pos: path.resolve(__dirname, 'pos/index.html'),
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
