import { create } from 'zustand';

import { api } from '../lib/api.js';
import { blankRequest, toWireRequest, uid } from '../lib/request.js';

const STORAGE_KEY = 'postguy:tabs';

function loadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved?.tabs?.length) return saved;
  } catch {
    /* fall through to a fresh workspace */
  }
  const request = blankRequest({ name: 'New request', url: 'https://httpbin.org/get' });
  return { tabs: [{ id: uid('tab'), request, response: null, dirty: false }], activeTabId: null };
}

const initial = loadTabs();

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

  openTab: (request) => {
    const tab = { id: uid('tab'), request: { ...request }, response: null, dirty: false };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    get().persistTabs();
  },

  newTab: () => get().openTab(blankRequest({ name: 'New request' })),

  closeTab: (tabId) =>
    set((state) => {
      const remaining = state.tabs.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        const fresh = { id: uid('tab'), request: blankRequest(), response: null, dirty: false };
        return { tabs: [fresh], activeTabId: fresh.id };
      }
      const activeTabId =
        state.activeTabId === tabId ? remaining[remaining.length - 1].id : state.activeTabId;
      return { tabs: remaining, activeTabId };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  patchRequest: (patch) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId
          ? { ...tab, request: { ...tab.request, ...patch }, dirty: true }
          : tab,
      ),
    }));
    get().persistTabs();
  },

  patchActiveTab: (patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === state.activeTabId ? { ...tab, ...patch } : tab)),
    })),

  persistTabs: () => {
    const { tabs, activeTabId } = get();
    // Responses can be megabytes — persist only what's needed to restore work.
    const slim = tabs.map(({ id, request }) => ({ id, request, response: null, dirty: false }));
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
    if (!tab) return;
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

  saveToCollection: async (collectionId) => {
    const tab = get().activeTab();
    const collection = get().collections.find((item) => item.id === collectionId);
    if (!tab || !collection) return;
    const requests = collection.requests ?? [];
    const index = requests.findIndex((item) => item.id === tab.request.id);
    const nextRequests =
      index === -1
        ? [...requests, tab.request]
        : requests.map((item, i) => (i === index ? tab.request : item));
    const updated = await api.updateCollection(collectionId, { ...collection, requests: nextRequests });
    set((state) => ({
      collections: state.collections.map((item) => (item.id === updated.id ? updated : item)),
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
