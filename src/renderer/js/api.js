// Re-export the preload-exposed bridge so view modules never reference window.* directly.
export const api = window.netshare;
