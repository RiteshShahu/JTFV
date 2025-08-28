// main-electron.js
// Run with: contextIsolation: true, nodeIntegration: false

import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path, { dirname } from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
  // Final try so the error surfaces if still failing
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
   PRINT HELPERS & IPC
   ====================== */

// Electron/Chromium custom size uses MICRONS (1 mm = 1000 µm)
const mm = n => n * 1000;

const SIZES = {
  A4: 'A4',
  LABEL_50x50: { width: mm(50), height: mm(50) }
};

// Preferred queue names / patterns
const PRINTER_PREFERENCES = {
  CANON: [
    'Canon LBP2900',
    'Canon LBP2900 on NEW-PC2017',
    '\\\\NEW-PC2017\\Canon LBP2900',   // UNC share
  ],
  CITIZEN: [
    'Citizen CL-E321',
    'CITIZEN CL-E321',
  ]
};

// compat: get printers (async if available)
async function listPrinters(win) {
  const wc = win.webContents;
  if (typeof wc.getPrintersAsync === 'function') {
    return (await wc.getPrintersAsync()) || [];
  }
  return wc.getPrinters() || [];
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Pick the best available printer by trying exact, then case-insensitive, then fuzzy
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

function doPrint(win, { deviceName, pageSize, landscape = false, silent = true, printBackground = true }) {
  log(`🖨️ Printing on "${deviceName}" pageSize=${JSON.stringify(pageSize)} landscape=${landscape}`);
  return new Promise((resolve, reject) => {
    win.webContents.print(
      { deviceName, pageSize, landscape, silent, printBackground },
      (success, failureReason) => {
        if (!success) {
          log(`❌ Print failed: ${failureReason || 'Unknown reason'}`);
          reject(new Error(failureReason || 'Print failed'));
        } else {
          log('✅ Print succeeded');
          resolve();
        }
      }
    );
  });
}

// Create a hidden window for print jobs
function createPrintWindow() {
  const w = new BrowserWindow({
    show: false,
    width: 600,
    height: 800,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false, // offscreen can interfere with print in some drivers
    },
  });
  return w;
}

// --- Data URL helpers & robust loader ---

/** Decode HTML from data: URL (supports base64 or UTF-8 encoded payloads) */
function htmlFromDataUrl(dataUrl) {
  const m = /^data:text\/html(?:;charset=[^;]+)?(;base64)?,(.*)$/i.exec(dataUrl || '');
  if (!m) return '<!doctype html><meta charset="utf-8"><p>Invalid data URL</p>';
  const isB64 = Boolean(m[1]);
  const payload = m[2];
  try {
    return isB64
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
  } catch (e) {
    return '<!doctype html><meta charset="utf-8"><p>Failed to decode data URL</p>';
  }
}

/** Load HTML robustly by writing into about:blank, avoiding flaky data:URL events */
async function loadHtmlIntoWindow(win, html) {
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(`
    document.open();
    document.write(${JSON.stringify(html)});
    document.close();
  `);
  // allow layout/paint
  await new Promise(r => setTimeout(r, 100));
}

/** Optional old path; now unused but kept for reference */
async function loadAndWait(win, url, timeoutMs = 8000) {
  await win.loadURL(url);
  const finished = new Promise((res) => {
    if (!win.webContents.isLoadingMainFrame()) return res();
    win.webContents.once('did-finish-load', res);
  });
  const timed = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout waiting for did-finish-load')), timeoutMs));
  return Promise.race([finished, timed]);
}

// DEBUG: list printers from renderer
ipcMain.handle('print:list', async () => {
  const win = createPrintWindow();
  try {
    const list = await listPrinters(win);
    return list;
  } finally {
    win.close();
  }
});

// Bills → Canon LBP2900 (any queue variant) → A4
ipcMain.handle('print:canon-a4', async (_event, { url, landscape = false } = {}) => {
  log(`IPC print:canon-a4 URL len=${(url||'').length}`);
  const win = createPrintWindow();
  try {
    // Robust path: decode data URL and write into about:blank
    const html = htmlFromDataUrl(url);
    await loadHtmlIntoWindow(win, html);

    const deviceName = await resolvePrinterName(win, PRINTER_PREFERENCES.CANON);
    if (!deviceName) throw new Error('Canon LBP2900 printer not found.');
    // For debugging driver issues once, set silent:false
    await doPrint(win, { deviceName, pageSize: SIZES.A4, landscape, silent: true });
    return { ok: true };
  } catch (err) {
    log(`❌ IPC print:canon-a4 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    win.close();
  }
});

// Barcodes → Citizen CL-E321 → 50x50mm
ipcMain.handle('print:citizen-50', async (_event, { url } = {}) => {
  log(`IPC print:citizen-50 URL len=${(url||'').length}`);
  const win = createPrintWindow();
  try {
    // Robust path: decode data URL and write into about:blank
    const html = htmlFromDataUrl(url);
    await loadHtmlIntoWindow(win, html);

    const deviceName = await resolvePrinterName(win, PRINTER_PREFERENCES.CITIZEN);
    if (!deviceName) throw new Error('Citizen CL-E321 printer not found.');
    await doPrint(win, { deviceName, pageSize: SIZES.LABEL_50x50, landscape: false, silent: true });
    return { ok: true };
  } catch (err) {
    log(`❌ IPC print:citizen-50 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    win.close();
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
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
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

process.on('uncaughtException', (err) => {
  log(`❌ Uncaught exception: ${err.message}`);
  if (serverProcess) try { serverProcess.kill(); } catch {}
});