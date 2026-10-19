import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BrowserWindow, WebContentsView } from 'electron';

export interface FeishuSiteLabContext {
  window: BrowserWindow;
  view: WebContentsView;
  directory: string;
  getGeneration: () => number;
}

const TARGET_ORIGIN = 'https://modelbest.jobs.feishu.cn';
function assertLabContext(context: FeishuSiteLabContext, generation?: number): void {
  if (!process.argv.includes('--site-diagnostic') || !process.argv.includes('--site-adapter-lab')
    || process.argv.includes('--smoke-test') || process.argv.includes('--live-product-check')
    || context.window.isDestroyed() || context.view.webContents.isDestroyed()) {
    throw new Error('SITE_ADAPTER_LAB_REQUIRED');
  }
  let url: URL;
  try { url = new URL(context.view.webContents.getURL()); } catch { throw new Error('SITE_ADAPTER_LAB_ORIGIN_REQUIRED'); }
  if (url.origin !== TARGET_ORIGIN || url.username || url.password) throw new Error('SITE_ADAPTER_LAB_ORIGIN_REQUIRED');
  if (generation !== undefined && context.getGeneration() !== generation) throw new Error('SITE_ADAPTER_LAB_PAGE_CHANGED');
}

/** Stable, fixed-path loader. Only local engine bytes choose the import version. */
export async function runFeishuSiteLab(context: FeishuSiteLabContext): Promise<unknown> {
  assertLabContext(context);
  const generation = context.getGeneration();
  const enginePath = join(dirname(fileURLToPath(import.meta.url)), 'feishu-site-lab-engine.js');
  let bytes: Buffer;
  try { bytes = await readFile(enginePath); }
  catch { return { ok: false, status: 'engine-not-ready', reportPath: '' }; }
  const version = createHash('sha256').update(bytes).digest('hex');
  assertLabContext(context, generation);
  const engineURL = pathToFileURL(enginePath);
  engineURL.searchParams.set('version', version);
  const engine = await import(engineURL.href);
  assertLabContext(context, generation);
  if (typeof engine.runFeishuSiteLabEngine !== 'function') return { ok: false, status: 'engine-not-ready', reportPath: '' };
  return engine.runFeishuSiteLabEngine(context);
}
