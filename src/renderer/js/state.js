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
  prevSample: null,  // { ts, perAdapter: { name -> { sent, received } } } from the previous poll
  clients: [],
  clientsLoading: false,
  initialDetectDone: false,
  settings: null,
  busy: false
};
