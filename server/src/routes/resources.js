import { Router } from 'express';
import { nanoid } from 'nanoid';

import { read, update } from '../lib/store.js';

/**
 * CRUD router shared by collections and environments — both are just named
 * documents in the JSON store.
 */
export function resourceRouter(name, { normalise = (item) => item } = {}) {
  const router = Router();
  const base = `/${name}`;

  router.get(base, async (_req, res) => {
    res.json(await read(name));
  });

  router.get(`${base}/:id`, async (req, res) => {
    const items = await read(name);
    const item = items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  });

  router.post(base, async (req, res) => {
    const item = normalise({
      ...req.body,
      id: req.body?.id ?? nanoid(10),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await update(name, (items) => [...items, item]);
    res.status(201).json(item);
  });

  router.put(`${base}/:id`, async (req, res) => {
    const items = await read(name);
    const index = items.findIndex((i) => i.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    const item = normalise({
      ...items[index],
      ...req.body,
      id: req.params.id,
      updatedAt: Date.now(),
    });
    await update(name, (list) => list.map((i, idx) => (idx === index ? item : i)));
    res.json(item);
  });

  router.delete(`${base}/:id`, async (req, res) => {
    const items = await read(name);
    if (!items.some((i) => i.id === req.params.id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    await update(name, (list) => list.filter((i) => i.id !== req.params.id));
    res.json({ ok: true });
  });

  return router;
}

/** Make sure every request inside a collection has a stable id. */
export function normaliseCollection(collection) {
  return {
    ...collection,
    name: collection.name?.trim() || 'Untitled collection',
    requests: (collection.requests ?? []).map((request) => ({
      ...request,
      id: request.id ?? nanoid(10),
      name: request.name?.trim() || 'Untitled request',
    })),
  };
}

export function normaliseEnvironment(environment) {
  return {
    ...environment,
    name: environment.name?.trim() || 'Untitled environment',
    values: environment.values ?? {},
  };
}
