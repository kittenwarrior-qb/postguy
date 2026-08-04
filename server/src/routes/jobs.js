import { Router } from 'express';

import { deleteJob, getJob, listJobs, snapshot, startJob, stopJob } from '../lib/jobs.js';

export const jobsRouter = Router();

const HEARTBEAT_MS = 20_000;

jobsRouter.get('/jobs', (_req, res) => {
  res.json(listJobs());
});

jobsRouter.post('/jobs', (req, res) => {
  const { code } = req.body ?? {};
  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: 'The script is empty' });
  }
  const job = startJob(req.body);
  res.status(201).json(snapshot(job));
});

jobsRouter.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(snapshot(job));
});

jobsRouter.delete('/jobs/:id', (req, res) => {
  const stopped = stopJob(req.params.id);
  if (req.query.remove === 'true') deleteJob(req.params.id);
  res.json({ ok: true, stopped });
});

/**
 * Live output over Server-Sent Events. The first message carries the whole
 * job so a browser that attaches late — or reattaches after a refresh — sees
 * everything that already happened, then follows along.
 */
jobsRouter.get('/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const write = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  write('init', snapshot(job));

  const onEvent = ({ type, data }) => write(type, data);
  job.emitter.on('event', onEvent);

  // Proxies and browsers drop an idle connection; a comment line keeps it warm.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  // A job that finished before the browser attached would otherwise wait for
  // an event that is never coming.
  if (job.status !== 'running') {
    write('status', { status: job.status, error: job.error, stats: job.stats, vars: job.vars });
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    job.emitter.off('event', onEvent);
    res.end();
  });
});
