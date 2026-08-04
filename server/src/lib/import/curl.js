/**
 * Parse a `curl` command into a request.
 *
 * Aimed at what people actually paste: the "Copy as cURL" output of Chrome,
 * Firefox and Safari, plus hand-written commands. Flags that only affect how
 * curl itself behaves (`--compressed`, `-s`, `-v`) are recognised and skipped
 * rather than treated as a URL.
 */

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Flags that take no value. */
const BARE_FLAGS = new Set([
  '-s', '--silent', '-v', '--verbose', '-i', '--include', '-#', '--progress-bar',
  '--compressed', '-L', '--location', '-k', '--insecure', '-g', '--globoff',
  '-f', '--fail', '-S', '--show-error', '--no-buffer', '-N', '--http1.1',
  '--http2', '--http2-prior-knowledge', '-4', '--ipv4', '-6', '--ipv6',
  '-G', '--get', '-J', '--remote-header-name', '-O', '--remote-name',
  '--raw', '--tlsv1.2', '--tlsv1.3', '-Z', '--parallel', '--path-as-is',
]);

/** Flags whose value we deliberately drop. */
const IGNORED_WITH_VALUE = new Set([
  '-o', '--output', '-w', '--write-out', '--max-time', '-m', '--connect-timeout',
  '--retry', '-A', '--user-agent', '--proxy', '-x', '--cert', '--key', '--cacert',
  '--resolve', '--interface', '--limit-rate', '-e', '--referer',
]);

/**
 * Split a shell command into argv, honouring quotes, backslash escapes and
 * line continuations. Handles `$'...'` (bash ANSI-C quoting, which Chrome emits
 * when a header contains a newline) and Windows `^` continuations.
 */
export function tokenize(input) {
  const text = String(input ?? '')
    .replace(/\\\r?\n/g, ' ') // POSIX line continuation
    .replace(/\^\r?\n/g, ' ') // cmd.exe continuation
    .replace(/`\r?\n/g, ' '); // PowerShell continuation

  const tokens = [];
  let current = '';
  let started = false;
  let quote = null; // null | "'" | '"' | "$'"

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote === null) {
      if (/\s/.test(char)) {
        if (started) {
          tokens.push(current);
          current = '';
          started = false;
        }
        continue;
      }
      if (char === '$' && text[i + 1] === "'") {
        quote = "$'";
        started = true;
        i += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        started = true;
        continue;
      }
      if (char === '\\' && text[i + 1] !== undefined) {
        current += text[i + 1];
        started = true;
        i += 1;
        continue;
      }
      current += char;
      started = true;
      continue;
    }

    // Inside quotes.
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === "$'") {
      if (char === "'") {
        quote = null;
        continue;
      }
      if (char === '\\') {
        const next = text[i + 1];
        current +=
          next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : (next ?? '');
        i += 1;
        continue;
      }
      current += char;
      continue;
    }

    // Double quotes: only a few escapes are special.
    if (char === '"') {
      quote = null;
      continue;
    }
    if (char === '\\' && ['"', '\\', '$', '`', '\n'].includes(text[i + 1])) {
      current += text[i + 1];
      i += 1;
      continue;
    }
    current += char;
  }

  if (started) tokens.push(current);
  return tokens;
}

function splitOnce(text, separator) {
  const index = text.indexOf(separator);
  if (index === -1) return [text, null];
  return [text.slice(0, index), text.slice(index + separator.length)];
}

function rows(pairs) {
  return pairs.map(([key, value]) => ({ key, value: value ?? '', enabled: true }));
}

/** Is this token a flag, as opposed to the URL or a flag's value? */
function isFlag(token) {
  return token.startsWith('-') && token !== '-';
}

/**
 * @returns {{ ok: true, request: object, warnings: string[] } | { ok: false, error: string }}
 */
export function parseCurl(input) {
  const tokens = tokenize(input);
  if (!tokens.length) return { ok: false, error: 'Nothing to parse' };

  // Tolerate a leading `curl` (or a shell prompt in front of it).
  const start = tokens.findIndex((token) => token === 'curl' || token.endsWith('/curl'));
  const argv = start === -1 ? tokens : tokens.slice(start + 1);
  if (start === -1 && !tokens.some(isFlag) && !/^https?:/i.test(tokens[0] ?? '')) {
    return { ok: false, error: 'This does not look like a curl command' };
  }

  const warnings = [];
  const headers = [];
  const urlencoded = [];
  const formdata = [];
  const dataParts = [];
  let method = null;
  let url = '';
  let user = null;
  let forceGet = false;
  let rawIsUrlencoded = false;

  const valueOf = (index, flag) => {
    const token = argv[index + 1];
    if (token === undefined) {
      warnings.push(`${flag} had no value and was skipped`);
      return null;
    }
    return token;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (!isFlag(token)) {
      // Bare word: the URL, unless we already have one.
      if (!url) url = token;
      else warnings.push(`Ignored extra argument "${token}"`);
      continue;
    }

    // `--header=value` and `-HValue` forms.
    let flag = token;
    let inline = null;
    if (flag.startsWith('--') && flag.includes('=')) {
      [flag, inline] = splitOnce(flag, '=');
    } else if (/^-[HdFubXAe]./.test(flag)) {
      inline = flag.slice(2);
      flag = flag.slice(0, 2);
    }

    const take = () => {
      if (inline !== null) return inline;
      const value = valueOf(i, flag);
      if (value !== null) i += 1;
      return value;
    };

    if (BARE_FLAGS.has(flag)) {
      if (flag === '-G' || flag === '--get') forceGet = true;
      continue;
    }

    if (IGNORED_WITH_VALUE.has(flag)) {
      take();
      continue;
    }

    switch (flag) {
      case '-X':
      case '--request': {
        const value = take();
        if (value) method = value.toUpperCase();
        break;
      }
      case '--url': {
        const value = take();
        if (value) url = value;
        break;
      }
      case '-H':
      case '--header': {
        const value = take();
        if (value === null) break;
        const [name, headerValue] = splitOnce(value, ':');
        if (headerValue === null) {
          // `-H "Accept;"` removes a header in curl; nothing to import.
          warnings.push(`Ignored header without a value: "${value}"`);
          break;
        }
        headers.push([name.trim(), headerValue.trim()]);
        break;
      }
      case '-b':
      case '--cookie': {
        const value = take();
        if (value) headers.push(['Cookie', value]);
        break;
      }
      case '-u':
      case '--user': {
        const value = take();
        if (value) user = value;
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii': {
        const value = take();
        if (value !== null) {
          if (value.startsWith('@')) {
            warnings.push(`${flag} @file is not supported — the body was left empty`);
          } else {
            dataParts.push(value);
          }
        }
        break;
      }
      case '--data-urlencode': {
        const value = take();
        if (value !== null) {
          rawIsUrlencoded = true;
          const [name, fieldValue] = splitOnce(value, '=');
          if (fieldValue === null) urlencoded.push([value, '']);
          else urlencoded.push([name, fieldValue]);
        }
        break;
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const value = take();
        if (value === null) break;
        const [name, fieldValue] = splitOnce(value, '=');
        if ((fieldValue ?? '').startsWith('@') || (fieldValue ?? '').startsWith('<')) {
          warnings.push(`Form field "${name}" points at a file — attach it by hand`);
          formdata.push([name, '']);
        } else {
          formdata.push([name, fieldValue ?? '']);
        }
        break;
      }
      default:
        warnings.push(`Ignored unknown flag "${flag}"`);
        // A value may follow an unrecognised long flag; leave it to be read as
        // the URL only if it looks like one.
        if (inline === null && argv[i + 1] && !isFlag(argv[i + 1]) && !/^https?:/i.test(argv[i + 1])) {
          i += 1;
        }
    }
  }

  if (!url) return { ok: false, error: 'No URL found in the command' };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Could not read the URL "${url}"` };
  }

  const params = [...parsed.searchParams.entries()].map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));
  parsed.search = '';

  const raw = dataParts.join('&');
  const contentType = headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';

  let body = { mode: 'none', language: 'json', raw: '', urlencoded: [], formdata: [] };
  if (formdata.length) {
    body = { ...body, mode: 'formdata', formdata: rows(formdata) };
  } else if (urlencoded.length) {
    body = { ...body, mode: 'urlencoded', urlencoded: rows(urlencoded) };
  } else if (raw) {
    const looksForm =
      rawIsUrlencoded ||
      contentType.includes('x-www-form-urlencoded') ||
      (!contentType && /^[^={}[\]]+=[^&]*(&[^=]+=[^&]*)*$/.test(raw));
    if (looksForm) {
      const pairs = [...new URLSearchParams(raw).entries()];
      body = { ...body, mode: 'urlencoded', urlencoded: rows(pairs) };
    } else {
      const language = contentType.includes('xml')
        ? 'xml'
        : contentType.includes('html')
          ? 'html'
          : contentType.includes('json') || /^\s*[[{]/.test(raw)
            ? 'json'
            : 'text';
      body = { ...body, mode: 'raw', raw, language };
    }
  }

  // curl implies POST when there is a body, unless -G moves it to the query.
  if (forceGet) {
    if (body.mode === 'urlencoded') {
      params.push(...body.urlencoded.map(({ key, value }) => ({ key, value, enabled: true })));
    } else if (body.mode === 'raw') {
      for (const [key, value] of new URLSearchParams(body.raw).entries()) {
        params.push({ key, value, enabled: true });
      }
    }
    body = { mode: 'none', language: 'json', raw: '', urlencoded: [], formdata: [] };
  }

  if (!method) method = body.mode === 'none' ? 'GET' : 'POST';
  if (!METHODS.has(method)) {
    warnings.push(`Unusual method "${method}" kept as-is`);
  }

  let auth = { type: 'none' };
  if (user) {
    const [username, password] = splitOnce(user, ':');
    auth = { type: 'basic', username, password: password ?? '' };
    // The Authorization header would otherwise be sent twice.
  }

  return {
    ok: true,
    warnings,
    request: {
      name: `${method} ${parsed.pathname === '/' ? parsed.hostname : parsed.pathname}`,
      method,
      url: parsed.toString(),
      params,
      headers: rows(headers),
      auth,
      body,
      scripts: { preRequest: '', postResponse: '' },
    },
  };
}
