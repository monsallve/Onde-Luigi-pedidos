const SAFE_ORDER_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export interface UrlPartsLike {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Checks whether the given pathname points strictly to the isolated Autoservicio PWA boundary.
 */
export function isInsideAutoservicioPath(pathname: string): boolean {
  const clean = (pathname || '').trim().toLowerCase();
  return /\/autoservicio(\/|\/index\.html)?$/i.test(clean);
}

/**
 * Checks whether the given pathname points strictly to the isolated POS PWA boundary.
 */
export function isInsidePosPath(pathname: string): boolean {
  const clean = (pathname || '').trim().toLowerCase();
  return /\/pos(\/|\/index\.html)?$/i.test(clean);
}

/**
 * Resolves the canonical isolated `/pos/` base path, preserving any host subpath.
 */
export function resolvePosBasePath(pathname: string): string {
  const clean = pathname || '/';
  const match = clean.match(/^(.*\/pos)(?:\/index\.html|\/)?$/i);
  if (match && match[1]) {
    return `${match[1]}/`;
  }
  let dir = clean.endsWith('/') ? clean : clean.slice(0, clean.lastIndexOf('/') + 1);
  if (/\/admin\/?$/i.test(dir)) {
    dir = dir.replace(/\/admin\/?$/i, '/');
  }
  if (/\/autoservicio\/?$/i.test(dir)) {
    dir = dir.replace(/\/autoservicio\/?$/i, '/');
  }
  return `${dir}pos/`;
}

/**
 * Detects whether a request arriving at the POS root should immediately redirect
 * into the isolated `/autoservicio/` PWA boundary before loading POS code.
 */
export function shouldPosRedirectToAutoservicio(urlLike: UrlPartsLike): boolean {
  const pathname = (urlLike.pathname || '').toLowerCase();
  const searchParams = new URLSearchParams(urlLike.search || '');
  const hash = urlLike.hash || '';
  const hashLower = hash.toLowerCase();
  const hashQueryIdx = hash.indexOf('?');
  const hashParams =
    hashQueryIdx >= 0 ? new URLSearchParams(hash.slice(hashQueryIdx + 1)) : new URLSearchParams();

  return (
    searchParams.get('autoservicio') === '1' ||
    hashParams.get('autoservicio') === '1' ||
    isInsideAutoservicioPath(pathname) ||
    hashLower.startsWith('#/autoservicio')
  );
}

/**
 * Inside the isolated Autoservicio PWA, detects any attempt to navigate to POS,
 * admin, login, or internal tab routes so the customer can be snapped back cleanly.
 */
export function isDisallowedPosOrAdminNavigation(urlLike: UrlPartsLike): boolean {
  const pathname = (urlLike.pathname || '').toLowerCase();
  if (!/\/autoservicio(\/|\/index\.html)$/i.test(pathname)) {
    return true;
  }

  const searchParams = new URLSearchParams(urlLike.search || '');
  if (searchParams.has('tab')) {
    return true;
  }

  const hash = (urlLike.hash || '').trim().toLowerCase();
  if (hash && hash !== '#' && hash !== '#/' && !hash.startsWith('#/autoservicio')) {
    return true;
  }

  return false;
}

/**
 * Extracts and validates an optional customer order tracking ID (`?pedido=...`).
 */
export function extractSafeOrderIdFromUrl(
  urlLike: Pick<UrlPartsLike, 'search' | 'hash'>
): string | undefined {
  const searchParams = new URLSearchParams(urlLike.search || '');
  const hash = urlLike.hash || '';
  const hashQueryIdx = hash.indexOf('?');
  const hashParams =
    hashQueryIdx >= 0 ? new URLSearchParams(hash.slice(hashQueryIdx + 1)) : new URLSearchParams();

  const raw = (searchParams.get('pedido') || hashParams.get('pedido') || '').trim();
  if (!raw || !SAFE_ORDER_ID_REGEX.test(raw)) {
    return undefined;
  }
  return raw;
}

/**
 * Resolves the canonical isolated `/autoservicio/` base path, preserving any host subpath
 * (for example `/Onde-Luigi-pedidos/autoservicio/` on subpath deployments).
 */
export function resolveAutoservicioBasePath(pathname: string): string {
  const clean = pathname || '/';
  const match = clean.match(/^(.*\/autoservicio)(?:\/index\.html|\/)?$/i);
  if (match && match[1]) {
    return `${match[1]}/`;
  }
  const dir = clean.endsWith('/') ? clean : clean.slice(0, clean.lastIndexOf('/') + 1);
  if (/\/admin\/?$/i.test(dir)) {
    return `${dir.replace(/\/admin\/?$/i, '')}/autoservicio/`;
  }
  return `${dir}autoservicio/`;
}

/**
 * Produces the canonical, strictly-scoped Autoservicio URL, preserving only `?pedido=...`.
 */
export function buildIsolatedAutoservicioUrl(
  currentHref: string,
  baseAutoservicioPathname?: string
): string {
  const parsed = new URL(currentHref, 'https://ondeluigi.local');
  const orderId = extractSafeOrderIdFromUrl({
    search: parsed.search,
    hash: parsed.hash,
  });

  const targetPath =
    baseAutoservicioPathname && /\/autoservicio\/$/i.test(baseAutoservicioPathname)
      ? baseAutoservicioPathname
      : resolveAutoservicioBasePath(parsed.pathname);

  const nextUrl = new URL(targetPath, parsed.origin);
  if (orderId) {
    nextUrl.searchParams.set('pedido', orderId);
  }
  return `${nextUrl.pathname}${nextUrl.search}`;
}

/**
 * Builds the full shareable public URL for the isolated Autoservicio PWA from any POS screen.
 */
export function buildPublicAutoservicioLink(currentHref: string, orderId?: string): string {
  const parsed = new URL(currentHref, 'https://ondeluigi.local');
  let basePath = parsed.pathname || '/';
  if (/\/admin\/pagos\/?$/i.test(basePath)) {
    basePath = basePath.replace(/\/admin\/pagos\/?$/i, '/');
  } else if (/\/pos(?:\/index\.html|\/)?$/i.test(basePath)) {
    basePath = basePath.replace(/\/pos(?:\/index\.html|\/)?$/i, '/');
  } else if (/\/autoservicio(?:\/index\.html|\/)?$/i.test(basePath)) {
    basePath = basePath.replace(/\/autoservicio(?:\/index\.html|\/)?$/i, '/');
  } else if (!basePath.endsWith('/')) {
    basePath = basePath.slice(0, basePath.lastIndexOf('/') + 1);
  }
  const target = new URL(`${basePath}autoservicio/`, parsed.origin);
  if (orderId && SAFE_ORDER_ID_REGEX.test(orderId.trim())) {
    target.searchParams.set('pedido', orderId.trim());
  }
  return target.toString();
}
