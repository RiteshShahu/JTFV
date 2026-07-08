// preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
console.log('PRELOAD LOADED - NEW VERSION');
contextBridge.exposeInMainWorld('electron', {
  listPrinters: async () => {
    try {
      return await ipcRenderer.invoke('print:list');
    } catch {
      return [];
    }
  },
  savePdfA4: (dataUrl, opts) =>
    ipcRenderer.invoke('save-pdf-a4', dataUrl, opts),
  printCanonA4: async (dataUrl, opts = {}) => {
    try {
      return await ipcRenderer.invoke('print:canon-a4', { url: dataUrl, ...opts });
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
  printDmart38x25: async (payload) => {
    try {
      return await ipcRenderer.invoke('print:dmart-38x25', payload);
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
  refocusHard: () =>
    ipcRenderer.invoke('ui:refocus-hard').catch(() => {}),

  // ✅ Auth token storage — used for "stay logged in" (never stores the password itself)
  auth: {
    saveToken: async (token) => {
      try {
        return await ipcRenderer.invoke('auth:save-token', token);
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    getToken: async () => {
      try {
        return await ipcRenderer.invoke('auth:get-token');
      } catch (e) {
        return { ok: true, token: null, error: String(e?.message || e) };
      }
    },
    clearToken: async () => {
      try {
        return await ipcRenderer.invoke('auth:clear-token');
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
  },
});