import { create } from 'zustand';

import { api } from '../lib/api.js';
import {
  blankRequest,
  blankScript,
  intervalToMs,
  mergeVarsIntoRows,
  toWireRequest,
  uid,
  varsToObject,
} from '../lib/request.js';

const STORAGE_KEY = 'postguy:tabs';

/** How much live output a tab keeps. The server caps its own copy too. */
const KEEP_REQUESTS = 300;
const KEEP_LOGS = 800;
const KEEP_ROWS = 2000;
/** Events arrive one per request; batching keeps a 20-lane job from thrashing React. */
const FLUSH_MS = 200;

const emptyJob = () => ({
  id: null,
  status: 'idle',
  error: null,
  stats: null,
  logs: [],
  rows: [],
  requests: [],
  startedAt: null,
  finishedAt: null,
});

/** Tabs saved before script tabs existed have no `kind`. */
function reviveTab(tab) {
  const kind = tab.kind ?? (tab.script ? 'script' : 'request');
  return {
    id: tab.id ?? uid('tab'),
    kind,
    request: kind === 'request' ? (tab.request ?? blankRequest()) : null,
    script: kind === 'script' ? (tab.script ?? blankScript()) : null,
    response: null,
    dirty: false,
    job: emptyJob(),
  };
}

function loadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved?.tabs?.length) return { tabs: saved.tabs.map(reviveTab), activeTabId: saved.activeTabId };
  } catch {
    /* fall through to a fresh workspace */
  }
  const request = blankRequest({ name: 'New request', url: 'https://httpbin.org/get' });
  return {
    tabs: [reviveTab({ id: uid('tab'), kind: 'request', request })],
    activeTabId: null,
  };
}

const initial = loadTabs();

/**
 * Live job streams, keyed by tab. Kept outside the store: an EventSource is
 * not state, and the buffer is flushed on a timer so a fast job does not
 * re-render on every single request.
 */
const streams = new Map();

function closeStream(tabId) {
  const stream = streams.get(tabId);
  if (!stream) return;
  clearInterval(stream.timer);
  stream.source.close();
  streams.delete(tabId);
}

export const useStore = create((set, get) => ({
  tabs: initial.tabs,
  activeTabId: initial.activeTabId ?? initial.tabs[0].id,

  collections: [],
  environments: [],
  activeEnvironmentId: localStorage.getItem('postguy:env') || null,
  globals: {},
  history: [],

  sidebarTab: 'collections',
  runnerResult: null,
  loading: false,
  toast: null,

  // --- tabs ---------------------------------------------------------------
  activeTab: () => get().tabs.find((tab) => tab.id === get().activeTabId) ?? get().tabs[0],

  openTab: (item) => {
    const tab =
      item?.kind === 'script'
        ? reviveTab({ id: uid('tab'), kind: 'script', script: { ...item } })
        : reviveTab({ id: uid('tab'), kind: 'request', request: { ...item } });
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    get().persistTabs();
  },

  newTab: () => get().openTab(blankRequest({ name: 'New request' })),
  newScriptTab: () => get().openTab(blankScript()),

  closeTab: (tabId) => {
    closeStream(tabId);
    set((state) => {
      const remaining = state.tabs.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        const fresh = reviveTab({ id: uid('tab'), kind: 'request', request: blankRequest() });
        return { tabs: [fresh], activeTabId: fresh.id };
      }
      const activeTabId =
        state.activeTabId === tabId ? remaining[remaining.length - 1].id : state.activeTabId;
      return { tabs: remaining, activeTabId };
    });
    get().persistTabs();
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  patchRequest: (patch) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId && tab.kind === 'request'
          ? { ...tab, request: { ...tab.request, ...patch }, dirty: true }
          : tab,
      ),
    }));
    get().persistTabs();
  },

  patchScript: (patch) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId && tab.kind === 'script'
          ? { ...tab, script: { ...tab.script, ...patch }, dirty: true }
          : tab,
      ),
    }));
    get().persistTabs();
  },

  patchActiveTab: (patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === state.activeTabId ? { ...tab, ...patch } : tab)),
    })),

  patchTabJob: (tabId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, job: { ...tab.job, ...patch } } : tab,
      ),
    })),

  persistTabs: () => {
    const { tabs, activeTabId } = get();
    // Responses and job output can be megabytes — persist only the work itself.
    const slim = tabs.map(({ id, kind, request, script }) => ({ id, kind, request, script }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: slim, activeTabId }));
    } catch {
      /* quota exceeded — the workspace just won't be restored next launch */
    }
  },

  // --- environments -------------------------------------------------------
  activeEnvironment: () =>
    get().environments.find((env) => env.id === get().activeEnvironmentId) ?? null,

  setActiveEnvironment: (id) => {
    localStorage.setItem('postguy:env', id ?? '');
    set({ activeEnvironmentId: id });
  },

  // --- server sync --------------------------------------------------------
  refresh: async () => {
    const [collections, environments, history] = await Promise.all([
      api.listCollections(),
      api.listEnvironments(),
      api.listHistory(),
    ]);
    set({ collections, environments, history });
  },

  notify: (message, tone = 'info') => {
    set({ toast: { message, tone, id: uid('toast') } });
    setTimeout(() => set((state) => (state.toast?.message === message ? { toast: null } : {})), 3200);
  },

  // --- the main action ----------------------------------------------------
  send: async () => {
    const tab = get().activeTab();
    if (!tab || tab.kind !== 'request') return;
    const env = get().activeEnvironment();
    set({ loading: true });
    get().patchActiveTab({ response: null });
    try {
      const result = await api.send({
        request: toWireRequest(tab.request),
        environment: env?.values ?? {},
        globals: get().globals,
      });

      get().patchActiveTab({ response: result });

      // Scripts can write into the environment — persist whatever changed.
      if (env && JSON.stringify(env.values) !== JSON.stringify(result.environment)) {
        const updated = await api.updateEnvironment(env.id, { ...env, values: result.environment });
        set((state) => ({
          environments: state.environments.map((item) => (item.id === updated.id ? updated : item)),
        }));
      }
      set({ globals: result.globals });
      api.listHistory().then((history) => set({ history }));
    } catch (err) {
      get().notify(err.message, 'error');
    } finally {
      set({ loading: false });
    }
  },

  // --- script tabs / jobs --------------------------------------------------
  /**
   * Attach to a job's event stream. Safe to call for a job that is already
   * finished — the server replays a full snapshot as the first message.
   */
  watchJob: (tabId, jobId) => {
    closeStream(tabId);

    const source = new EventSource(api.jobEventsUrl(jobId));
    const buffer = { logs: [], rows: [], requests: [] };

    const flush = () => {
      if (!buffer.logs.length && !buffer.rows.length && !buffer.requests.length) return;
      const drained = { ...buffer };
      buffer.logs = [];
      buffer.rows = [];
      buffer.requests = [];
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          return {
            ...tab,
            job: {
              ...tab.job,
              logs: [...tab.job.logs, ...drained.logs].slice(-KEEP_LOGS),
              rows: [...tab.job.rows, ...drained.rows].slice(-KEEP_ROWS),
              requests: [...tab.job.requests, ...drained.requests].slice(-KEEP_REQUESTS),
            },
          };
        }),
      }));
    };

    const timer = setInterval(flush, FLUSH_MS);
    streams.set(tabId, { source, timer });

    source.addEventListener('init', (event) => {
      const job = JSON.parse(event.data);
      get().patchTabJob(tabId, {
        id: job.id,
        status: job.status,
        error: job.error,
        stats: job.stats,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        logs: job.logs.slice(-KEEP_LOGS),
        rows: job.rows.slice(-KEEP_ROWS),
        requests: job.requests.slice(-KEEP_REQUESTS),
      });
    });

    source.addEventListener('log', (event) => buffer.logs.push(JSON.parse(event.data)));
    source.addEventListener('row', (event) => buffer.rows.push(JSON.parse(event.data)));
    source.addEventListener('request', (event) => buffer.requests.push(JSON.parse(event.data)));
    source.addEventListener('progress', (event) =>
      get().patchTabJob(tabId, { stats: JSON.parse(event.data) }),
    );

    source.addEventListener('status', (event) => {
      const data = JSON.parse(event.data);
      flush();
      get().patchTabJob(tabId, {
        status: data.status,
        error: data.error,
        stats: data.stats,
        finishedAt: Date.now(),
      });

      // Values the run left behind become the tab's variables, so the next run
      // starts where this one stopped.
      if (data.vars) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId && tab.kind === 'script'
              ? { ...tab, script: { ...tab.script, vars: mergeVarsIntoRows(tab.script.vars, data.vars) } }
              : tab,
          ),
        }));
        get().persistTabs();
      }
      closeStream(tabId);
    });

    source.onerror = () => {
      // The server closes the stream when the job ends; only shout if the job
      // was still supposed to be running.
      const tab = get().tabs.find((item) => item.id === tabId);
      if (tab?.job.status === 'running') {
        get().patchTabJob(tabId, { status: 'disconnected' });
      }
      closeStream(tabId);
    };
  },

  runJob: async () => {
    const tab = get().activeTab();
    if (!tab || tab.kind !== 'script') return;
    const { script } = tab;
    const env = get().activeEnvironment();

    get().patchTabJob(tab.id, { ...emptyJob(), status: 'running', startedAt: Date.now() });

    try {
      const job = await api.startJob({
        name: script.name,
        code: script.code,
        vars: varsToObject(script.vars),
        environment: env?.values ?? {},
        globals: get().globals,
        iterations: script.config.iterations,
        concurrency: script.config.concurrency,
        intervalMs: intervalToMs(script.config.interval, script.config.intervalUnit),
      });
      get().patchTabJob(tab.id, { id: job.id, status: job.status, stats: job.stats });
      get().watchJob(tab.id, job.id);
    } catch (err) {
      get().patchTabJob(tab.id, { status: 'error', error: err.message });
      get().notify(err.message, 'error');
    }
  },

  stopJob: async () => {
    const tab = get().activeTab();
    if (!tab?.job.id) return;
    try {
      await api.stopJob(tab.job.id);
    } catch (err) {
      get().notify(err.message, 'error');
    }
  },

  clearJobOutput: () => {
    const tab = get().activeTab();
    if (tab) get().patchTabJob(tab.id, { ...emptyJob() });
  },

  saveToCollection: async (collectionId) => {
    const tab = get().activeTab();
    const collection = get().collections.find((item) => item.id === collectionId);
    if (!tab || !collection) return;
    const item = tab.kind === 'script' ? { ...tab.script, kind: 'script' } : tab.request;
    const requests = collection.requests ?? [];
    const index = requests.findIndex((entry) => entry.id === item.id);
    const nextRequests =
      index === -1 ? [...requests, item] : requests.map((entry, i) => (i === index ? item : entry));
    const updated = await api.updateCollection(collectionId, { ...collection, requests: nextRequests });
    set((state) => ({
      collections: state.collections.map((entry) => (entry.id === updated.id ? updated : entry)),
    }));
    get().patchActiveTab({ dirty: false });
    get().notify(`Saved to ${collection.name}`);
  },

  runCollection: async (collectionId) => {
    const env = get().activeEnvironment();
    set({ loading: true, runnerResult: null });
    try {
      const result = await api.runCollection({
        collectionId,
        environment: env?.values ?? {},
        globals: get().globals,
      });
      set({ runnerResult: result });
      if (env) {
        const updated = await api.updateEnvironment(env.id, { ...env, values: result.environment });
        set((state) => ({
          environments: state.environments.map((item) => (item.id === updated.id ? updated : item)),
        }));
      }
    } catch (err) {
      get().notify(err.message, 'error');
    } finally {
      set({ loading: false });
    }
  },
}));
