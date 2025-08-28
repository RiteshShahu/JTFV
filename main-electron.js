// main-electron.js
// Run with: contextIsolation: true, nodeIntegration: false (ESM)
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path, { dirname } from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// pdf-to-printer is CJS; use createRequire so it works in ESM
const { print: printPdf } = require('pdf-to-printer');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ⏰ IST time formatter for logs
function getISTTime() {
  const date = new Date();
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString();
}

const logFilePath = path.join(app.getPath('userData'), 'log.txt');
function log(message) {
  const timestamp = getISTTime();
  fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
}

let mainWindow;
let serverProcess;

/** Retry loader so dev startup doesn't race the server */
async function loadWithRetry(win, url, attempts = 15, delayMs = 300) {
  for (let i = 0; i < attempts; i++) {
    try {
      await win.loadURL(url);
      return;
    } catch (e) {
      log(`Load attempt ${i + 1} failed: ${e?.message || e}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  await win.loadURL(url);
}

const createWindow = () => {
  log('Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'assets', 'logo.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    }
  });

  const url = 'http://localhost:3001';
  loadWithRetry(mainWindow, url).catch(err =>
    log(`❌ Final load failed: ${err?.message || err}`)
  );
  log(`Loaded URL: ${url}`);

  mainWindow.webContents.on('did-finish-load', () => {
    log('✅ Renderer finished loading.');
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc, validatedURL) => {
    log(`❌ Renderer failed to load ${validatedURL}: ${desc} (${code})`);
  });

  // ✅ Allow Angular SPA navigations, block only true external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const sameOrigin =
      url.startsWith('http://localhost:3001') ||
      url.startsWith('https://localhost:3001') ||
      url === 'about:blank';

    if (sameOrigin) {
      return { action: 'allow' };
    }

    // Open all other URLs externally
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ✅ Extra guard for redirects
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const sameOrigin = url.startsWith('http://localhost:3001');
    if (!sameOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Debug renderer crashes
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`❌ render-process-gone: ${details.reason}`);
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`🧪 console[${level}] ${sourceId}:${line} ${message}`);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

/* ======================
   GENTLE REFOCUS (single, no minimize/restore)
   ====================== */

function getMainWindow() {
  return BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || mainWindow;
}

/** A light, non-intrusive focus nudge:
 * - briefly setAlwaysOnTop to pull the window forward
 * - focus app + webContents
 * - revert AOT after ~150ms
 * No minimize/restore. No multiple pulses.
 */
function gentleRefocus() {
  const w = getMainWindow();
  if (!w) return;

  try { app.focus({ steal: true }); } catch {}
  try { w.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  try { w.show(); w.focus(); w.webContents.focus(); } catch {}
  try { w.moveTop?.(); } catch {}

  setTimeout(() => {
    try { w.setAlwaysOnTop(false); } catch {}
    try { w.focus(); w.webContents.focus(); } catch {}
  }, 150);
}

ipcMain.handle('ui:refocus-hard', () => { gentleRefocus(); });

/* ======================
   PRINT HELPERS (PDF → SPOOL)
   ====================== */

// Microns helper (Electron uses µm for custom sizes)
const mm = n => n * 1000;

// Common sizes
const SIZES = {
  A4: 'A4',
  LABEL_50x50: { width: mm(50), height: mm(50) }
};

// Preferred queue names
const PRINTER_PREFERENCES = {
  CANON: [
    'Canon LBP2900',
    'Canon LBP2900 on NEW-PC2017',
    '\\\\NEW-PC2017\\Canon LBP2900',
  ],
  CITIZEN: ['Citizen CL-E321', 'CITIZEN CL-E321']
};

async function listPrinters(win) {
  const wc = win.webContents;
  if (typeof wc.getPrintersAsync === 'function') return (await wc.getPrintersAsync()) || [];
  return wc.getPrinters() || [];
}
const normalize = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function resolvePrinterName(win, preferredNames) {
  const printers = await listPrinters(win);
  const names = printers.map(p => p.name);
  log(`Available printers: ${JSON.stringify(names)}`);

  // exact case-sensitive
  for (const want of preferredNames) {
    const found = printers.find(p => p.name === want);
    if (found) return found.name;
  }
  // exact case-insensitive
  const prefNorm = preferredNames.map(normalize);
  for (const p of printers) {
    if (prefNorm.includes(normalize(p.name))) return p.name;
  }
  // fuzzy contains (case-insensitive)
  for (const want of prefNorm) {
    const found = printers.find(p => normalize(p.name).includes(want));
    if (found) return found.name;
  }
  return null;
}

function createPrintWindow() {
  // hidden, unfocusable, not modal
  return new BrowserWindow({
    show: false,
    width: 600,
    height: 800,
    focusable: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
}

function htmlFromDataUrl(dataUrl) {
  const m = /^data:text\/html(?:;charset=[^;]+)?(;base64)?,(.*)$/i.exec(dataUrl || '');
  if (!m) return '<!doctype html><meta charset="utf-8"><p>Invalid data URL</p>';
  const isB64 = Boolean(m[1]);
  try {
    return isB64
      ? Buffer.from(m[2], 'base64').toString('utf8')
      : decodeURIComponent(m[2]);
  } catch {
    return '<!doctype html><meta charset="utf-8"><p>Failed to decode data URL</p>';
  }
}

async function loadHtmlIntoWindow(win, html) {
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(`
    document.open();
    document.write(${JSON.stringify(html)});
    document.close();
  `);
  await new Promise(r => setTimeout(r, 120)); // allow layout/paint
}

// Write a temp PDF file; return absolute path
function writeTempPdf(buffer, prefix = 'jt-invoice') {
  const dir = app.getPath('temp') || os.tmpdir();
  const file = path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, buffer);
  return file;
}

// The core: render to PDF then spool to printer
async function printHtmlViaPdfSpool({ html, printerName, pageSize, landscape = false, copies = 1 }) {
  const win = createPrintWindow();
  let pdfPath = '';
  try {
    await loadHtmlIntoWindow(win, html);

    // Render to PDF (A4 or custom µm)
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      landscape,
      marginsType: 1,
      pageSize, // 'A4' or {width,height} in µm
    });

    pdfPath = writeTempPdf(pdfBuffer, 'jt-bill');

    log(`Spooling PDF to printer="${printerName}" copies=${copies} path=${pdfPath}`);

    await printPdf(pdfPath, {
      printer: printerName,
      copies: Math.max(1, Math.floor(copies || 1)),
    });

    log('✅ Spool finished');
  } finally {
    try { if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch {}
    try { if (!win.isDestroyed()) win.close(); } catch {}
  }
}

/* ======================
   IPC HANDLERS (PDF → SPOOL)
   ====================== */

ipcMain.handle('print:list', async () => {
  const win = createPrintWindow();
  try {
    return await listPrinters(win);
  } catch (err) {
    log(`❌ print:list error: ${err?.message || err}`);
    return [];
  } finally {
    try { if (!win.isDestroyed()) win.close(); } catch {}
  }
});

ipcMain.handle('print:canon-a4', async (_event, { url, landscape = false, copies = 1 } = {}) => {
  log(`IPC print:canon-a4 URL len=${(url||'').length}, copies=${copies}`);
  const win = createPrintWindow();
  try {
    const html = htmlFromDataUrl(url);

    // pick printer
    const deviceName = await resolvePrinterName(win, PRINTER_PREFERENCES.CANON);
    if (!deviceName) return { ok: false, error: 'Canon LBP2900 printer not found.' };

    // PDF → spool route (avoids Chromium print loop/focus issues)
    await printHtmlViaPdfSpool({
      html,
      printerName: deviceName,
      pageSize: SIZES.A4,
      landscape,
      copies
    });

    return { ok: true };
  } catch (err) {
    log(`❌ IPC print:canon-a4 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    try { if (!win.isDestroyed()) win.close(); } catch {}
    gentleRefocus(); // soft refocus after print
  }
});

ipcMain.handle('print:citizen-50', async (_event, { url, copies = 1 } = {}) => {
  log(`IPC print:citizen-50 URL len=${(url||'').length}, copies=${copies}`);
  const win = createPrintWindow();
  try {
    const html = htmlFromDataUrl(url);

    const deviceName = await resolvePrinterName(win, PRINTER_PREFERENCES.CITIZEN);
    if (!deviceName) return { ok: false, error: 'Citizen CL-E321 printer not found.' };

    await printHtmlViaPdfSpool({
      html,
      printerName: deviceName,
      pageSize: SIZES.LABEL_50x50,
      landscape: false,
      copies
    });

    return { ok: true };
  } catch (err) {
    log(`❌ IPC print:citizen-50 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    try { if (!win.isDestroyed()) win.close(); } catch {}
    pulseRefocus();
  }
});

/* ======================
   APP LIFECYCLE / SERVER
   ====================== */

app.whenReady().then(() => {
  const isDev = !app.isPackaged;

  // ✅ Use unified unpacked folder in production: app_data
  const basePath = isDev
    ? __dirname
    : path.join(process.resourcesPath, 'app_data');

  const serverPath = path.join(basePath, 'server.cjs');
  const nodeModulesPath = path.join(basePath, 'node_modules');
  const angularDistPath = path.join(basePath, 'dist', 'my-login-app'); // currently logged only
  const userDataPath = app.getPath('userData');

  log('======================');
  log('🚀 App starting up...');
  log(`Environment: ${isDev ? 'Development' : 'Production'}`);
  log(`Server path: ${serverPath}`);
  log(`Angular dist path: ${angularDistPath}`);
  log(`User data path: ${userDataPath}`);
  log(`NODE_PATH: ${nodeModulesPath}`);
  log('======================');

  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'false',
      NODE_ENV: isDev ? 'development' : 'production',
      RUNNING_IN_ELECTRON: 'true',
      USER_DATA_PATH: userDataPath,
      NODE_PATH: nodeModulesPath
    }
  });

  serverProcess.stdout.on('data', (data) => {
    log(`Server: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    log(`❗ Server Error: ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    log(`Server exited with code ${code}`);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log('All windows closed.');
  // Keep server alive until app.quit()
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  log('App quitting. Killing server process...');
  if (serverProcess) try { serverProcess.kill(); } catch {}
});

/* ======================
   MAIN-PROCESS SAFETY
   ====================== */
process.on('uncaughtException', (err) => {
  log(`❌ Main uncaughtException: ${err?.stack || err}`);
  // don't exit — keep the app alive
});
process.on('unhandledRejection', (reason) => {
  log(`❌ Main unhandledRejection: ${reason?.stack || reason}`);
});