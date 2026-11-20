/**
 * Resolves local public asset paths against Vite's configured BASE_URL
 * so assets load cleanly on root domains AND subpath deployments (e.g. GitHub Pages).
 */
export function resolveAssetUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = pathOrUrl.replace(/^\/+/, '');
  return `${normalizedBase}${cleanPath}`;
}
