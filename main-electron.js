// main-electron.js
// Run with: contextIsolation: true, nodeIntegration: false (ESM)
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path, { dirname } from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFile } from 'child_process';

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

  try { app.focus({ steal: true }); } catch {}
  try { w.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  try { w.show(); w.focus(); w.webContents.focus(); } catch {}
  try { w.moveTop?.(); } catch {}

  setTimeout(() => {
    try { w.setAlwaysOnTop(false); } catch {}
    try { w.focus(); w.webContents.focus(); } catch {}
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
  DMART_CITIZEN: 'Citizen CL-E321 (Copy 1)',
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

  await new Promise((r) => setTimeout(r, 120));
}

function writeTempPdf(buffer, prefix = 'jt-invoice') {
  const dir = app.getPath('temp') || os.tmpdir();
  const file = path.join(
    dir,
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  );
  fs.writeFileSync(file, buffer);
  return file;
}

async function printHtmlViaPdfSpool({ html, printerName, pageSize, landscape = false, copies = 1 }) {
  const win = createPrintWindow();
  let pdfPath = '';

  try {
    await loadHtmlIntoWindow(win, html);

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      landscape,
      marginsType: 1,
      pageSize,
    });

    pdfPath = writeTempPdf(pdfBuffer, 'jt-bill');

    log(`Spooling PDF to printer="${printerName}" copies=${copies} path=${pdfPath}`);

    await printPdf(pdfPath, {
      printer: printerName,
      copies: Math.max(1, Math.floor(copies || 1)),
    });

    log('Spool finished');
  } finally {
    try {
      if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    } catch {}

    try {
      if (!win.isDestroyed()) win.close();
    } catch {}
  }
}

function escapeForPowerShellSingleQuoted(str) {
  return String(str).replace(/'/g, "''");
}

function sendRawToPrinterWindows(printerName, rawData) {
  return new Promise((resolve, reject) => {
    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
"@

$printerName = '${escapeForPowerShellSingleQuoted(printerName)}'
$raw = @'
${rawData}
'@

$bytes = [System.Text.Encoding]::ASCII.GetBytes($raw)
$hPrinter = [IntPtr]::Zero
$docInfo = New-Object RawPrinterHelper+DOCINFOA
$docInfo.pDocName = "JTFV Dmart Label"
$docInfo.pDataType = "RAW"

if (-not [RawPrinterHelper]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) {
  throw "OpenPrinter failed for: $printerName"
}

try {
  if (-not [RawPrinterHelper]::StartDocPrinter($hPrinter, 1, $docInfo)) {
    throw "StartDocPrinter failed"
  }

  try {
    if (-not [RawPrinterHelper]::StartPagePrinter($hPrinter)) {
      throw "StartPagePrinter failed"
    }

    $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
      $written = 0
      if (-not [RawPrinterHelper]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written)) {
        throw "WritePrinter failed"
      }
      if ($written -ne $bytes.Length) {
        throw "WritePrinter wrote $written of $($bytes.Length) bytes"
      }
    }
    finally {
      [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    }

    [void][RawPrinterHelper]::EndPagePrinter($hPrinter)
  }
  finally {
    [void][RawPrinterHelper]::EndDocPrinter($hPrinter)
  }
}
finally {
  [void][RawPrinterHelper]::ClosePrinter($hPrinter)
}
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function zplSafeText(value, maxLen = 40) {
  return String(value ?? '')
    .replace(/[\^~\\]/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function formatDateForLabel(dateStr) {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function buildDmartZpl(items, packedOnDate, copies = 1) {
  return items.map((p) => {
    const productName = zplSafeText(p.productName, 22);
    const barcode = zplSafeText(p.barcode, 20);
    const mrp = Number(p.mrp || 0).toFixed(2);
    const pkd = formatDateForLabel(packedOnDate);
    const exp = formatDateForLabel(p.expiryDate);

    return `
^XA
^PW304
^LL188
^LH0,0
^LS0
^LT0
^CI28

^FO95,4^A0N,20,20^FB180,1,0,C,0^FDJ T FRUITS & VEG^FS
^FO10,26^A0N,22,22^FB250,1,0,C,0^FD${productName}^FS

^FO18,52^BY2,2,42^BCN,42,N,N,N^FD${barcode}^FS
^FO26,98^A0N,24,24^FD${barcode}^FS

^FO8,126^A0N,22,22^FDM.R.P.^FS
^FO8,148^A0N,24,24^FD${mrp}^FS

^FO145,126^A0N,20,20^FDPkd. On ${pkd}^FS
^FO145,148^A0N,20,20^FDExp. Dt. ${exp}^FS

^FO12,174^A0N,18,18^FDIncl. of all Taxes)^FS

^FO270,52^A0B,28,28^FDDmart^FS

^PQ${Math.max(1, Math.floor(copies || 1))}
^XZ`.trim();
  }).join('\n');
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
    } catch {}
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
    } catch {}
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
    } catch {}
    gentleRefocus();
  }
});

ipcMain.handle('print:dmart-38x25', async (_event, payload = {}) => {
  const { items = [], packedOnDate, copies = 1 } = payload;
  log(`IPC print:dmart-38x25 RAW items=${items.length}, copies=${copies}`);

  try {
    const printerName = 'Citizen CL-E321 (Copy 1)';
    const zpl = buildDmartZpl(items, packedOnDate, copies);

    log(`Using RAW Dmart printer: ${printerName}`);
    log(`ZPL length: ${zpl.length}`);

    await sendRawToPrinterWindows(printerName, zpl);

    return { ok: true };
  } catch (err) {
    log(`print:dmart-38x25 RAW error: ${err?.message || err}`);
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
    } catch {}
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