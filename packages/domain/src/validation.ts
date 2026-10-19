import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ApplicationInput, CareerInput, JobInput, ProfileInput, SourceRun } from "../../shared/src/contracts.js";
import { sourceCollectionReportSchema, sourceCollectionStatusSchema, validateCollectionReport } from "../../shared/src/source-collection.js";

const text = (maxLength = 200) => Type.String({ maxLength });
const identifier = Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$" });
const words = Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 100 });
const nullableDate = Type.Union([Type.Null(), Type.String({ maxLength: 40 })]);
const recruitmentType = Type.Union([
  Type.Literal("campus"), Type.Literal("internship"), Type.Literal("experienced"), Type.Literal("unknown"),
]);
export const applicationStatusSchema = Type.Union([
  Type.Literal("needs-review"), Type.Literal("saved"), Type.Literal("applied"), Type.Literal("assessment"), Type.Literal("interview"),
  Type.Literal("offer"), Type.Literal("rejected"), Type.Literal("withdrawn"),
]);
export const actionStatusSchema = Type.Union([
  Type.Literal("intent"), Type.Literal("verified"), Type.Literal("partial"), Type.Literal("unknown"),
]);

const evidence = Type.Array(Type.Object({
  field: text(80), sourceId: identifier, quote: Type.String({ minLength: 1, maxLength: 50_000 }),
  location: Type.String({ minLength: 1, maxLength: 1000 }), originalValue: text(50_000),
}, { additionalProperties: false }), { maxItems: 200 });
const record = { id: identifier, evidence, sourceNote: text(2000) };
const careerDate = text(10);
export const careerInputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  sources: Type.Array(Type.Object({
    id: identifier, kind: Type.Union([Type.Literal("manual"), Type.Literal("resume"), Type.Literal("legacy")]),
    label: Type.String({ minLength: 1, maxLength: 500 }), text: text(500_000),
    fileName: Type.Optional(text(500)), fileHash: Type.Optional(Type.String({ pattern: "^[a-fA-F0-9]{64}$" })),
  }, { additionalProperties: false }), { maxItems: 1000 }),
  educations: Type.Array(Type.Object({
    ...record, school: text(500), schoolEn: text(500), degree: text(100), major: text(500), majorEn: text(500),
    startDate: careerDate, endDate: careerDate, description: text(50_000),
  }, { additionalProperties: false }), { maxItems: 100 }),
  internships: Type.Array(Type.Object({
    ...record, organization: text(500), role: text(500), startDate: careerDate, endDate: careerDate,
    current: Type.Boolean(), description: text(50_000), technologies: words,
  }, { additionalProperties: false }), { maxItems: 200 }),
  projects: Type.Array(Type.Object({
    ...record, name: text(500), role: text(500), startDate: careerDate, endDate: careerDate,
    ongoing: Type.Boolean(), description: text(50_000), technologies: words, url: text(4096),
  }, { additionalProperties: false }), { maxItems: 200 }),
  publications: Type.Array(Type.Object({
    ...record, title: text(1000), authors: text(3000), venue: text(1000), publicationDate: careerDate,
    status: Type.Union([Type.Literal("published"), Type.Literal("accepted"), Type.Literal("preprint"),
      Type.Literal("submitted"), Type.Literal("in-progress")]), doi: text(500), url: text(4096),
  }, { additionalProperties: false }), { maxItems: 200 }),
  primaryEducationId: Type.Union([Type.Null(), identifier]),
}, { additionalProperties: false });

export const profileInputSchema = Type.Object({
  fullName: text(), fullNameEn: text(), email: text(254), phone: text(60),
  school: text(500), schoolEn: text(500), degree: text(100), major: text(500), majorEn: text(500),
  graduationMonth: text(7), skills: words, cities: words, targetRoles: words, resumeText: text(500_000),
  career: Type.Optional(careerInputSchema),
  acceptedRecruitmentTypes: Type.Optional(Type.Array(Type.Union([Type.Literal('campus'),Type.Literal('internship'),Type.Literal('experienced')]),{minItems:1,maxItems:3,uniqueItems:true})),
}, { additionalProperties: false });

export const jobInputSchema = Type.Object({
  id: Type.Optional(identifier), company: Type.String({ minLength: 1, maxLength: 250 }),
  title: Type.String({ minLength: 1, maxLength: 500 }), city: text(300), type: recruitmentType,
  description: text(100_000), requirements: text(100_000), url: Type.String({ minLength: 1, maxLength: 4096 }),
  sourceId: Type.String({ minLength: 1, maxLength: 160 }), sourceName: Type.String({ minLength: 1, maxLength: 250 }),
  observedAt: Type.Optional(text(40)), publishedAt: nullableDate, deadline: nullableDate, demo: Type.Boolean(),
}, { additionalProperties: false });

export const applicationInputSchema = Type.Object({
  id: Type.Optional(identifier), jobId: Type.Optional(identifier),
  company: Type.String({ minLength: 1, maxLength: 250 }), title: Type.String({ minLength: 1, maxLength: 500 }),
  url: text(4096), status: applicationStatusSchema, deadline: nullableDate, notes: text(50_000),
}, { additionalProperties: false });

export const sourceRunSchema = Type.Object({
  id: identifier, sourceId: Type.String({ minLength: 1, maxLength: 160 }),
  sourceName: Type.String({ minLength: 1, maxLength: 250 }),
  status: sourceCollectionStatusSchema,
  count: Type.Integer({ minimum: 0, maximum: 100_000 }), observedAt: text(40), error: Type.Optional(text(5000)),
  report: Type.Optional(sourceCollectionReportSchema),
}, { additionalProperties: false });

export const actionRecordSchema = Type.Object({
  id: identifier, planId: identifier, status: actionStatusSchema,
  createdAt: text(40), updatedAt: text(40), payload: Type.Unknown(), result: Type.Optional(Type.Unknown()),
}, { additionalProperties: false });

export function validated<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) throw new TypeError(`${label}字段缺失、格式有误或包含不允许的字段`);
  return structuredClone(value);
}

export function validIdentifier(value: unknown, label = "记录 ID"): string {
  return validated(identifier, value, label);
}

export function validDate(value: string | null, label: string): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) throw new TypeError(`${label}必须是 YYYY-MM-DD 或带时区的 ISO 日期时间`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const actual = new Date(Date.UTC(year, month - 1, day));
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() + 1 !== month || actual.getUTCDate() !== day ||
      !Number.isFinite(Date.parse(value))) throw new TypeError(`${label}不是有效日期`);
  return value;
}

export function validTimestamp(value: string, label: string): string {
  const checked = validDate(value, label);
  if (!checked || !checked.includes("T")) throw new TypeError(`${label}必须包含时间与时区`);
  return checked;
}

export function normalizeURL(value: string, allowEmpty = false): string {
  if (allowEmpty && value.trim() === "") return "";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new TypeError("岗位链接必须是有效的 http/https 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new TypeError("链接必须使用 http/https，且不能包含登录凭据");
  }
  for (const name of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(name) || ["gclid", "fbclid"].includes(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  // Preserve hash routes: many enterprise ATS pages encode the job id in the fragment.
  return url.href;
}

function uniqueWords(values: string[]): string[] {
  return [...new Map(values.map(value => [value.trim().toLocaleLowerCase(), value.trim()])).values()]
    .filter(Boolean);
}

export function normalizeProfile(value: unknown): ProfileInput {
  const input = validated(profileInputSchema, value, "个人资料");
  const profile = Object.fromEntries(Object.entries(input).map(([key, entry]) =>
    [key, key === "career" ? normalizeCareer(entry) : Array.isArray(entry) ? uniqueWords(entry) : (entry as string).trim()])) as unknown as ProfileInput;
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new TypeError("邮箱格式有误");
  if (profile.graduationMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(profile.graduationMonth)) {
    throw new TypeError("毕业时间必须是 YYYY-MM，或留空待确认");
  }
  return profile;
}

/** Keep the precision the user supplied; a year is never completed with a guessed month. */
export function validCareerDate(value: string, label: string): string {
  if (!value) return "";
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match || Number(match[1]) < 1) throw new TypeError(`${label}必须是 YYYY、YYYY-MM 或 YYYY-MM-DD，或留空`);
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) throw new TypeError(`${label}不是有效日期`);
  if (match[3]) validDate(value, label);
  return value;
}

export function normalizeCareer(value: unknown): CareerInput {
  const input = validated(careerInputSchema, value, "履历");
  const result = structuredClone(input) as CareerInput;
  const ids = new Set<string>();
  for (const source of result.sources) {
    if (ids.has(source.id)) throw new TypeError("履历来源 ID 不能重复");
    ids.add(source.id); source.label = source.label.trim();
    if (!source.label) throw new TypeError("履历来源名称不能为空");
    if (source.fileName !== undefined) source.fileName = source.fileName.trim();
    if (source.fileHash !== undefined) source.fileHash = source.fileHash.toLowerCase();
    if (source.kind === "resume" && (!source.fileName || !source.fileHash)) throw new TypeError("简历来源必须记录文件名与文件 hash");
  }
  ids.clear();
  for (const collection of ["educations", "internships", "projects", "publications"] as const) {
    for (const record of result[collection]) {
      if (ids.has(record.id)) throw new TypeError("履历记录 ID 不能重复");
      ids.add(record.id);
      for (const [key, entry] of Object.entries(record)) {
        if (typeof entry === "string" && key !== "id") (record as unknown as Record<string, unknown>)[key] = entry.trim();
      }
      if ("technologies" in record) record.technologies = uniqueWords(record.technologies);
      if ("url" in record) record.url = normalizeURL(record.url, true);
      if ("publicationDate" in record) validCareerDate(record.publicationDate, "发表日期");
      if ("startDate" in record) {
        validCareerDate(record.startDate, "开始日期"); validCareerDate(record.endDate, "结束日期");
        const minimum = (date: string) => `${date}${date.length === 4 ? "-01-01" : date.length === 7 ? "-01" : ""}`;
        const maximum = (date: string) => `${date}${date.length === 4 ? "-12-31" : date.length === 7 ? "-31" : ""}`;
        if (record.startDate && record.endDate && minimum(record.startDate) > maximum(record.endDate)) {
          throw new TypeError("结束日期不能早于开始日期");
        }
        if ((("current" in record && record.current) || ("ongoing" in record && record.ongoing)) && record.endDate) {
          throw new TypeError("进行中的履历不能同时填写结束日期");
        }
      }
      for (const entry of record.evidence) {
        entry.field = entry.field.trim(); entry.location = entry.location.trim();
        if (!entry.field || !entry.location || !entry.quote.trim() ||
            !Object.hasOwn(record, entry.field) || ["id", "evidence", "sourceNote"].includes(entry.field)) {
          throw new TypeError("履历出处必须绑定实际字段，包含非空原文与位置");
        }
      }
    }
  }
  return result;
}

export function normalizeJob(value: unknown): JobInput {
  const input = validated(jobInputSchema, value, "岗位");
  const result: JobInput = {
    ...input, company: input.company.trim(), title: input.title.trim(), city: input.city.trim(),
    url: normalizeURL(input.url), sourceId: input.sourceId.trim(), sourceName: input.sourceName.trim(),
    publishedAt: validDate(input.publishedAt, "发布日期"), deadline: validDate(input.deadline, "截止日期"),
  };
  if (!result.company || !result.title || !result.sourceId || !result.sourceName) throw new TypeError("公司、岗位及来源不能为空");
  if (input.observedAt !== undefined) result.observedAt = validTimestamp(input.observedAt, "采集时间");
  if (!result.demo && new URL(result.url).hostname === "example.invalid") throw new TypeError("虚构链接不能标记成真实岗位");
  return result;
}

export function normalizeApplication(value: unknown): ApplicationInput {
  const input = validated(applicationInputSchema, value, "申请记录");
  const result = { ...input, company: input.company.trim(), title: input.title.trim(), url: normalizeURL(input.url, true),
    deadline: validDate(input.deadline, "申请截止日期"), notes: input.notes.trim() };
  if (!result.company || !result.title) throw new TypeError("申请的公司和岗位不能为空");
  return result;
}

export function normalizeSourceRun(value: unknown): SourceRun {
  const input = validated(sourceRunSchema, value, "来源采集记录");
  validTimestamp(input.observedAt, "来源采集时间");
  if (input.status === "failed" && !input.error?.trim()) throw new TypeError("采集失败必须记录原因");
  if (input.status === "failed" && input.count !== 0) throw new TypeError("失败采集不能计为新增岗位");
  if (input.report) {
    validateCollectionReport(input.report);
    if (input.status !== input.report.status || input.count !== input.report.listedCount) throw new TypeError("采集记录与范围报告的状态或岗位数不一致");
  }
  return input;
}

/** The action journal accepts JSON, never API credentials or browser cookies. */
export function validatedJSON(value: unknown, label: string): unknown {
  const seen = new Set<object>();
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 25) throw new TypeError(`${label}结构过深`);
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if (typeof entry !== "object" || seen.has(entry)) throw new TypeError(`${label}必须是无循环引用的 JSON`);
    if (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) {
      throw new TypeError(`${label}必须是普通 JSON 对象`);
    }
    seen.add(entry);
    for (const [key, child] of Object.entries(entry)) {
      if (/^(?:api[_-]?key|authorization|cookies?|password|passwd|access[_-]?token|refresh[_-]?token|token|secret)$/i.test(key)) {
        throw new TypeError(`${label}不能保存凭据字段`);
      }
      // Optional object properties are omitted by JSON serialization; arrays must remain explicit.
      if (child === undefined && !Array.isArray(entry)) continue;
      visit(child, depth + 1);
    }
    seen.delete(entry);
  };
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (encoded.length > 2_000_000) throw new TypeError(`${label}内容过大`);
  return JSON.parse(encoded) as unknown;
}
