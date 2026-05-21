// Single shared state object. Views read it through their `getState` callback
// and re-render on demand from app.js.

export const state = {
  adapters: [],
  selectedPublic: null,
  selectedPrivate: null,
  activePublic: null,
  activePrivate: null,
  sharingActive: false,
  serviceRunning: false,
  scopeAddress: null,
  detectedSource: null,
  detectedTarget: null,
  activeShare: null,  // { source, target } pair this app enabled — resolves the source when the poll can't

  prevSample: null,  // { ts, perAdapter: { name -> { sent, received } } } from the previous poll
  trafficHistory: {},  // adapterName -> [{ down, up }] rolling byte/sec samples feeding the per-adapter chart
  clients: [],
  clientsLoading: false,
  initialDetectDone: false,
  sourceSort: 'traffic-desc',  // sort order for the Internet Source list: '<name|traffic>-<asc|desc>'
  settings: null,
  busy: false
};
