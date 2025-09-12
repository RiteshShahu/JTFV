// preload.cjs
// contextIsolation: true, nodeIntegration: false
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  listPrinters: async () => {
    try { return await ipcRenderer.invoke('print:list'); }
    catch { return []; }
  },
  printCanonA4: async (dataUrl, opts = {}) => {
    try { return await ipcRenderer.invoke('print:canon-a4', { url: dataUrl, ...opts }); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  },
  printCitizen50: async (dataUrl, opts = {}) => {
    try { return await ipcRenderer.invoke('print:citizen-50', { url: dataUrl, ...opts }); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  },
  printCitizen38x25: async (dataUrl, opts = {}) => {
    try { return await ipcRenderer.invoke('print:citizen-38x25', { url: dataUrl, ...opts }); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  },
  refocusHard: () => ipcRenderer.invoke('ui:refocus-hard').catch(() => {})
});