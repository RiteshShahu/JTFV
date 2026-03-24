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
const { print: printPdf } = require('pdf-to-printer');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// IST time formatter for logs
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
      await new Promise((r) => setTimeout(r, delayMs));
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
  loadWithRetry(mainWindow, url).catch((err) =>
    log(`Final load failed: ${err?.message || err}`)
  );
  log(`Loaded URL: ${url}`);

  mainWindow.webContents.on('did-finish-load', () => {
    log('Renderer finished loading.');
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    log(`Renderer failed to load ${validatedURL}: ${desc} (${code})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const sameOrigin =
      url.startsWith('http://localhost:3001') ||
      url.startsWith('https://localhost:3001') ||
      url === 'about:blank';

    if (sameOrigin) return { action: 'allow' };

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const sameOrigin = url.startsWith('http://localhost:3001');
    if (!sameOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`render-process-gone: ${details.reason}`);
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`console[${level}] ${sourceId}:${line} ${message}`);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

/* ======================
   GENTLE REFOCUS
   ====================== */

function getMainWindow() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || mainWindow;
}

function gentleRefocus() {
  const w = getMainWindow();
  if (!w) return;

  try { app.focus({ steal: true }); } catch { }
  try { w.setAlwaysOnTop(true, 'screen-saver'); } catch { }
  try { w.show(); w.focus(); w.webContents.focus(); } catch { }
  try { w.moveTop?.(); } catch { }

  setTimeout(() => {
    try { w.setAlwaysOnTop(false); } catch { }
    try { w.focus(); w.webContents.focus(); } catch { }
  }, 150);
}

function sanitizeFilename(name) {
  return String(name || 'Invoice.pdf').replace(/[\\/:*?"<>|]/g, '_').trim();
}

ipcMain.handle('ui:refocus-hard', () => {
  gentleRefocus();
});

/* ======================
   PRINT HELPERS (PDF → SPOOL)
   ====================== */

const mm = (n) => n * 1000;

const SIZES = {
  A4: 'A4',
  LABEL_38x25: { width: mm(38), height: mm(25) },
};

const PRINTER_PREFERENCES = {
  CANON: [
    'Canon LBP2900',
    'Canon LBP2900 on NEW-PC2017',
    '\\\\NEW-PC2017\\Canon LBP2900',
  ],
  DMART_CITIZEN: 'Citizen CL-E321',
};

async function listPrinters(win) {
  const wc = win.webContents;
  if (typeof wc.getPrintersAsync === 'function') {
    return (await wc.getPrintersAsync()) || [];
  }
  return wc.getPrinters() || [];
}

const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function resolvePrinterName(win, preferredNames) {
  const printers = await listPrinters(win);
  const names = printers.map((p) => p.name);
  log(`Available printers: ${JSON.stringify(names)}`);

  for (const want of preferredNames) {
    const found = printers.find((p) => p.name === want);
    if (found) return found.name;
  }

  const prefNorm = preferredNames.map(normalize);
  for (const p of printers) {
    if (prefNorm.includes(normalize(p.name))) return p.name;
  }

  for (const want of prefNorm) {
    const found = printers.find((p) => normalize(p.name).includes(want));
    if (found) return found.name;
  }

  return null;
}

function createPrintWindow() {
  return new BrowserWindow({
    show: false,
    width: 600,
    height: 800,
    focusable: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false,
    },
  });
}

function htmlFromDataUrl(dataUrl) {
  const m = /^data:text\/html(?:;charset=[^;]+)?(;base64)?,(.*)$/i.exec(dataUrl || '');
  if (!m) {
    return '<!doctype html><meta charset="utf-8"><p>Invalid data URL</p>';
  }

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

  await new Promise((r) => setTimeout(r, 80));
}

async function waitForPrintAssets(win) {
  await win.webContents.executeJavaScript(`
    new Promise(async (resolve) => {
      const imgs = Array.from(document.images || []);
      await Promise.all(
        imgs.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((res) => {
            img.onload = res;
            img.onerror = res;
          });
        })
      );

      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      } catch {}

      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  `);
}

async function printHtmlDirect({ html, printerName, pageSize, landscape = false, copies = 1 }) {
  const win = createPrintWindow();

  try {
    await loadHtmlIntoWindow(win, html);
    await waitForPrintAssets(win);

    await new Promise((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerName,
          copies: Math.max(1, Math.floor(copies || 1)),
          landscape,
          pageSize,
          margins: { marginType: 'none' },
          scaleFactor: 100,
        },
        (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Direct print failed'));
            return;
          }
          resolve(true);
        }
      );
    });

    log(`Direct print success to printer="${printerName}"`);
    return true;
  } finally {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {}
  }
}

async function htmlToPngBuffer(html, widthPx = 304, heightPx = 200) {
  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: heightPx,
    useContentSize: true,
    frame: false,
    resizable: false,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false,
    },
  });

  try {
    await loadHtmlIntoWindow(win, html);
    await waitForPrintAssets(win);

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: widthPx,
      height: heightPx,
    });

    return image.toPNG();
  } finally {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {}
  }
}

function pngBufferToDataUrl(pngBuffer) {
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

function build38x25DriverPrintHtmlFromImages(imageDataUrls) {
  const pages = imageDataUrls.map((dataUrl) => `
    <div class="page">
      <img src="${dataUrl}" />
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: 38mm 25mm;
      margin: 0;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 38mm;
      background: #fff;
    }

    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      position: relative;
      width: 38mm;
      height: 25mm;
      overflow: hidden;
      background: #fff;
      page-break-after: always;
      break-after: page;
    }

    .page:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    img {
      position: absolute;
      left: 0.8mm;     /* slightly right so left edge doesn't clip */
      top: 0.2mm;
      width: 39.1mm;   /* a little bigger */
      height: 25.6mm;  /* a little bigger */
      display: block;
      object-fit: fill;
    }
  </style>
</head>
<body>
  ${pages}
</body>
</html>`;
}

/* ======================
   IPC HANDLERS
   ====================== */

ipcMain.handle('save-pdf-a4', async (_event, dataUrl, opts) => {
  log(`IPC save-pdf-a4 URL len=${(dataUrl || '').length}`);
  const win = createPrintWindow();

  try {
    const html = htmlFromDataUrl(dataUrl);
    await loadHtmlIntoWindow(win, html);

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      landscape: !!opts?.landscape,
      marginsType: 0,
      pageSize: 'A4',
    });

    const defaultName = sanitizeFilename(opts?.filename || `Invoice_${Date.now()}.pdf`);
    const savePath = path.join(app.getPath('desktop'), defaultName);

    fs.writeFileSync(savePath, pdfBuffer);

    log(`PDF saved to Desktop: ${savePath}`);
    return { ok: true, path: savePath };
  } catch (err) {
    log(`save-pdf-a4 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    try {
      if (!win.isDestroyed()) win.close();
    } catch { }
    gentleRefocus();
  }
});

ipcMain.handle('print:list', async () => {
  const win = createPrintWindow();
  try {
    return await listPrinters(win);
  } catch (err) {
    log(`print:list error: ${err?.message || err}`);
    return [];
  } finally {
    try {
      if (!win.isDestroyed()) win.close();
    } catch { }
  }
});

ipcMain.handle('print:canon-a4', async (_event, { url, landscape = false, copies = 1 } = {}) => {
  log(`IPC print:canon-a4 URL len=${(url || '').length}, copies=${copies}`);
  const win = createPrintWindow();

  try {
    const html = htmlFromDataUrl(url);
    const deviceName = await resolvePrinterName(win, PRINTER_PREFERENCES.CANON);

    if (!deviceName) {
      return { ok: false, error: 'Canon LBP2900 printer not found.' };
    }

    await printHtmlViaPdfSpool({
      html,
      printerName: deviceName,
      pageSize: SIZES.A4,
      landscape,
      copies,
    });

    return { ok: true };
  } catch (err) {
    log(`print:canon-a4 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    try {
      if (!win.isDestroyed()) win.close();
    } catch { }
    gentleRefocus();
  }
});

ipcMain.handle('print:dmart-38x25', async (_event, payload = {}) => {
  const { labelsHtml = [], copies = 1 } = payload;
  log(`IPC print:dmart-38x25 labels=${labelsHtml.length}, copies=${copies}`);

  try {
    if (!Array.isArray(labelsHtml) || labelsHtml.length === 0) {
      return { ok: false, error: 'No labels received for Dmart print.' };
    }

    const printerName = 'Citizen CL-E321';
    const totalCopies = Math.max(1, Math.floor(copies || 1));
    const imageDataUrls = [];

    for (let c = 0; c < totalCopies; c++) {
      for (let i = 0; i < labelsHtml.length; i++) {
        const pngBuffer = await htmlToPngBuffer(labelsHtml[i], 304, 200);
        imageDataUrls.push(pngBufferToDataUrl(pngBuffer));
      }
    }

    const driverHtml = build38x25DriverPrintHtmlFromImages(imageDataUrls);
    log(`Generated multi-label driver HTML length=${driverHtml.length}`);
    log(`Total labels in one print job=${imageDataUrls.length}`);

    await printHtmlDirect({
      html: driverHtml,
      printerName,
      pageSize: SIZES.LABEL_38x25,
      landscape: false,
      copies: 1,
    });

    log('Dmart print success');
    return { ok: true };
  } catch (err) {
    log(`print:dmart-38x25 error: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    gentleRefocus();
  }
});

/* ======================
   APP LIFECYCLE / SERVER
   ====================== */

app.whenReady().then(() => {
  const isDev = !app.isPackaged;

  const basePath = isDev
    ? __dirname
    : path.join(process.resourcesPath, 'app_data');

  const serverPath = path.join(basePath, 'server.cjs');
  const nodeModulesPath = path.join(basePath, 'node_modules');
  const angularDistPath = path.join(basePath, 'dist', 'my-login-app');
  const userDataPath = app.getPath('userData');

  log('======================');
  log('App starting up...');
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
      NODE_PATH: nodeModulesPath,
    }
  });

  serverProcess.stdout.on('data', (data) => {
    log(`Server: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    log(`Server Error: ${data.toString().trim()}`);
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  log('App quitting. Killing server process...');
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch { }
  }
});

/* ======================
   MAIN-PROCESS SAFETY
   ====================== */

process.on('uncaughtException', (err) => {
  log(`Main uncaughtException: ${err?.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  log(`Main unhandledRejection: ${reason?.stack || reason}`);
});