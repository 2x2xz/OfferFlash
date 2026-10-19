import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import initSqlJs from "sql.js";
import { createStore, type DomainStore } from "../packages/domain/src/store.js";
import { pickCareerInput } from "../packages/profile/src/career-input.js";
import type {
  CareerHistory, CareerInput, CareerRecordState, EducationInput, InternshipInput, JobInput,
  Profile, ProfileInput, ProjectInput, PublicationInput,
} from "../packages/shared/src/contracts.js";

const flat: Omit<ProfileInput, "career"> = {
  fullName: "虚构履历用户", fullNameEn: "Fictional User", email: "test@example.invalid", phone: "",
  school: "", schoolEn: "", degree: "", major: "", majorEn: "", graduationMonth: "",
  skills: ["Python"], cities: ["杭州"], targetRoles: ["算法"], resumeText: "虚构测试资料",
};
const education = (id = "education-1", patch: Partial<EducationInput> = {}): EducationInput => ({
  id, school: "虚构本科大学", schoolEn: "Fictional University", degree: "本科", major: "计算机",
  majorEn: "Computer Science", startDate: "2023", endDate: "2027", description: "", evidence: [], sourceNote: "", ...patch,
});
const internship = (id = "internship-1"): InternshipInput => ({
  id, organization: "虚构研究机构", role: "研究实习生", startDate: "2026-03", endDate: "2026-08",
  current: false, description: "实现虚构实验", technologies: ["Python"], evidence: [], sourceNote: "",
});
const project = (id = "project-1"): ProjectInput => ({
  id, name: "虚构项目", role: "开发", startDate: "2026-01-03", endDate: "", ongoing: true,
  description: "测试项目", technologies: ["TypeScript"], url: "", evidence: [], sourceNote: "",
});
const publication = (id = "publication-1"): PublicationInput => ({
  id, title: "虚构论文", authors: "Fictional Author", venue: "虚构期刊", publicationDate: "2026",
  status: "submitted", doi: "", url: "", evidence: [], sourceNote: "",
});
function career(patch: Partial<CareerInput> = {}): CareerInput {
  return { schemaVersion: 1, sources: [], educations: [], internships: [], projects: [], publications: [], primaryEducationId: null, ...patch };
}
function stripState<T extends Partial<CareerRecordState>>(record: T) {
  const { revision: _revision, confirmation: _confirmation, confirmedAt: _at, confirmedRevision: _confirmed, ...input } = record;
  return input;
}
function input(profile: Profile): ProfileInput {
  const { version: _version, updatedAt: _updated, career: history, ...fields } = structuredClone(profile);
  if (!history) return fields;
  return { ...fields, career: {
    ...history, sources: history.sources.map(({ createdAt: _at, ...source }) => source),
    educations: history.educations.map(stripState), internships: history.internships.map(stripState),
    projects: history.projects.map(stripState), publications: history.publications.map(stripState),
  } };
}
async function withStore(body: (store: DomainStore, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "offeragent-career-"));
  const store = await createStore({ directory });
  try { await body(store, directory); }
  finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
}

test("four record collections save pending with exact date precision and genuine manual source text", async () => {
  await withStore(async store => {
    const saved = await store.saveProfile({ ...flat, career: career({ educations: [education()], internships: [internship()],
      projects: [project()], publications: [publication()] }) }, 0);
    const history = saved.profile.career!;
    assert.equal(history.sources.length, 4);
    assert.equal(history.educations[0]!.startDate, "2023");
    assert.equal(history.educations[0]!.endDate, "2027");
    assert.equal(history.projects[0]!.startDate, "2026-01-03");
    assert.equal(history.publications[0]!.publicationDate, "2026");
    for (const collection of ["educations", "internships", "projects", "publications"] as const) {
      const record = history[collection][0]!;
      assert.equal(record.confirmation, "pending"); assert.equal(record.confirmedAt, null);
      assert.equal(record.revision, 1); assert.equal(record.confirmedRevision, null);
      assert.ok(record.evidence.length);
      for (const evidence of record.evidence) {
        assert.ok(history.sources.find(source => source.id === evidence.sourceId)!.text.includes(evidence.quote));
        assert.ok(evidence.location);
      }
    }
    assert.equal(saved.profile.school, ""); assert.equal(saved.profile.degree, "");
    assert.equal(saved.profile.graduationMonth, ""); assert.equal(history.primaryEducationId, null);
    assert.deepEqual((await store.exportState()).profile.career, history);
  });
});

test("confirm each collection records server revision/time and retains every other candidate", async () => {
  await withStore(async store => {
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [education(), education("education-2")],
      internships: [internship()], projects: [project()], publications: [publication()] }) }, 0);
    for (const collection of ["educations", "internships", "projects", "publications"] as const) {
      saved = await store.confirmCareerRecord(collection, saved.profile.career![collection][0]!.id, saved.profile.version, 1);
      const record = saved.profile.career![collection][0]!;
      assert.equal(record.confirmation, "confirmed"); assert.equal(record.confirmedRevision, 1);
      assert.ok(Number.isFinite(Date.parse(record.confirmedAt!)));
      assert.equal(saved.profile.career!.educations.length, 2);
      assert.equal(saved.profile.career!.educations[1]!.confirmation, "pending");
    }
    assert.equal(saved.profile.career!.primaryEducationId, null);
    assert.equal(saved.profile.school, "", "confirmation does not choose education on behalf of user");
  });
});

test("confirmed selection projects only selected education and year-only end dates never gain a month", async () => {
  await withStore(async store => {
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [education(), education("education-2", {
      school: "虚构硕士大学", degree: "硕士", endDate: "2028-06-17",
    })] }) }, 0);
    const pendingSelection = input(saved.profile); pendingSelection.career!.primaryEducationId = "education-2";
    await assert.rejects(store.saveProfile(pendingSelection, saved.profile.version), /已经确认/);
    saved = await store.confirmCareerRecord("educations", "education-1", saved.profile.version, 1);
    let draft = input(saved.profile); draft.career!.primaryEducationId = "education-1";
    saved = await store.saveProfile({ ...draft, school: "试图从flat注入的学校" }, saved.profile.version);
    assert.equal(saved.profile.school, "虚构本科大学"); assert.equal(saved.profile.degree, "本科");
    assert.equal(saved.profile.graduationMonth, "");
    saved = await store.confirmCareerRecord("educations", "education-2", saved.profile.version, 1);
    draft = input(saved.profile); draft.career!.primaryEducationId = "education-2";
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.school, "虚构硕士大学"); assert.equal(saved.profile.graduationMonth, "2028-06");
    draft = input(saved.profile); draft.career!.primaryEducationId = null;
    saved = await store.saveProfile(draft, saved.profile.version);
    for (const key of ["school", "schoolEn", "degree", "major", "majorEn", "graduationMonth"] as const) assert.equal(saved.profile[key], "");
  });
});

test("selected education at career text limits can be saved again and its primary selection removed", async () => {
  await withStore(async store => {
    const longEducation = education("long-education", {
      school: "校".repeat(500), schoolEn: "s".repeat(500), degree: "学".repeat(100),
      major: "专".repeat(500), majorEn: "m".repeat(500), endDate: "2027-06",
    });
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [longEducation] }) }, 0);
    saved = await store.confirmCareerRecord("educations", longEducation.id, saved.profile.version, 1);
    let draft = input(saved.profile); draft.career!.primaryEducationId = longEducation.id;
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.school.length, 500); assert.equal(saved.profile.degree.length, 100);
    draft = input(saved.profile); draft.career = pickCareerInput(saved.profile.career);
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.career!.primaryEducationId, longEducation.id);
    assert.equal(saved.profile.career!.educations[0]!.confirmation, "confirmed");
    draft = input(saved.profile); draft.career = pickCareerInput(saved.profile.career); draft.career.primaryEducationId = null;
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.school, ""); assert.equal(saved.profile.degree, "");
    assert.equal(saved.profile.career!.primaryEducationId, null);
    assert.equal(saved.profile.career!.educations[0]!.school.length, 500);
    await assert.rejects(store.saveProfile({ ...input(saved.profile), fullName: "n".repeat(201) }, saved.profile.version), /格式/);
  });
});

test("record edits increment revision, invalidate confirmation and clear selected education atomically", async () => {
  await withStore(async store => {
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [education()], projects: [project()] }) }, 0);
    saved = await store.confirmCareerRecord("educations", "education-1", saved.profile.version, 1);
    saved = await store.confirmCareerRecord("projects", "project-1", saved.profile.version, 1);
    let draft = input(saved.profile); draft.career!.primaryEducationId = "education-1";
    saved = await store.saveProfile(draft, saved.profile.version);
    draft = input(saved.profile); draft.career!.educations[0]!.major = "新的专业";
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.deepEqual(stripState(saved.profile.career!.projects[0]!), draft.career!.projects[0]);
    assert.equal(saved.profile.career!.projects[0]!.confirmation, "confirmed");
    const changed = saved.profile.career!.educations[0]!;
    assert.equal(changed.revision, 2); assert.equal(changed.confirmation, "pending");
    assert.equal(changed.confirmedRevision, null); assert.equal(changed.confirmedAt, null);
    assert.equal(saved.profile.career!.primaryEducationId, null); assert.equal(saved.profile.school, "");
    await assert.rejects(store.confirmCareerRecord("educations", changed.id, saved.profile.version, 1), /当前修订/);
    const updated = await store.confirmCareerRecord("educations", changed.id, saved.profile.version, 2);
    assert.equal(updated.profile.career!.educations[0]!.confirmedRevision, 2);
    assert.equal(updated.profile.career!.primaryEducationId, null);
  });
});

test("unchanged manual repeat saves retain confirmation and source; all collection deletions remain explicit", async () => {
  await withStore(async store => {
    const originalCareer = career({ educations: [education()], internships: [internship()], projects: [project()], publications: [publication()] });
    let saved = await store.saveProfile({ ...flat, career: originalCareer }, 0);
    saved = await store.confirmCareerRecord("projects", "project-1", saved.profile.version, 1);
    const before = saved.profile.career!;
    saved = await store.saveProfile({ ...flat, career: originalCareer }, saved.profile.version);
    assert.deepEqual(saved.profile.career, before);
    let draft = input(saved.profile);
    draft.career!.internships[0]!.role = "新职务";
    draft.career!.projects[0]!.name = "新项目名";
    draft.career!.publications[0]!.status = "accepted";
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.career!.internships[0]!.revision, 2);
    assert.equal(saved.profile.career!.projects[0]!.confirmation, "pending");
    assert.equal(saved.profile.career!.publications[0]!.revision, 2);
    draft = input(saved.profile);
    for (const collection of ["educations", "internships", "projects", "publications"] as const) draft.career![collection] = [];
    saved = await store.saveProfile(draft, saved.profile.version);
    for (const collection of ["educations", "internships", "projects", "publications"] as const) assert.deepEqual(saved.profile.career![collection], []);
    assert.deepEqual(saved.profile.career!.sources, before.sources, "deleting records retains source provenance");
  });
});

test("deleting selected education clears projection while deleting another education preserves it", async () => {
  await withStore(async store => {
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [education(), education("other")] }) }, 0);
    saved = await store.confirmCareerRecord("educations", "education-1", saved.profile.version, 1);
    let draft = input(saved.profile); draft.career!.primaryEducationId = "education-1";
    saved = await store.saveProfile(draft, saved.profile.version);
    draft = input(saved.profile); draft.career!.educations = draft.career!.educations.filter(record => record.id !== "other");
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.school, "虚构本科大学");
    draft = input(saved.profile); draft.career!.educations = [];
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.profile.career!.primaryEducationId, null); assert.equal(saved.profile.school, "");
    assert.equal(saved.profile.degree, "");
  });
});

test("strict payloads reject forged confirmation/source time, duplicate record IDs and invalid dates", async () => {
  await withStore(async store => {
    const forged = education() as EducationInput & CareerRecordState;
    Object.assign(forged, { confirmation: "confirmed", confirmedAt: "2020-01-01T00:00:00Z", revision: 1, confirmedRevision: 1 });
    await assert.rejects(store.saveProfile({ ...flat, career: career({ educations: [forged] }) }, 0), /不允许/);
    const source = { id: "source", kind: "manual" as const, label: "手填", text: "原文", createdAt: "2020-01-01T00:00:00Z" };
    await assert.rejects(store.saveProfile({ ...flat, career: career({ sources: [source] }) }, 0), /不允许/);
    await assert.rejects(store.saveProfile({ ...flat, career: career({ educations: [education("dup")], projects: [project("dup")] }) }, 0), /ID 不能重复/);
    await assert.rejects(store.saveProfile({ ...flat, career: career({ educations: [education("e", { evidence: [{
      field: "constructor", sourceId: "source", quote: "原文", originalValue: "原文", location: "第1行",
    }] })] }) }, 0), /实际字段/);
    for (const endDate of ["2027-13", "2023-02-29", "2027-06-31", "2027-6", "2027-06-01T00:00:00Z", "0000"]) {
      await assert.rejects(store.saveProfile({ ...flat, career: career({ educations: [education("e", { startDate: "", endDate })] }) }, 0), /日期|YYYY|格式/);
    }
    await assert.rejects(store.saveProfile({ ...flat, career: career({ educations: [education("e", { startDate: "2027-09", endDate: "2027-08" })] }) }, 0), /早于/);
    const valid = await store.saveProfile({ ...flat, career: career({ educations: [education("e", { startDate: "2024-02-29", endDate: "2027-06" })] }) }, 0);
    assert.equal(valid.profile.career!.educations[0]!.startDate, "2024-02-29");
  });
});

test("sources must exist, quotes must come from the same source and sources cannot be rewritten", async () => {
  await withStore(async store => {
    const sourced = education("education-1", { evidence: [{ field: "school", sourceId: "resume-1", quote: "虚构本科大学",
      originalValue: "虚构本科大学", location: "第1段" }] });
    await assert.rejects(store.saveProfile({ ...flat, career: career({ educations: [sourced] }) }, 0), /不存在的来源/);
    const source = { id: "resume-1", kind: "resume" as const, label: "虚构材料", fileName: "fixture.txt", fileHash: "a".repeat(64), text: "虚构本科大学\n计算机" };
    const saved = await store.saveProfile({ ...flat, career: career({ educations: [sourced], sources: [source] }) }, 0);
    const before = await readFile(store.databasePath);
    for (const patch of [{ text: "改写原文" }, { label: "改写来源名" }, { fileHash: "b".repeat(64) }]) {
      const draft = input(saved.profile); Object.assign(draft.career!.sources[0]!, patch);
      await assert.rejects(store.saveProfile(draft, saved.profile.version), /相同 ID/);
    }
    const wrong = input(saved.profile); wrong.career!.educations[0]!.evidence[0]!.quote = "未出现的原文";
    await assert.rejects(store.saveProfile(wrong, saved.profile.version), /对应来源/);
    assert.deepEqual(await readFile(store.databasePath), before);
    assert.deepEqual((await store.getState()).profile, saved.profile);
    const whitespace = input(saved.profile); whitespace.career!.educations[0]!.evidence[0]!.quote = "虚构本科大学 \n 计算机";
    const valid = await store.saveProfile(whitespace, saved.profile.version);
    assert.equal(valid.profile.career!.educations[0]!.revision, 2);
  });
});

test("source provenance matching never confirms a numeric or interpreted fact automatically", async () => {
  await withStore(async store => {
    const saved = await store.saveProfile({ ...flat, career: career({
      sources: [{ id: "numeric", kind: "manual", label: "虚构数字文本", text: "97%" }],
      educations: [education("e", { school: "未经语义验证的解释", evidence: [{ field: "school", sourceId: "numeric",
        quote: "97%", location: "第1行", originalValue: "97%" }] })],
    }) }, 0);
    assert.equal(saved.profile.career!.educations[0]!.confirmation, "pending");
    assert.equal(saved.profile.career!.primaryEducationId, null); assert.equal(saved.profile.school, "");
  });
});

test("stale profile/revision confirmations and empty core names cannot commit", async () => {
  await withStore(async store => {
    const saved = await store.saveProfile({ ...flat, career: career({ educations: [education()], internships: [internship()],
      projects: [{ ...project(), name: "" }], publications: [{ ...publication(), title: "" }] }) }, 0);
    await assert.rejects(store.confirmCareerRecord("educations", "education-1", 0, 1), /资料已被更新/);
    await assert.rejects(store.confirmCareerRecord("educations", "education-1", saved.profile.version, 0), /修订号/);
    await assert.rejects(store.confirmCareerRecord("educations", "missing", saved.profile.version, 1), /不存在/);
    for (const [collection, id] of [["projects", "project-1"], ["publications", "publication-1"]] as const) {
      await assert.rejects(store.confirmCareerRecord(collection, id, saved.profile.version, 1), /必须填写/);
    }
    assert.deepEqual((await store.getState()).profile, saved.profile);
    const results = await Promise.allSettled([
      store.confirmCareerRecord("educations", "education-1", saved.profile.version, 1),
      store.confirmCareerRecord("internships", "internship-1", saved.profile.version, 1),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
  });
});

test("career survives export/reopen and legacy API edits preserve structure or reject education overwrites", async () => {
  await withStore(async (store, directory) => {
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [education()], projects: [project()] }) }, 0);
    saved = await store.confirmCareerRecord("educations", "education-1", saved.profile.version, 1);
    const draft = input(saved.profile); draft.career!.primaryEducationId = "education-1";
    saved = await store.saveProfile(draft, saved.profile.version);
    const { career: _career, ...legacy } = input(saved.profile);
    saved = await store.saveProfile({ ...legacy, email: "updated@example.invalid" }, saved.profile.version);
    assert.equal(saved.profile.career!.projects.length, 1); assert.equal(saved.profile.career!.educations[0]!.confirmation, "confirmed");
    await assert.rejects(store.saveProfile({ ...legacy, school: "旧接口想覆盖" }, saved.profile.version), /旧单教育接口/);
    await store.close();
    const reopened = await createStore({ directory });
    try { assert.deepEqual((await reopened.exportState()).profile, saved.profile); }
    finally { await reopened.close(); }
  });
});

test("initial legacy saves retain their prior confirmation contract and can update without losing projects", async () => {
  await withStore(async store => {
    let saved = await store.saveProfile({ ...flat, school: "旧单学校", degree: "硕士", graduationMonth: "2027-06" }, 0);
    const history = saved.profile.career!;
    assert.equal(history.educations.length, 1); assert.equal(history.educations[0]!.confirmation, "confirmed");
    assert.equal(saved.profile.degree, "硕士"); assert.equal(saved.profile.graduationMonth, "2027-06");
    const draft = input(saved.profile); draft.career!.projects = [project()];
    saved = await store.saveProfile(draft, saved.profile.version);
    const { career: _career, ...legacy } = input(saved.profile);
    saved = await store.saveProfile({ ...legacy, major: "新专业" }, saved.profile.version);
    assert.equal(saved.profile.major, "新专业"); assert.equal(saved.profile.career!.educations[0]!.revision, 2);
    assert.equal(saved.profile.career!.educations[0]!.confirmation, "confirmed"); assert.equal(saved.profile.career!.projects.length, 1);
    assert.equal(saved.profile.career!.sources.filter(source => source.kind === "legacy").length, 2);
  });
});

test("actual legacy SQLite profile migrates without changing version, old history or other business rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "offeragent-career-migration-"));
  const require = createRequire(import.meta.url);
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const old: Profile = { ...flat, school: "历史学校", degree: "本科", graduationMonth: "2025-06", version: 7, updatedAt: "2026-09-01T00:00:00Z" };
  const unrelated = { id: "keep", company: "虚构企业", title: "历史申请", url: "", status: "applied", notes: "保持原样",
    deadline: null, createdAt: old.updatedAt, updatedAt: old.updatedAt, demo: false, history: [] };
  const db = new SQL.Database();
  db.run("CREATE TABLE documents(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1");
  for (const [kind, id, payload] of [["profile", "current", old], ["profile_version", "7", old], ["application", "keep", unrelated]] as const) {
    db.run("INSERT INTO documents VALUES (?,?,?,?)", [kind, id, JSON.stringify(payload), old.updatedAt]);
  }
  await writeFile(join(directory, "offeragent.sqlite"), db.export()); db.close();
  let store: DomainStore | undefined;
  try {
    store = await createStore({ directory });
    const migrated = (await store.getState()).profile;
    assert.equal(migrated.version, old.version); assert.equal(migrated.updatedAt, old.updatedAt);
    assert.equal(migrated.school, old.school); assert.equal(migrated.graduationMonth, old.graduationMonth);
    assert.equal(migrated.career!.educations[0]!.confirmation, "confirmed");
    assert.equal(migrated.career!.sources[0]!.kind, "legacy");
    assert.deepEqual((await store.getState()).applications[0], unrelated);
    const disk = new SQL.Database(await readFile(store.databasePath));
    try {
      assert.equal(disk.exec("SELECT payload FROM documents WHERE kind='profile_version' AND id='7'")[0]!.values[0]![0], JSON.stringify(old));
      assert.equal(disk.exec("SELECT payload FROM documents WHERE kind='application' AND id='keep'")[0]!.values[0]![0], JSON.stringify(unrelated));
    } finally { disk.close(); }
    await store.close(); store = await createStore({ directory });
    assert.deepEqual((await store.getState()).profile, migrated);
  } finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("save and confirm persist profile history and recomputed job match in the same version", async () => {
  await withStore(async store => {
    const job: JobInput = { id: "fixture-job", company: "虚构企业", title: "算法实习", city: "杭州", type: "campus",
      description: "算法", requirements: "2027届，硕士及以上，Python", url: "https://example.org/fixture-career",
      sourceId: "manual", sourceName: "测试", publishedAt: "2026-10-01", deadline: "2099-12-31", demo: false };
    await store.saveJob(job);
    let saved = await store.saveProfile({ ...flat, career: career({ educations: [education("e", { degree: "硕士", endDate: "2027-06" })] }) }, 0);
    assert.equal(saved.jobs[0]!.match.eligible, "review");
    saved = await store.confirmCareerRecord("educations", "e", saved.profile.version, 1);
    const draft = input(saved.profile); draft.career!.primaryEducationId = "e";
    saved = await store.saveProfile(draft, saved.profile.version);
    assert.equal(saved.jobs[0]!.match.eligible, "likely");
    assert.equal(saved.jobs[0]!.match.profileVersion, saved.profile.version);
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    const disk = new SQL.Database(await readFile(store.databasePath));
    try {
      const profileHistory = disk.exec(`SELECT payload FROM documents WHERE kind='profile_version' AND id='${saved.profile.version}'`)[0]!.values[0]![0];
      assert.equal(profileHistory, JSON.stringify(saved.profile));
      const persistedJob = JSON.parse(String(disk.exec("SELECT payload FROM documents WHERE kind='job' AND id='fixture-job'")[0]!.values[0]![0])) as { match: { profileVersion: number; eligible: string } };
      assert.equal(persistedJob.match.profileVersion, saved.profile.version); assert.equal(persistedJob.match.eligible, "likely");
    } finally { disk.close(); }
  });
});
