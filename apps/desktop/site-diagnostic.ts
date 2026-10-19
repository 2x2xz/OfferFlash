import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { siteDiagnosticScript } from './site-diagnostic-script.js';

if (!process.argv.includes('--site-diagnostic') || process.argv.includes('--smoke-test') || process.argv.includes('--live-product-check')) {
  throw new Error('SITE_DIAGNOSTIC_FLAG_REQUIRED');
}
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const labEnabled = process.argv.includes('--site-adapter-lab');
const directory = join(projectRoot, '.backups/feishu-site-diagnostic', randomUUID());
await mkdir(directory, { recursive: true, mode: 0o700 });
app.setName('OfferAgent Site Diagnostic');
app.setPath('userData', directory);
app.setPath('sessionData', join(directory, 'browser-session'));
app.setAppLogsPath(join(directory, 'logs'));
await mkdir(app.getPath('sessionData'), { mode: 0o700 });
await app.whenReady();

const uiPath = join(projectRoot, 'apps/desktop/site-diagnostic.html');
const uiURL = pathToFileURL(uiPath).href;
const windowTitle = labEnabled ? 'OfferAgent · 飞书适配隔离实验室（先手动登录，不提交）' : 'OfferAgent · 独立只读诊断（请手动登录）';
const window = new BrowserWindow({
  title: windowTitle,
  width: 1400, height: 1000, minWidth: 900, minHeight: 700,
  webPreferences: { preload: join(projectRoot, 'apps/desktop/site-diagnostic-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
});
const view = new WebContentsView({ webPreferences: {
  partition: `site-diagnostic-${randomUUID()}`, sandbox: true, contextIsolation: true,
  nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false,
} });
window.contentView.addChildView(view);
const contents = view.webContents;
let selectedOrigin = '';
let generation = 0;
let reading = false;
let validating = false;
const validHTTPS = (raw: unknown): URL => {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('INVALID_HTTPS_URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('INVALID_HTTPS_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('INVALID_HTTPS_URL');
  return url;
};
const status = () => {
  let current: URL | undefined;
  try { current = new URL(contents.getURL()); } catch { /* Not navigated. */ }
  const pathname = current?.pathname || '';
  const pathCategory = /(?:login|signin|auth|sso|passport|oauth)/i.test(pathname) ? '登录或认证页'
    : /(?:apply|application|resume|candidate)/i.test(pathname) ? '申请或履历页'
    : /(?:position|job|career|campus)/i.test(pathname) ? '招聘页' : '其他页面';
  return { host: current?.protocol === 'https:' ? current.hostname : '', pathCategory, labEnabled, reading, validating,
    readable: Boolean(selectedOrigin && current?.origin === selectedOrigin && !contents.isLoadingMainFrame()) };
};
const resize = () => {
  const bounds = window.getContentBounds();
  view.setBounds({ x: 0, y: 150, width: bounds.width, height: Math.max(1, bounds.height - 150) });
};
resize(); window.on('resize', resize);
contents.session.setPermissionCheckHandler(() => false);
contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
contents.session.on('will-download', event => event.preventDefault());
contents.setWindowOpenHandler(({ url }) => {
  try { void contents.loadURL(validHTTPS(url).href).catch(() => {}); } catch { /* Unsupported schemes stay blocked. */ }
  return { action: 'deny' };
});
contents.on('will-navigate', (event, url) => { try { validHTTPS(url); } catch { event.preventDefault(); } });
contents.on('will-redirect', (event, url) => { try { validHTTPS(url); } catch { event.preventDefault(); } });
contents.on('will-frame-navigate', event => { try { validHTTPS(event.url); } catch { event.preventDefault(); } });
contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) generation++; });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', (event, url) => { if (url !== uiURL) event.preventDefault(); });
window.on('page-title-updated', event => event.preventDefault());

function authorized(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiURL) {
    throw new Error('SITE_DIAGNOSTIC_UI_ONLY');
  }
}
ipcMain.handle('site-diagnostic:status', event => { authorized(event); return status(); });
ipcMain.handle('site-diagnostic:navigate', async (event, raw) => {
  authorized(event);
  if (reading || validating) throw new Error('SITE_DIAGNOSTIC_OPERATION_PENDING');
  const url = validHTTPS(raw);
  selectedOrigin = url.origin;
  try { await contents.loadURL(url.href); } catch { /* No provider/page exception crosses IPC. */ }
  return status();
});
ipcMain.handle('site-diagnostic:read', async event => {
  authorized(event);
  if (reading || validating || !status().readable) throw new Error('SITE_DIAGNOSTIC_NOT_READY');
  reading = true;
  const originalGeneration = generation;
  try {
    // Every untrusted value is discarded or classified inside this fixed reader.
    const report = await contents.executeJavaScript(siteDiagnosticScript(selectedOrigin));
    if (originalGeneration !== generation || !status().readable || report?.kind !== 'feishu-static-controls-only'
      || !Array.isArray(report.fields) || !Array.isArray(report.sections) || !Array.isArray(report.addControls)) {
      throw new Error('SITE_DIAGNOSTIC_PAGE_CHANGED');
    }
    const encoded = JSON.stringify(report, null, 2);
    if (encoded.length > 2_000_000) throw new Error('SITE_DIAGNOSTIC_REPORT_TOO_LARGE');
    const reportPath = join(directory, `structure-${randomUUID()}.json`);
    await writeFile(reportPath, encoded, { mode: 0o600, flag: 'wx' });
    return { status: status(), reportPath, fieldCount: report.fields.length, sectionCount: report.sections.length, addControlCount: report.addControls.length };
  } catch { throw new Error('SITE_DIAGNOSTIC_READ_INCOMPLETE'); }
  finally { reading = false; }
});
ipcMain.handle('site-diagnostic:validate', async event => {
  authorized(event);
  if (!labEnabled || reading || validating || !status().readable
    || selectedOrigin !== 'https://modelbest.jobs.feishu.cn'
    || validHTTPS(contents.getURL()).origin !== 'https://modelbest.jobs.feishu.cn') {
    throw new Error('SITE_ADAPTER_LAB_NOT_READY');
  }
  validating = true;
  try {
    const modulePath = join(projectRoot, 'dist/desktop/feishu-site-lab.js');
    try { await access(modulePath); } catch { return { ok: false, status: 'runner-not-ready', reportPath: '' }; }
    // A fixed local module is loaded only after the user explicitly clicks the
    // lab button. Its runner installs network protection before any native action.
    const module = await import(pathToFileURL(modulePath).href);
    if (typeof module.runFeishuSiteLab !== 'function') return { ok: false, status: 'runner-not-ready', reportPath: '' };
    const response = await module.runFeishuSiteLab({ window, view, directory, getGeneration: () => generation });
    const statusCode = typeof response?.status === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(response.status)
      ? response.status : 'validation-incomplete';
    const reportPath = typeof response?.reportPath === 'string' && response.reportPath.startsWith(directory + sep)
      && resolve(response.reportPath) === response.reportPath && response.reportPath.endsWith('.json') ? response.reportPath : '';
    return { ok: response?.ok === true, status: statusCode, reportPath };
  } catch { return { ok: false, status: 'validation-incomplete', reportPath: '' }; }
  finally { validating = false; }
});
window.on('closed', () => { if (!contents.isDestroyed()) contents.close(); });
app.on('window-all-closed', () => app.quit());
await window.loadFile(uiPath);
window.setTitle(windowTitle);
