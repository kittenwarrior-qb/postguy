import { Router } from 'express';
import { nanoid } from 'nanoid';

import { execute } from '../lib/execute.js';
import { read, update } from '../lib/store.js';

const HISTORY_LIMIT = 200;

export const sendRouter = Router();

sendRouter.post('/send', async (req, res) => {
  const { request, environment = {}, globals = {}, saveHistory = true } = req.body ?? {};
  if (!request || typeof request !== 'object') {
    return res.status(400).json({ error: 'Missing "request" in body' });
  }

  const result = await execute({ request, environment, globals });

  if (saveHistory && !result.skipped) {
    const entry = {
      id: nanoid(10),
      at: Date.now(),
      name: request.name ?? '',
      method: result.resolvedRequest?.method ?? request.method,
      url: result.resolvedRequest?.url ?? request.url,
      status: result.response?.status ?? null,
      error: result.response?.error ?? null,
      time: result.response?.time ?? null,
      size: result.response?.size ?? null,
      testsPassed: result.tests.filter((t) => t.passed).length,
      testsFailed: result.tests.filter((t) => !t.passed).length,
      request,
    };
    await update('history', (list) => [entry, ...list].slice(0, HISTORY_LIMIT));
    result.historyId = entry.id;
  }

  res.json(result);
});

/** Run every request in a collection in order, sharing one environment. */
sendRouter.post('/run', async (req, res) => {
  const { collectionId, environment = {}, globals = {} } = req.body ?? {};
  const collections = await read('collections');
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return res.status(404).json({ error: 'Collection not found' });

  let env = { ...environment };
  let glob = { ...globals };
  const results = [];

  for (const request of collection.requests ?? []) {
    const result = await execute({ request, environment: env, globals: glob });
    env = result.environment;
    glob = result.globals;
    results.push({
      requestId: request.id,
      name: request.name,
      method: request.method,
      url: result.resolvedRequest?.url ?? request.url,
      skipped: result.skipped,
      status: result.response?.status ?? null,
      error: result.response?.error ?? null,
      time: result.response?.time ?? null,
      tests: result.tests,
      logs: result.logs,
      scriptErrors: result.scriptErrors,
    });
  }

  const allTests = results.flatMap((r) => r.tests);
  res.json({
    collectionId,
    collectionName: collection.name,
    results,
    environment: env,
    globals: glob,
    summary: {
      requests: results.length,
      passed: allTests.filter((t) => t.passed).length,
      failed: allTests.filter((t) => !t.passed).length,
      totalTime: results.reduce((sum, r) => sum + (r.time ?? 0), 0),
    },
  });
});

export const historyRouter = Router();

historyRouter.get('/history', async (_req, res) => {
  res.json(await read('history'));
});

historyRouter.delete('/history', async (_req, res) => {
  await update('history', () => []);
  res.json({ ok: true });
});

historyRouter.delete('/history/:id', async (req, res) => {
  await update('history', (list) => list.filter((item) => item.id !== req.params.id));
  res.json({ ok: true });
});
