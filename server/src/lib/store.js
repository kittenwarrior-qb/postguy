import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

const defaults = {
  collections: [],
  environments: [],
  history: [],
  cookies: [],
  settings: {},
};

/**
 * Tiny JSON-file store. Reads are cached in memory; writes are serialized per
 * file so concurrent requests can't interleave and truncate each other.
 */
const cache = new Map();
const writeQueue = new Map();

function fileFor(name) {
  return join(dataDir, `${name}.json`);
}

export async function read(name) {
  if (cache.has(name)) return cache.get(name);
  let value = defaults[name];
  try {
    value = JSON.parse(await readFile(fileFor(name), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  cache.set(name, value);
  return value;
}

export async function write(name, value) {
  cache.set(name, value);
  const prev = writeQueue.get(name) ?? Promise.resolve();
  const next = prev.then(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(fileFor(name), JSON.stringify(value, null, 2));
  });
  writeQueue.set(
    name,
    next.catch(() => {}),
  );
  return next;
}

export async function update(name, fn) {
  const value = await read(name);
  const nextValue = fn(value);
  await write(name, nextValue);
  return nextValue;
}
