import { read, update } from './store.js';

/**
 * A small persistent cookie jar. This is what makes "log in once, then keep
 * requesting" work: the login response's Set-Cookie is stored, and every later
 * request to a matching host sends it back automatically.
 */

function parseSetCookie(header, requestUrl) {
  const [pair, ...attrParts] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq === -1) return null;

  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  const url = new URL(requestUrl);
  const cookie = {
    name,
    value,
    domain: url.hostname,
    path: '/',
    secure: false,
    httpOnly: false,
    hostOnly: true,
    expires: null,
    sameSite: null,
  };

  for (const part of attrParts) {
    const idx = part.indexOf('=');
    const key = (idx === -1 ? part : part.slice(0, idx)).trim().toLowerCase();
    const val = idx === -1 ? '' : part.slice(idx + 1).trim();

    if (key === 'domain' && val) {
      cookie.domain = val.replace(/^\./, '').toLowerCase();
      cookie.hostOnly = false;
    } else if (key === 'path' && val) {
      cookie.path = val;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'samesite') {
      cookie.sameSite = val;
    } else if (key === 'expires' && val) {
      const parsed = Date.parse(val);
      if (!Number.isNaN(parsed)) cookie.expires = parsed;
    } else if (key === 'max-age' && val !== '') {
      const seconds = Number(val);
      if (!Number.isNaN(seconds)) cookie.expires = Date.now() + seconds * 1000;
    }
  }

  return cookie;
}

function domainMatches(cookie, hostname) {
  const host = hostname.toLowerCase();
  const domain = cookie.domain.toLowerCase();
  if (host === domain) return true;
  if (cookie.hostOnly) return false;
  return host.endsWith(`.${domain}`);
}

function pathMatches(cookiePath, requestPath) {
  if (cookiePath === requestPath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function isExpired(cookie, now = Date.now()) {
  return cookie.expires !== null && cookie.expires <= now;
}

/** Same identity rule the RFC uses: name + domain + path. */
function sameCookie(a, b) {
  return a.name === b.name && a.domain === b.domain && a.path === b.path;
}

export async function getCookies() {
  const jar = await read('cookies');
  const now = Date.now();
  return jar.filter((cookie) => !isExpired(cookie, now));
}

/** Build the `Cookie` header value for a request URL. */
export async function cookieHeaderFor(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return '';
  }
  const isSecure = url.protocol === 'https:';
  const jar = await getCookies();

  const matching = jar.filter(
    (cookie) =>
      domainMatches(cookie, url.hostname) &&
      pathMatches(cookie.path, url.pathname || '/') &&
      (!cookie.secure || isSecure),
  );

  // Longer paths first, as required when several cookies share a name.
  matching.sort((a, b) => b.path.length - a.path.length);
  return matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Store the Set-Cookie headers from a response.
 * Returns the cookies that were written, so the UI can show them.
 */
export async function storeSetCookies(setCookieHeaders, requestUrl) {
  if (!setCookieHeaders?.length) return [];

  const parsed = setCookieHeaders
    .map((header) => parseSetCookie(header, requestUrl))
    .filter(Boolean);
  if (!parsed.length) return [];

  await update('cookies', (jar) => {
    let next = jar.filter((cookie) => !isExpired(cookie));
    for (const cookie of parsed) {
      next = next.filter((existing) => !sameCookie(existing, cookie));
      // A cookie with an expiry in the past is a delete instruction.
      if (!isExpired(cookie)) next.push(cookie);
    }
    return next;
  });

  return parsed;
}

export async function setCookie(cookie) {
  await update('cookies', (jar) => [
    ...jar.filter((existing) => !sameCookie(existing, cookie)),
    { path: '/', secure: false, httpOnly: false, hostOnly: true, expires: null, ...cookie },
  ]);
}

export async function clearCookies(domain) {
  await update('cookies', (jar) =>
    domain ? jar.filter((cookie) => cookie.domain !== domain) : [],
  );
}
