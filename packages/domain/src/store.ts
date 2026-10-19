import { createHash, randomUUID } from "node:crypto";
import type { Database } from "sql.js";
import type {
  ActionRecord, Application, ApplicationInput, AppSettings, AppState, CareerCollection, Job, JobInput, Profile, ProfileInput, SourceRun,
} from "../../shared/src/contracts.js";
import { careerCollections, confirmCareer, emptyCareer, migrateLegacyProfile, profileCareerOnSave, projectPrimaryEducation } from "./career.js";
import { matchJob } from "./matching.js";
import { deleteDocument, openDatabaseFile, readDocument, readDocuments, writeDocument } from "./sqlite.js";
import { createApplicationAssetsStore, removeApplicationAssets, type ApplicationAssetsStore } from './application-assets.js';
import { createApplicationWorkflowStore, removeApplicationWorkflows, type ApplicationWorkflowStore } from './application-workflow.js';
import { createDiscoveryStore, type DiscoveryStore } from './discovery-store.js';
import type { DiscoveryReport, DiscoveryResult } from '../../shared/src/discovery.js';
import { validateDiscoverySource } from '../../sources/src/discovery-catalog.js';
import {
  actionRecordSchema, actionStatusSchema, normalizeApplication, normalizeJob, normalizeProfile,
  normalizeSourceRun, validIdentifier, validTimestamp, validated, validatedJSON,
} from "./validation.js";

export interface DomainStore {
  readonly databasePath: string;
  readonly assets: ApplicationAssetsStore;
  readonly workflow: ApplicationWorkflowStore;
  readonly discovery: DiscoveryStore;
  getState(): Promise<AppState>;
  saveProfile(input: ProfileInput, expectedVersion?: number): Promise<AppState>;
  confirmCareerRecord(collection: CareerCollection, recordId: string, expectedVersion: number, expectedRevision: number): Promise<AppState>;
  saveJob(input: JobInput): Promise<AppState>;
  upsertJobs(inputs: JobInput[]): Promise<AppState>;
  importCollectedJobs(inputs: JobInput[], run: SourceRun): Promise<AppState>;
  importDiscoveryResult(result: DiscoveryResult): Promise<AppState>;
  deleteJob(id: string): Promise<AppState>;
  saveApplication(input: ApplicationInput): Promise<AppState>;
  trackJob(jobId: string): Promise<AppState>;
  deleteApplication(id: string): Promise<AppState>;
  loadDemo(): Promise<AppState>;
  clearDemo(): Promise<AppState>;
  recordSourceRun(run: SourceRun): Promise<AppState>;
  recordAction(action: ActionRecord): Promise<void>;
  updateAction(id: string, status: ActionRecord["status"], result: unknown): Promise<void>;
  getActions(): Promise<ActionRecord[]>;
  exportState(): Promise<AppState>;
  close(): Promise<void>;
}

function emptyProfile(now: string): Profile {
  return {
    fullName: "", fullNameEn: "", email: "", phone: "", school: "", schoolEn: "", degree: "",
    major: "", majorEn: "", graduationMonth: "", skills: [], cities: [],
    targetRoles: ["大模型", "算法", "AI"], resumeText: "", career: emptyCareer(), version: 0, updatedAt: now,
  };
}

function profileIn(db: Database): Profile {
  const profile = readDocument<Profile>(db, "profile", "current");
  if (!profile) throw new Error("个人资料记录缺失");
  return profile;
}

function stateIn(db: Database): AppState {
  const profile = profileIn(db);
  const now = new Date();
  const jobs = readDocuments<Job>(db, "job")
    .map(job => ({ ...job, match: matchJob(profile, job, now) }))
    .sort((a, b) => b.match.score - a.match.score || b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));
  return {
    profile, jobs,
    applications: readDocuments<Application>(db, "application").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    sourceRuns: readDocuments<SourceRun>(db, "source_run").sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
    settings: readDocument<AppSettings>(db, "settings", "current") ?? { showDemo: false },
  };
}

function putProfile(db: Database, next: Profile, now: string): void {
  writeDocument(db, "profile_version", String(next.version), next, now);
  writeDocument(db, "profile", "current", next, now);
  for (const job of readDocuments<Job>(db, "job")) writeDocument(db, "job", job.id, { ...job, match: matchJob(next, job) }, now);
}

function putJob(db: Database, input: JobInput, now: string, detailEvidence?: Job['detailEvidence']): Job {
  const all = readDocuments<Job>(db, "job");
  const sameURL = all.find(job => job.sourceId === input.sourceId && job.url === input.url && job.demo === input.demo);
  const explicit = input.id ? readDocument<Job>(db, "job", input.id) : undefined;
  if (explicit && sameURL && explicit.id !== sameURL.id) throw new Error("岗位 ID 与已存在的来源链接冲突");
  if (explicit && explicit.demo !== input.demo) throw new Error("不能把演示岗位改成真实岗位或反向覆盖");
  const previous = explicit ?? sameURL;
  const id = previous?.id ?? input.id ?? createHash("sha256")
    .update(`${input.sourceId}\n${input.url}\n${input.demo ? "demo" : "real"}`).digest("hex").slice(0, 32);
  const job: Job = {
    ...input, id, observedAt: input.observedAt ?? now, firstSeenAt: previous?.firstSeenAt ?? now,
    match: matchJob(profileIn(db), input),
    ...(detailEvidence ? { detailEvidence } : previous?.detailEvidence && previous.sourceId === input.sourceId && previous.url === input.url && previous.detailEvidence.url === input.url && previous.description === input.description && previous.requirements === input.requirements ? { detailEvidence: previous.detailEvidence } : {}),
  };
  writeDocument(db, "job", id, job, now);
  return job;
}

function putSourceRun(db: Database, run: SourceRun, now: string): void {
  if (readDocument(db, "source_run", run.id)) throw new Error("采集记录 ID 已存在");
  writeDocument(db, "source_run", run.id, run, now);
  const all = readDocuments<SourceRun>(db, "source_run").sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  for (const old of all.slice(30)) deleteDocument(db, "source_run", old.id);
}

function jobContent(input: JobInput): string {
  const { id, observedAt, ...facts } = input;
  // Key order is not evidence of a content change.
  return JSON.stringify(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeCollectedJobs(inputs: JobInput[], inputRun: SourceRun): { jobs: JobInput[]; run: SourceRun } {
  if (!Array.isArray(inputs) || inputs.length > 1000) throw new TypeError('采集批次必须是最多1000条岗位的数组');
  const jobs = inputs.map(normalizeJob), run = normalizeSourceRun(inputRun);
  if (!run.report || run.count !== jobs.length) throw new TypeError('采集批次必须绑定一致的范围报告');
  const origin = new URL(run.report.scope.listURL).origin;
  if (jobs.some(job => job.sourceId !== run.sourceId || new URL(job.url).origin !== origin || job.demo)) throw new TypeError('采集岗位必须属于报告的真实来源与同源地址');
  const keys = jobs.map(job => `${job.sourceId}|${job.url}`);
  if (new Set(keys).size !== keys.length) throw new TypeError('采集批次存在重复岗位链接');
  if (run.report.detailResults?.some(item => !jobs.some(job => job.url === item.jobURL))) throw new TypeError('详情结果没有对应的本次列表岗位');
  return { jobs, run };
}

function putCollectedJobs(db: Database, jobs: JobInput[], run: SourceRun, now: string): void {
  let newCount = 0, updatedCount = 0;
  const completedDetails = new Set(run.report!.detailResults?.filter(item => item.status === 'success').map(item => item.jobURL) ?? []);
  for (const input of jobs) {
    const sameId = input.id ? readDocument<Job>(db, 'job', input.id) : undefined;
    if (sameId && (sameId.sourceId !== input.sourceId || sameId.url !== input.url)) throw new TypeError('采集岗位 ID 不能覆盖另一来源或链接');
    const old = readDocuments<Job>(db, 'job').find(job => job.sourceId === input.sourceId && job.url === input.url && job.demo === input.demo);
    const observed = old ? { ...input, publishedAt: input.publishedAt ?? old.publishedAt, deadline: input.deadline ?? old.deadline } : input;
    const next = old?.detailEvidence && old.detailEvidence.url === old.url && !completedDetails.has(input.url) ? { ...observed, description: old.description, requirements: old.requirements } : observed;
    if (!old) newCount++;
    else {
      const { firstSeenAt, match, detailEvidence, ...oldInput } = old;
      if (jobContent(oldInput) !== jobContent(next)) updatedCount++;
    }
    putJob(db, next, now, completedDetails.has(input.url) ? { url: input.url, checkedAt: run.observedAt } : undefined);
  }
  putSourceRun(db, normalizeSourceRun({ ...run, report: { ...run.report!, newCount, updatedCount } }), now);
}

function putApplication(db: Database, input: ApplicationInput, now: string, forceDemo?: boolean): Application {
  const all = readDocuments<Application>(db, "application");
  const explicit = input.id ? readDocument<Application>(db, "application", input.id) : undefined;
  const same = input.jobId
    ? all.find(application => application.jobId === input.jobId)
    : all.find(application => application.company === input.company && application.title === input.title && application.url === input.url);
  if (explicit && same && explicit.id !== same.id) throw new Error("该岗位已有关联申请记录，请更新现有记录");
  const previous = explicit ?? same;
  const jobId = input.jobId ?? previous?.jobId;
  const job = jobId ? readDocument<Job>(db, "job", jobId) : undefined;
  if (input.jobId && !job && previous?.jobId !== input.jobId) throw new Error("关联岗位不存在");
  const id = previous?.id ?? input.id ?? randomUUID();
  const demo = forceDemo ?? job?.demo ?? previous?.demo ?? false;
  if (previous && previous.demo !== demo) throw new Error("不能用演示申请覆盖真实申请");
  const changed = !previous || previous.status !== input.status || previous.notes !== input.notes ||
    previous.company !== input.company || previous.title !== input.title || previous.url !== input.url ||
    previous.deadline !== input.deadline || previous.jobId !== jobId;
  const history = previous?.history ? [...previous.history] : [];
  if (changed) {
    const event = { at: now, status: input.status, note: input.notes || (previous ? "更新申请信息" : "创建申请记录") };
    history.push(event);
    writeDocument(db, "application_history", `${id}:${history.length}`, { applicationId: id, ...event }, now);
  }
  const application: Application = {
    ...input, ...(jobId ? { jobId } : {}), id, demo,
    createdAt: previous?.createdAt ?? now, updatedAt: changed ? now : previous?.updatedAt ?? now, history,
  };
  writeDocument(db, "application", id, application, now);
  return application;
}

function removeApplication(db: Database, id: string): void {
  removeApplicationAssets(db, id);
  removeApplicationWorkflows(db, id);
  deleteDocument(db, "application", id);
  const records = readDocuments<{ applicationId: string } & Record<string, unknown>>(db, "application_history");
  // History ids use the exact application id plus an index; bind parameters keep ids out of SQL syntax.
  if (records.some(record => record.applicationId === id)) {
    const statement = db.prepare("SELECT id, payload FROM documents WHERE kind = 'application_history'");
    const ids: string[] = [];
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        if (typeof row.payload === "string" && typeof row.id === "string" &&
            (JSON.parse(row.payload) as { applicationId: string }).applicationId === id) ids.push(row.id);
      }
    } finally { statement.free(); }
    for (const historyId of ids) deleteDocument(db, "application_history", historyId);
  }
}

const demoJobInputs: JobInput[] = [
  {
    id: "demo-hangzhou-llm", company: "演示企业 A（虚构）", title: "大模型算法校招工程师（虚构）", city: "杭州",
    type: "campus", description: "本地虚构示例：研究大模型应用与检索增强。", requirements: "示例要求：2027届，硕士及以上，Python、PyTorch、RAG。",
    url: "https://example.invalid/campus/hangzhou-llm", sourceId: "demo", sourceName: "本地虚构演示数据",
    publishedAt: null, deadline: null, demo: true,
  },
  {
    id: "demo-beijing-ai", company: "演示企业 B（虚构）", title: "AI 算法研究校招工程师（虚构）", city: "北京",
    type: "campus", description: "本地虚构示例：机器学习与智能体算法。", requirements: "示例要求：2027届，本科及以上，Python。",
    url: "https://example.invalid/campus/beijing-ai", sourceId: "demo", sourceName: "本地虚构演示数据",
    publishedAt: null, deadline: null, demo: true,
  },
  {
    id: "demo-shenzhen-intern", company: "演示企业 C（虚构）", title: "大模型应用实习生（虚构）", city: "深圳",
    type: "internship", description: "本地虚构示例：使用大模型进行应用开发。", requirements: "示例技能：Python、RAG。",
    url: "https://example.invalid/internship/shenzhen", sourceId: "demo", sourceName: "本地虚构演示数据",
    publishedAt: null, deadline: null, demo: true,
  },
];

export async function createStore(options: { directory: string }): Promise<DomainStore> {
  const file = await openDatabaseFile(options);
  try {
    await file.transact(db => {
      const now = new Date().toISOString();
      if (!readDocument(db, "profile", "current")) writeDocument(db, "profile", "current", emptyProfile(now), now);
      const profile = profileIn(db);
      if (!profile.career) writeDocument(db, "profile", "current", migrateLegacyProfile(profile), profile.updatedAt);
      if (!readDocument(db, "settings", "current")) writeDocument(db, "settings", "current", { showDemo: false }, now);
      for (const action of readDocuments<ActionRecord>(db, "action")) {
        if (action.status === "intent") writeDocument(db, "action", action.id, {
          ...action, status: "unknown", updatedAt: now,
          result: { reason: "上次操作没有持久化验证结果；需重新核实页面，不会自动重放" },
        }, now);
      }
    });
  } catch (error) {
    await file.close();
    throw error;
  }

  const mutation = (operation: (db: Database, now: string) => void): Promise<AppState> =>
    file.transact(db => { operation(db, new Date().toISOString()); return stateIn(db); });

  return {
    databasePath: file.path,
    assets: createApplicationAssetsStore(file),
    workflow: createApplicationWorkflowStore(file),
    discovery: createDiscoveryStore(file),
    getState: () => file.read(stateIn),
    exportState: () => file.read(stateIn),
    close: () => file.close(),
    async saveProfile(input, expectedVersion) {
      const profile = normalizeProfile(input);
      if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
        throw new TypeError("expectedVersion 必须是有效的资料版本号");
      }
      return mutation((db, now) => {
        const old = profileIn(db);
        if (expectedVersion !== undefined && old.version !== expectedVersion) throw new Error("资料已被更新，请刷新后再保存");
        const next: Profile = { ...profileCareerOnSave(profile, old, now), version: old.version + 1, updatedAt: now };
        putProfile(db, next, now);
      });
    },
    async confirmCareerRecord(collection, recordId, expectedVersion, expectedRevision) {
      if (!careerCollections.includes(collection)) throw new TypeError("履历类型无效");
      const id = validIdentifier(recordId, "履历记录 ID");
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new TypeError("确认履历必须提供有效的资料版本与修订号");
      }
      return mutation((db, now) => {
        const old = profileIn(db);
        if (old.version !== expectedVersion) throw new Error("资料已被更新，请刷新后再确认");
        const career = confirmCareer(old.career ?? migrateLegacyProfile(old).career!, collection, id, expectedRevision, now);
        const next: Profile = { ...projectPrimaryEducation(old, career), version: old.version + 1, updatedAt: now };
        putProfile(db, next, now);
      });
    },
    async saveJob(input) {
      const job = normalizeJob(input);
      return mutation((db, now) => { putJob(db, job, now); });
    },
    async upsertJobs(inputs) {
      if (!Array.isArray(inputs) || inputs.length > 10_000) return Promise.reject(new TypeError("岗位批次必须是数组，且不超过10000条"));
      const jobs = inputs.map(normalizeJob);
      return mutation((db, now) => { for (const job of jobs) putJob(db, job, now); });
    },
    async importCollectedJobs(inputs, inputRun) {
      const { jobs, run } = normalizeCollectedJobs(inputs, inputRun);
      return mutation((db, now) => putCollectedJobs(db, jobs, run, now));
    },
    async importDiscoveryResult(input) {
      if (!input || !Array.isArray(input.collections) || input.collections.length > 8 || !Array.isArray(input.jobs) || !Array.isArray(input.matches)) throw new TypeError('自动发现缺少可核对的来源批次。');
      const report = validatedJSON(input.report, '自动发现范围报告') as DiscoveryReport;
      validIdentifier(report.id, '自动发现记录 ID'); validTimestamp(report.startedAt, '开始时间'); validTimestamp(report.finishedAt, '结束时间');
      if (Date.parse(report.finishedAt) < Date.parse(report.startedAt) || !['success', 'partial', 'failed', 'cancelled'].includes(report.status)
        || !report.plan || !Number.isSafeInteger(report.plan.profileVersion) || report.plan.profileVersion < 1
        || !Array.isArray(report.sources) || report.sources.length > 60 || new Set(report.sources.map(source => source.sourceId)).size !== report.sources.length
        || report.uniqueJobs !== input.jobs.length || report.completeDetails !== input.matches.filter(match => match.detailComplete).length) throw new TypeError('自动发现报告的版本、范围或数量不一致。');
      const batches = input.collections.map(collection => {
        const source = collection.source, detail = report.sources.find(item => item.sourceId === source.id);
        if (!detail || detail.status === 'skipped' || !collection.result || detail.matchedCount !== collection.result.jobs.length
          || source.url !== detail.url || source.name !== detail.name || source.mode !== 'public-api') throw new TypeError('自动发现批次与来源报告不一致。');
        validateDiscoverySource({ id: source.id, provider: detail.provider, company: source.company, name: source.name, url: source.url, enabled: true });
        if (detail.provider === 'candidate') throw new TypeError('候选入口不能伪造采集结果。');
        const message = collection.result.report.errors.map(item => item.message).join('；').slice(0, 5000);
        const batch = normalizeCollectedJobs(collection.result.jobs, { id: `${report.id}:${source.id}`, sourceId: source.id, sourceName: source.name,
          status: collection.result.report.status, count: collection.result.jobs.length, observedAt: report.finishedAt, report: collection.result.report,
          ...(message ? { error: message } : collection.result.report.status === 'failed' ? { error: '本轮来源未完成，请查看采集范围。' } : {}) });
        if (batch.jobs.some(job => !job.id || !detail.jobIds.includes(job.id) || !batch.run.report!.detailResults?.some(item => item.jobURL === job.url && item.status === 'success'))) throw new TypeError('自动发现岗位没有本轮完整正文核对结果。');
        return batch;
      });
      const flattened = batches.flatMap(batch => batch.jobs);
      if (new Set(batches.map(batch => batch.run.sourceId)).size !== batches.length || flattened.length !== input.jobs.length
        || new Set(flattened.map(job => job.id)).size !== flattened.length || input.matches.length !== flattened.length
        || flattened.some(job => !input.jobs.some(item => item.id === job.id && item.url === job.url && jobContent(normalizeJob(item)) === jobContent(job))
          || !input.matches.some(item => item.jobId === job.id && item.url === job.url && item.detailComplete))) throw new TypeError('自动发现的整轮岗位与逐来源批次不一致。');
      return mutation((db, now) => {
        if (profileIn(db).version !== report.plan.profileVersion) throw new Error('资料在采集期间变化，未导入旧资料对应的推荐结果。');
        if (readDocument(db, 'discovery_run', report.id)) throw new Error('自动发现记录 ID 已存在。');
        for (const { jobs, run } of batches) putCollectedJobs(db, jobs, run, now);
        // Source+URL deduplication preserves an existing job's ID. Bind the
        // stored report to those final IDs so chat-driven results reopen too.
        const savedJobs = readDocuments<Job>(db, 'job');
        for (const source of report.sources) {
          source.jobIds = input.jobs.filter(job => job.sourceId === source.sourceId).map(job =>
            savedJobs.find(saved => saved.sourceId === job.sourceId && saved.url === job.url && !saved.demo)?.id).filter((id): id is string => !!id);
        }
        writeDocument(db, 'discovery_run', report.id, report, report.finishedAt);
        const runs = readDocuments<DiscoveryReport>(db, 'discovery_run').sort((left, right) => right.startedAt.localeCompare(left.startedAt));
        for (const previous of runs.slice(20)) deleteDocument(db, 'discovery_run', previous.id);
      });
    },
    async deleteJob(id) {
      const key = validIdentifier(id);
      // Applications retain their own company/title/status snapshot and history if a job is removed.
      return mutation(db => { deleteDocument(db, "job", key); });
    },
    async saveApplication(input) {
      const application = normalizeApplication(input);
      return mutation((db, now) => { putApplication(db, application, now); });
    },
    async trackJob(jobId) {
      const key = validIdentifier(jobId, "岗位 ID");
      return mutation((db, now) => {
        const job = readDocument<Job>(db, "job", key);
        const existing = readDocuments<Application>(db, "application").find(application => application.jobId === key);
        // Read and decide in the same serialized SQLite transaction, never from a caller's snapshot.
        if (existing) return;
        if (!job) throw new Error("岗位不存在，无法加入追踪");
        putApplication(db, {
          jobId: job.id, company: job.company, title: job.title, url: job.url,
          status: "saved", deadline: job.deadline, notes: "",
        }, now);
      });
    },
    async deleteApplication(id) {
      const key = validIdentifier(id);
      return mutation(db => { removeApplication(db, key); });
    },
    loadDemo() {
      return mutation((db, now) => {
        for (const input of demoJobInputs) {
          const previous = readDocument<Job>(db, "job", input.id!);
          if (previous && !previous.demo) continue;
          const job = putJob(db, normalizeJob(input), now);
          const id = `application-${job.id}`;
          if (!readDocument<Application>(db, "application", id)) putApplication(db, {
            id, jobId: job.id, company: job.company, title: job.title, url: job.url,
            status: job.id === "demo-beijing-ai" ? "assessment" : "saved", deadline: null,
            notes: "虚构申请记录，只用于体验看板；没有真实投递。",
          }, now, true);
        }
        writeDocument(db, "settings", "current", { showDemo: true }, now);
      });
    },
    clearDemo() {
      return mutation((db, now) => {
        for (const job of readDocuments<Job>(db, "job")) if (job.demo) deleteDocument(db, "job", job.id);
        for (const application of readDocuments<Application>(db, "application")) if (application.demo) removeApplication(db, application.id);
        for (const run of readDocuments<SourceRun>(db, "source_run")) if (run.sourceId === "demo") deleteDocument(db, "source_run", run.id);
        writeDocument(db, "settings", "current", { showDemo: false }, now);
      });
    },
    async recordSourceRun(input) {
      const run = normalizeSourceRun(input);
      return mutation((db, now) => { putSourceRun(db, run, now); });
    },
    async recordAction(input) {
      const action = validated(actionRecordSchema, input, "动作记录") as ActionRecord;
      validTimestamp(action.createdAt, "动作创建时间"); validTimestamp(action.updatedAt, "动作更新时间");
      if (action.status !== "intent") throw new Error("新动作必须从 intent 开始");
      action.payload = validatedJSON(action.payload, "动作内容");
      if (action.result !== undefined) action.result = validatedJSON(action.result, "动作结果");
      return file.transact(db => {
        if (readDocument(db, "action", action.id)) throw new Error("动作 ID 已存在，不能覆盖操作日志");
        writeDocument(db, "action", action.id, action, action.updatedAt);
      });
    },
    async updateAction(id, status, result) {
      const key = validIdentifier(id), nextStatus = validated(actionStatusSchema, status, "动作状态");
      const outcome = validatedJSON(result, "动作结果");
      if (nextStatus === "intent") throw new Error("不能把已记录动作恢复为未执行意图");
      return file.transact(db => {
        const old = readDocument<ActionRecord>(db, "action", key);
        if (!old) throw new Error("动作记录不存在");
        if (old.status === "verified") throw new Error("已验证动作不能再次更新或执行");
        const now = new Date().toISOString();
        const next: ActionRecord = { ...old, status: nextStatus, result: outcome, updatedAt: now };
        writeDocument(db, "action", key, next, now);
        writeDocument(db, "action_history", `${key}:${randomUUID()}`, next, now);
      });
    },
    getActions: () => file.read(db => readDocuments<ActionRecord>(db, "action")),
  };
}
