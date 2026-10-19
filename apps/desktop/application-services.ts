import { dialog, type BrowserWindow } from 'electron';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent, AppState } from '../../packages/shared/src/contracts.js';
import type { ResumeVersionImport } from '../../packages/shared/src/application-assets.js';
import type { DiscoveryOptions, DiscoveryResult } from '../../packages/shared/src/discovery.js';
import { discoverJobs } from '../../packages/sources/src/discovery.js';
import { buildApplicationFactsPreview, applyApplicationFactsSelection, exportApplicationFactsTemplate, type ApplicationFactsPreview } from '../../packages/profile/src/application-facts.js';

const LIMIT = 20 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Read a user-selected regular file once; all later paths come from host UUIDs. */
async function readResumeFile(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 4 || info.size > LIMIT) throw new Error('请选择20MB以内的PDF或DOCX文件。');
    const bytes = Buffer.alloc(info.size);
    let position = 0;
    while (position < bytes.length) {
      const next = await handle.read(bytes, position, bytes.length - position, position);
      if (!next.bytesRead) throw new Error('简历文件在读取期间变化，请重试。'); position += next.bytesRead;
    }
    if ((await handle.stat()).size !== bytes.length) throw new Error('简历文件在读取期间变化，请重试。');
    return bytes;
  } finally { await handle.close(); }
}

export function createApplicationServices(options: {
  store: DomainStore; window: BrowserWindow; stateDirectory: string;
  send: (event: AppEvent) => void; publishState: (state: AppState) => AppState;
  assertIdle: () => void; withCollection: <T>(work: () => Promise<T>) => Promise<T>;
  onDiscovery?: (state: AppState, result: DiscoveryResult) => void | Promise<void>;
}) {
  const { store, window, send, stateDirectory } = options;
  let discoveryController: AbortController | undefined;
  let discoveryTask: Promise<DiscoveryResult> | undefined;
  let applicationFactsPreview: { preview: ApplicationFactsPreview; createdAt: number } | undefined;
  const assets = async <T extends Promise<unknown>>(work: T) => {
    const result = await work; send({ type: 'application-assets', state: await store.assets.getState() }); return result;
  };
  const methods: Record<string, (...args: any[]) => Promise<any>> = {
    importApplicationFacts: async () => {
      options.assertIdle();
      applicationFactsPreview = undefined;
      const choice = await dialog.showOpenDialog(window, { title: '导入网申履历补充资料（先预览）', properties: ['openFile'], filters: [{ name: '网申履历 JSON', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
      options.assertIdle();
      const handle = await open(choice.filePaths[0], 'r'); let bytes: Buffer;
      try {
        const info = await handle.stat(); if (!info.isFile() || info.size > 500_000) throw new Error('请选择500KB以内的履历补充JSON。');
        bytes = Buffer.alloc(info.size); let at = 0;
        while (at < bytes.length) { const next = await handle.read(bytes, at, bytes.length - at, at); if (!next.bytesRead) throw new Error('导入文件在读取期间变化。'); at += next.bytesRead; }
        if ((await handle.stat()).size !== bytes.length) throw new Error('导入文件在读取期间变化。');
      } finally { await handle.close(); }
      options.assertIdle();
      const fileName = basename(choice.filePaths[0]), preview = buildApplicationFactsPreview(bytes, (await store.getState()).profile, { fileName });
      applicationFactsPreview = { preview, createdAt: Date.now() };
      return { cancelled: false, fileName, preview };
    },
    applyApplicationFactsImport: async (id, selectedIds, version) => {
      options.assertIdle();
      const entry = applicationFactsPreview;
      if (!entry || typeof id !== 'string' || id !== entry.preview.id || Date.now() - entry.createdAt > 15 * 60_000) throw new Error('导入预览已过期，请重新选择文件。');
      const profile = (await store.getState()).profile;
      if (version !== profile.version || entry.preview.profileVersion !== version) throw new Error('个人资料已更新，请重新导入并核对差异。');
      const draft = applyApplicationFactsSelection(entry.preview, profile, selectedIds);
      applicationFactsPreview = undefined; return draft;
    },
    exportApplicationFactsTemplate: async () => {
      options.assertIdle();
      const choice = await dialog.showSaveDialog(window, { title: '下载空白网申履历填写模板', defaultPath: 'OfferAgent-网申履历模板.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      await writeFile(choice.filePath, exportApplicationFactsTemplate(), { mode: 0o600 }); return { cancelled: false, path: choice.filePath };
    },
    workflowState: () => store.workflow.workflowState(),
    setApplicationIssueStatus: async input => {
      options.assertIdle(); const state = await store.workflow.setApplicationIssueStatus(input);
      send({ type: 'application-workflow', state }); return state;
    },
    applicationAssets: () => store.assets.getState(),
    answerSuggestions: (question, applicationId) => store.assets.answerSuggestions(question, applicationId),
    saveAnswer: (input, revision) => { options.assertIdle(); return assets(store.assets.saveAnswer(input, revision)); },
    confirmAnswer: (id, revision, version) => { options.assertIdle(); return assets(store.assets.confirmAnswer(id, revision, version)); },
    deleteAnswer: (id, revision) => { options.assertIdle(); return assets(store.assets.deleteAnswer(id, revision)); },
    saveResumeVersion: (input, revision) => { options.assertIdle(); return assets(store.assets.saveResumeVersion(input, revision)); },
    selectApplicationResume: (applicationId, resumeId, revision) => { options.assertIdle(); return assets(store.assets.selectApplicationResume(applicationId, resumeId, revision)); },
    deleteResumeVersion: async (id, revision) => {
      options.assertIdle(); const previous = (await store.assets.getState()).resumeVersions.find(item => item.id === id);
      const state = await assets(store.assets.deleteResumeVersion(id, revision));
      if (previous) await rm(join(stateDirectory, 'resume-versions', previous.fileId), { force: true }).catch(() => {});
      return state;
    },
    importResumeVersion: async (input: ResumeVersionImport) => {
      options.assertIdle();
      if (!input || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 120
        || !Array.isArray(input.directions) || input.directions.length > 20 || input.directions.some(value => typeof value !== 'string' || value.length > 80)
        || typeof input.demo !== 'boolean' || Object.keys(input).some(key => !['label', 'directions', 'demo'].includes(key))) throw new Error('请填写版本名称和适用方向。');
      const choice = await dialog.showOpenDialog(window, { title: '保存一个简历版本（原文件保留）', properties: ['openFile'], filters: [{ name: '简历', extensions: ['pdf', 'docx'] }] });
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
      options.assertIdle(); const selected = choice.filePaths[0], extension = extname(selected).toLowerCase(), bytes = await readResumeFile(selected);
      if (!(extension === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-' || extension === '.docx' && bytes.subarray(0, 2).toString() === 'PK')) throw new Error('文件内容与PDF/DOCX格式不符，未保存版本。');
      const fileId = randomUUID(), folder = join(stateDirectory, 'resume-versions'), destination = join(folder, fileId);
      await mkdir(folder, { recursive: true, mode: 0o700 }); await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
      try {
        options.assertIdle();
        const state = await assets(store.assets.importResumeVersion({ ...input, fileId, fileName: basename(selected), sha256: digest(bytes), sizeBytes: bytes.length }));
        return { cancelled: false, state };
      } catch (error) { await rm(destination, { force: true }); throw error; }
    },
    exportResumeVersion: async id => {
      options.assertIdle(); const version = (await store.assets.getState()).resumeVersions.find(item => item.id === id);
      if (!version) throw new Error('简历版本不存在或当前不可见。');
      const bytes = await readFile(join(stateDirectory, 'resume-versions', version.fileId));
      if (bytes.length !== version.sizeBytes || digest(bytes) !== version.sha256) throw new Error('保存的简历文件已变化，请重新导入，未导出。');
      const choice = await dialog.showSaveDialog(window, { title: '导出所选简历版本', defaultPath: version.fileName });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      await writeFile(choice.filePath, bytes, { mode: 0o600 }); return { cancelled: false, path: choice.filePath };
    },
    saveCalendarEvent: (input, revision) => { options.assertIdle(); return assets(store.assets.saveCalendarEvent(input, revision)); },
    deleteCalendarEvent: (applicationId, id, revision) => { options.assertIdle(); return assets(store.assets.deleteCalendarEvent(applicationId, id, revision)); },
    exportApplicationCalendar: async applicationId => {
      options.assertIdle(); const content = await store.assets.exportCalendar(applicationId);
      const choice = await dialog.showSaveDialog(window, { title: '导出笔试与面试日历', defaultPath: 'OfferAgent-申请日历.ics', filters: [{ name: '日历', extensions: ['ics'] }] });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      await writeFile(choice.filePath, content, { mode: 0o600 }); return { cancelled: false, path: choice.filePath };
    },
    discoveryState: () => store.discovery.getState(),
    addDiscoverySource: async input => {
      options.assertIdle(); const source = await store.discovery.addSource(input);
      send({ type: 'discovery', state: await store.discovery.getState() }); return source;
    },
    discoverJobs: async (input: DiscoveryOptions = {}) => {
      options.assertIdle();
      if (discoveryTask) throw new Error('正在找岗位，请等待本轮报告。');
      discoveryController = new AbortController(); const signal = discoveryController.signal;
      discoveryTask = options.withCollection(async () => {
        const profile = (await store.getState()).profile, { sources } = await store.discovery.getState();
        const result = await discoverJobs(profile, sources, input, { signal });
        const saved = options.publishState(await store.importDiscoveryResult(result));
        const discovered = await store.discovery.getState();
        result.report = discovered.runs.find(run => run.id === result.report.id) ?? result.report;
        try { await options.onDiscovery?.(saved, result); }
        catch { send({ type: 'error', message: '岗位已保存，但聊天尚未同步本轮编号；可直接使用结果卡片继续。' }); }
        send({ type: 'discovery', state: discovered }); return result;
      });
      try { return await discoveryTask; } finally { discoveryTask = undefined; discoveryController = undefined; }
    },
    cancelDiscovery: async () => { discoveryController?.abort(); },
  };
  return { methods, async close() { applicationFactsPreview = undefined; discoveryController?.abort(); await discoveryTask?.catch(() => {}); } };
}
