export type PwaAppKind = 'pos' | 'autoservicio';

export interface PwaRouteTargetConfig {
  app: PwaAppKind;
  id: string;
  manifestHref: string;
  startUrl: string;
  scope: string;
  swScript: string;
  swScope: string;
}

/**
 * Resolves the active PWA manifest and isolated Service Worker metadata
 * strictly from the current pathname so POS (/pos/) and Autoservicio (/autoservicio/)
 * never share an id, start_url, scope, or manifest link.
 */
export function resolvePwaTargetForPathname(pathname: string): PwaRouteTargetConfig | null {
  const clean = (pathname || '').trim().toLowerCase();

  if (/\/autoservicio(\/|\/index\.html)?$/i.test(clean)) {
    return {
      app: 'autoservicio',
      id: '/autoservicio/',
      manifestHref: '/manifest-autoservicio.webmanifest',
      startUrl: '/autoservicio/',
      scope: '/autoservicio/',
      swScript: './sw.js',
      swScope: './',
    };
  }

  if (/\/pos(\/|\/index\.html)?$/i.test(clean)) {
    return {
      app: 'pos',
      id: '/pos/',
      manifestHref: '/manifest-pos.webmanifest',
      startUrl: '/pos/',
      scope: '/pos/',
      swScript: './sw-pos.js',
      swScope: './',
    };
  }

  return null;
}

/**
 * Dynamically injects or updates the single <link rel="manifest"> tag in <head>
 * for the active route (/pos/ vs /autoservicio/).
 */
export function syncDynamicManifestLink(doc: Document, pathname: string): PwaRouteTargetConfig | null {
  const target = resolvePwaTargetForPathname(pathname);
  const head = doc.head;
  if (!head) return target;

  const existing = Array.from(head.querySelectorAll('link[rel="manifest"]'));
  if (!target) {
    for (const el of existing) {
      el.remove();
    }
    return null;
  }

  let link = existing[0] as HTMLLinkElement | undefined;
  for (let i = 1; i < existing.length; i += 1) {
    existing[i]?.remove();
  }

  if (!link) {
    link = doc.createElement('link');
    link.rel = 'manifest';
    head.appendChild(link);
  }
  link.id = 'app-pwa-manifest';
  link.crossOrigin = 'use-credentials';
  link.setAttribute('href', target.manifestHref);
  return target;
}
