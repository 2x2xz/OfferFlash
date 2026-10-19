import { createHash, randomUUID } from "node:crypto";
import type {
  CareerCollection, CareerHistory, CareerInput, CareerRecordInput, CareerRecordState, CareerSource,
  EducationInput, EducationRecord, InternshipRecord, Profile, ProfileInput, ProjectRecord, PublicationRecord,
} from "../../shared/src/contracts.js";

export const careerCollections = ["educations", "internships", "projects", "publications"] as const;
type CareerRecord = EducationRecord | InternshipRecord | ProjectRecord | PublicationRecord;
const educationKeys = ["school", "schoolEn", "degree", "major", "majorEn", "graduationMonth"] as const;
const pending = (revision: number): CareerRecordState => ({
  revision, confirmation: "pending", confirmedAt: null, confirmedRevision: null,
});
export function emptyCareer(): CareerHistory {
  return { schemaVersion: 1, sources: [], educations: [], internships: [], projects: [], publications: [], primaryEducationId: null };
}

function recordInput(record: CareerRecordInput & Partial<CareerRecordState>): CareerRecordInput {
  const { revision: _revision, confirmation: _confirmation, confirmedAt: _at, confirmedRevision: _confirmed, ...input } = record;
  return input;
}
function equal(left: unknown, right: unknown): boolean {
  // Inputs are validated plain JSON; property order must not turn an unchanged record into an edit.
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
  return canonical(left) === canonical(right);
}
function sourceInput(source: CareerSource): Omit<CareerSource, "createdAt"> {
  const { createdAt: _at, ...input } = source;
  return input;
}
const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

function checkEvidence(record: CareerRecordInput, sources: CareerSource[]): void {
  for (const evidence of record.evidence) {
    const source = sources.find(item => item.id === evidence.sourceId);
    if (!source) throw new TypeError(`履历出处引用了不存在的来源：${evidence.sourceId}`);
    if (!normalizeWhitespace(source.text).includes(normalizeWhitespace(evidence.quote))) {
      throw new TypeError("履历引用原文不在对应来源中");
    }
  }
  // A quote being present only verifies its provenance, never the interpretation of its value.
}

function manualEvidence(record: CareerRecordInput, sources: CareerSource[], now: string): CareerRecordInput {
  if (record.evidence.length) return record;
  const values = Object.entries(record).filter(([key, value]) =>
    !["id", "evidence", "sourceNote"].includes(key) &&
    ((typeof value === "string" && value !== "") || (Array.isArray(value) && value.length)))
    .map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join("、") : String(value) }));
  if (!values.length) return record;
  const sourceId = `manual-${randomUUID()}`;
  sources.push({ id: sourceId, kind: "manual", label: record.sourceNote || "用户手动填写", createdAt: now,
    text: values.map(({ key, value }) => `${key}: ${value}`).join("\n") });
  return { ...record, evidence: values.map(({ key, value }) => ({
    field: key, sourceId, quote: value, location: `手动填写：${key}`, originalValue: value,
  })) };
}

/** Source content is append-only and confirmation state is produced exclusively by the store. */
export function evolveCareer(input: CareerInput, old: CareerHistory | undefined, now: string): CareerHistory {
  const previous = old ?? emptyCareer();
  const sources: CareerSource[] = structuredClone(previous.sources);
  for (const source of input.sources) {
    const existing = sources.find(item => item.id === source.id);
    if (existing && !equal(sourceInput(existing), source)) throw new Error("履历来源已存在，不能用相同 ID 修改内容");
    if (!existing && source.kind === "legacy") throw new Error("旧资料来源只能由系统迁移生成");
    if (!existing) sources.push({ ...source, createdAt: now });
  }
  const next: CareerHistory = { ...emptyCareer(), sources, primaryEducationId: input.primaryEducationId };
  for (const collection of careerCollections) {
    const records = input[collection].map(record => {
      const before = previous[collection].find(item => item.id === record.id);
      let candidate: CareerRecordInput = record;
      // A caller may keep an empty evidence list while repeating a manual record. Avoid creating
      // a new source or dropping confirmation when its actual content has stayed the same.
      if (!record.evidence.length && before && equal({ ...record, evidence: before.evidence }, recordInput(before))) {
        candidate = { ...record, evidence: before.evidence };
      }
      checkEvidence(candidate, sources);
      const withEvidence = manualEvidence(candidate, sources, now);
      const unchanged = before && equal(recordInput(before), withEvidence);
      return { ...withEvidence, ...(unchanged ? {
        revision: before.revision, confirmation: before.confirmation,
        confirmedAt: before.confirmedAt, confirmedRevision: before.confirmedRevision,
      } : pending((before?.revision ?? 0) + 1)) } as CareerRecord;
    });
    // Each collection preserves its concrete record fields at runtime.
    (next as unknown as Record<CareerCollection, CareerRecord[]>)[collection] = records;
  }
  if (next.primaryEducationId) {
    const primary = next.educations.find(item => item.id === next.primaryEducationId);
    if (!primary || primary.confirmation !== "confirmed" || primary.confirmedRevision !== primary.revision) {
      if (next.primaryEducationId === previous.primaryEducationId) next.primaryEducationId = null;
      else throw new Error("请选择已经确认当前修订的教育经历");
    }
  }
  return next;
}

function legacyEducation(profile: ProfileInput, id: string, revision: number, now: string): {
  education: EducationRecord; source: CareerSource;
} {
  const input: EducationInput = {
    id, school: profile.school, schoolEn: profile.schoolEn, degree: profile.degree,
    major: profile.major, majorEn: profile.majorEn, startDate: "", endDate: profile.graduationMonth,
    description: "从原单教育资料保留", sourceNote: "原单教育资料（用户保存）", evidence: [],
  };
  const values = Object.entries(input).filter(([key, value]) =>
    ["school", "schoolEn", "degree", "major", "majorEn", "endDate"].includes(key) && typeof value === "string" && value);
  const text = values.map(([key, value]) => `${key}: ${String(value)}`).join("\n");
  const hash = createHash("sha256").update(text).digest("hex");
  const source: CareerSource = {
    id: `legacy-${hash}`, kind: "legacy", label: "原单教育资料（用户保存）", text, createdAt: now,
  };
  input.evidence = values.map(([key, value]) => ({
    field: key, sourceId: source.id, quote: String(value), location: `原资料：${key}`, originalValue: String(value),
  }));
  return { source, education: { ...input, revision, confirmation: "confirmed", confirmedAt: now, confirmedRevision: revision } };
}

function hasEducation(profile: ProfileInput): boolean { return educationKeys.some(key => Boolean(profile[key])); }
export function migrateLegacyProfile(profile: Profile): Profile {
  if (profile.career) return profile;
  const career = emptyCareer();
  if (profile.version > 0 && hasEducation(profile)) {
    const { education, source } = legacyEducation(profile, "legacy-education", 1, profile.updatedAt);
    career.educations.push(education); career.sources.push(source); career.primaryEducationId = education.id;
  }
  return { ...profile, career };
}

/** Every consumer of the old single education fields sees only the user's explicit selection. */
export function projectPrimaryEducation(profile: ProfileInput, career: CareerHistory): ProfileInput & { career: CareerHistory } {
  const selected = career.educations.find(item => item.id === career.primaryEducationId &&
    item.confirmation === "confirmed" && item.confirmedRevision === item.revision);
  return { ...profile, career, school: selected?.school ?? "", schoolEn: selected?.schoolEn ?? "",
    degree: selected?.degree ?? "", major: selected?.major ?? "", majorEn: selected?.majorEn ?? "",
    graduationMonth: selected && /^\d{4}-\d{2}(?:-\d{2})?$/.test(selected.endDate) ? selected.endDate.slice(0, 7) : "",
  };
}

export function profileCareerOnSave(input: ProfileInput, old: Profile, now: string): ProfileInput & { career: CareerHistory } {
  const previous = old.career ?? migrateLegacyProfile(old).career!;
  if (input.career) return projectPrimaryEducation(input, evolveCareer(input.career, previous, now));
  const career = structuredClone(previous);
  const changed = educationKeys.some(key => input[key] !== old[key]);
  if (changed) {
    const primary = career.educations.find(item => item.id === career.primaryEducationId);
    const primaryIsLegacy = primary?.sourceNote === "原单教育资料（用户保存）" &&
      primary.evidence.every(entry => career.sources.some(source => source.id === entry.sourceId && source.kind === "legacy"));
    // Once structured history exists, the legacy interface must not silently replace its selection.
    if ((primary && !primaryIsLegacy) || (!primary && career.educations.length)) {
      throw new Error("请在结构化教育经历中修改并确认资料，不能用旧单教育接口覆盖");
    }
    if (hasEducation(input)) {
      const { education, source } = legacyEducation(input, primary?.id ?? "legacy-education", (primary?.revision ?? 0) + 1, now);
      career.educations = career.educations.filter(item => item.id !== education.id);
      career.educations.push(education);
      if (!career.sources.some(item => item.id === source.id)) career.sources.push(source);
      career.primaryEducationId = education.id;
    } else {
      if (primary) career.educations = career.educations.filter(item => item.id !== primary.id);
      career.primaryEducationId = null;
    }
  }
  return projectPrimaryEducation(input, career);
}

export function confirmCareer(career: CareerHistory, collection: CareerCollection, id: string, expectedRevision: number, now: string): CareerHistory {
  const next = structuredClone(career);
  const record = next[collection].find(item => item.id === id);
  if (!record) throw new Error("履历记录不存在");
  if (record.revision !== expectedRevision) throw new Error("履历记录已被修改，请刷新后确认当前修订");
  const name = "school" in record ? record.school : "organization" in record ? record.organization : "name" in record ? record.name : record.title;
  if (!name.trim()) throw new Error("确认履历前必须填写学校、机构、项目名称或论文标题");
  record.confirmation = "confirmed"; record.confirmedRevision = record.revision; record.confirmedAt = now;
  return next;
}
