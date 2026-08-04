import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';

import { jobsRouter } from './routes/jobs.js';
import { historyRouter, sendRouter } from './routes/send.js';
import { normaliseCollection, normaliseEnvironment, resourceRouter } from './routes/resources.js';
import { toolsRouter } from './routes/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'postguy', version: '0.1.0' }));

app.use('/api', sendRouter);
app.use('/api', historyRouter);
app.use('/api', toolsRouter);
app.use('/api', jobsRouter);
app.use('/api', resourceRouter('collections', { normalise: normaliseCollection }));
app.use('/api', resourceRouter('environments', { normalise: normaliseEnvironment }));

// Serve the built SPA when it exists, so `npm start` gives a single-port app.
const clientDist = join(here, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error('[postguy]', err);
  res.status(500).json({ error: err.message ?? 'Internal error' });
});

app.listen(port, () => {
  console.log(`postguy server listening on http://localhost:${port}`);
});
