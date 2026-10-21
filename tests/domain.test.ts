import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import initSqlJs from "sql.js";
import { createStore, matchJob, type DomainStore } from "../packages/domain/src/index.js";
import type { JobInput, Profile, ProfileInput } from "../packages/shared/src/contracts.js";

const profileInput: Omit<ProfileInput, 'career' | 'personal'> = {
  fullName: "测试用户（虚构）", fullNameEn: "Test User", email: "test@example.invalid", phone: "",
  school: "测试大学（虚构）", schoolEn: "", degree: "硕士", major: "计算机", majorEn: "",
  graduationMonth: "2027-06", skills: ["Python", "PyTorch"], cities: ["杭州"], targetRoles: ["大模型"],
  resumeText: "仅用于自动测试的虚构资料。",
};

function jobInput(overrides: Partial<JobInput> = {}): JobInput {
  return {
    company: "测试企业（虚构测试对象）", title: "大模型算法校招工程师", city: "杭州", type: "campus",
    description: "测试文本：大模型研发。", requirements: "2027届，硕士及以上；Python、PyTorch。",
    url: "https://example.org/testing/job-1", sourceId: "manual", sourceName: "自动测试手动输入",
    publishedAt: "2026-10-01", deadline: "2099-12-31", demo: false, ...overrides,
  };
}

async function withStore(body: (context: {
  directory: string; store: DomainStore; reopen(): Promise<DomainStore>;
}) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "offeragent-domain-"));
  const stores: DomainStore[] = [];
  try {
    const store = await createStore({ directory });
    stores.push(store);
    await body({
      directory, store,
      async reopen() {
        const reopened = await createStore({ directory });
        stores.push(reopened);
        return reopened;
      },
    });
  } finally {
    try { for (const store of stores.reverse()) await store.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

test("store uses an actual private SQLite file and starts without invented personal data", async () => {
  await withStore(async ({ store }) => {
    const state = await store.getState();
    assert.equal(state.profile.version, 0);
    assert.equal(state.profile.fullName, "");
    assert.equal(state.profile.resumeText, "");
    assert.deepEqual(state.profile.targetRoles, ["大模型", "算法", "AI"]);
    assert.deepEqual(state.jobs, []);
    assert.deepEqual(state.applications, []);
    const bytes = await readFile(store.databasePath);
    assert.equal(bytes.subarray(0, 16).toString("utf8"), "SQLite format 3\0");
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    const db = new SQL.Database(bytes);
    try {
      assert.equal(db.exec("PRAGMA user_version")[0]?.values[0]?.[0], 1);
      assert.equal(db.exec("SELECT count(*) FROM documents WHERE kind = 'profile'")[0]?.values[0]?.[0], 1);
    } finally { db.close(); }
    if (process.platform !== "win32") assert.equal((await stat(store.databasePath)).mode & 0o777, 0o600);
  });
});

test("profile versions serialize concurrent edits and stale saves roll back", async () => {
  await withStore(async ({ store }) => {
    const results = await Promise.allSettled([
      store.saveProfile(profileInput, 0),
      store.saveProfile({ ...profileInput, major: "另一个编辑" }, 0),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    const state = await store.getState();
    assert.equal(state.profile.version, 1);
    assert.equal(state.profile.major, "计算机");
    await assert.rejects(store.saveProfile(profileInput, 0), /资料已被更新/);
    await assert.rejects(store.saveProfile({ ...profileInput, apiKey: "DO_NOT_SAVE_KEY" } as ProfileInput), /不允许/);
    assert.equal((await store.getState()).profile.version, 1);
    assert.ok(!(await readFile(store.databasePath)).includes(Buffer.from("DO_NOT_SAVE_KEY")));
    const next = await store.saveProfile({ ...profileInput, skills: ["Python", " python ", "PyTorch"] }, 1);
    assert.equal(next.profile.version, 2);
    assert.equal(next.profile.skills.length, 2);
  });
});

test("jobs deduplicate source URLs, retain first sighting and recompute against confirmed profile versions", async () => {
  await withStore(async ({ store }) => {
    const first = await store.saveJob(jobInput({ url: "https://example.org/testing/job-1?utm_source=a" }));
    const original = first.jobs[0]!;
    assert.equal(original.match.profileVersion, 0);
    assert.equal(original.match.eligible, "review");
    assert.equal(original.publishedAt, "2026-10-01");
    const again = await store.saveJob(jobInput({ url: "https://example.org/testing/job-1?utm_source=b", title: "大模型算法工程师（更新标题）" }));
    assert.equal(again.jobs.length, 1);
    assert.equal(again.jobs[0]!.id, original.id);
    assert.equal(again.jobs[0]!.firstSeenAt, original.firstSeenAt);
    const state = await store.saveProfile(profileInput, 0);
    assert.equal(state.jobs[0]!.match.profileVersion, 1);
    assert.equal(state.jobs[0]!.match.eligible, "likely");
    assert.ok(state.jobs[0]!.match.reasons.some(reason => reason.includes("毕业年份")));
    assert.ok(state.jobs[0]!.match.score >= 0 && state.jobs[0]!.match.score <= 100);
    state.jobs[0]!.title = "mutated outside the store";
    assert.ok((await store.getState()).jobs[0]!.title !== state.jobs[0]!.title);
  });
});

test("hard-condition explanations reject mismatches while missing provenance stays uncertain", () => {
  const profile: Profile = { ...profileInput, version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  const cases: Array<[Partial<JobInput>, RegExp]> = [
    [{ type: "experienced" }, /社招/],
    [{ city: "北京" }, /意向城市/],
    [{ requirements: "2026届，硕士及以上，Python。" }, /毕业年份不一致/],
    [{ requirements: "2027届，博士学位，Python。" }, /学历低于/],
    [{ deadline: "2026-10-10" }, /截止日期已过/],
  ];
  for (const [override, reason] of cases) {
    const result = matchJob(profile, jobInput(override), now);
    assert.equal(result.eligible, "unsuitable");
    assert.ok(result.concerns.some(concern => reason.test(concern)), JSON.stringify(result));
    assert.ok(result.score <= 20);
  }
  const missing = matchJob(profile, jobInput({ type: "unknown", publishedAt: null, deadline: null }), now);
  assert.equal(missing.eligible, "review");
  assert.ok(missing.concerns.some(concern => /采集时间不等于发布时间/.test(concern)));
  const timezone = matchJob(profile, jobInput({ deadline: "2026-10-11" }), new Date("2026-10-11T16:01:00Z"));
  assert.equal(timezone.eligible, "unsuitable", "Shanghai is already October 12");
});

test("acceptable degree alternatives and complete cohort lists do not impose the highest or last item", () => {
  const profile: Profile = { ...profileInput, degree: "本科", graduationMonth: "2026-06", version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const cohorts of ["2026、2027届", "2026/2027届", "2026届或2027届", "2026和2027届"]) {
    for (const degrees of ["本科或硕士学历", "本科、硕士、博士学历", "硕士/本科学历"]) {
      const result = matchJob(profile, jobInput({ requirements: `${cohorts}，${degrees}，Python、PyTorch。` }), now);
      assert.equal(result.eligible, "likely", `${cohorts} ${degrees}: ${JSON.stringify(result)}`);
      assert.ok(!result.concerns.some(concern => /学历低于|毕业年份不一致/.test(concern)));
    }
  }
  for (const cohort of ["2026-2028届", "2026届至2028届"]) {
    assert.equal(matchJob({ ...profile, graduationMonth: "2027-06" }, jobInput({
      requirements: `${cohort}，本科及以上，Python、PyTorch。`,
    }), now).eligible, "likely");
  }
  const outside = matchJob({ ...profile, graduationMonth: "2029-06" }, jobInput({
    requirements: "2026-2028届，本科及以上，Python。",
  }), now);
  assert.equal(outside.eligible, "unsuitable");
});

test("unknown city placeholders stay review instead of rejecting a preferred-city candidate", () => {
  const profile: Profile = { ...profileInput, version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const city of ["城市待确认", "未提供", "所在地未注明", "城市未知", ""]) {
    const result = matchJob(profile, jobInput({ city }), now);
    assert.equal(result.eligible, "review", `${city}: ${JSON.stringify(result)}`);
    assert.ok(result.concerns.includes("岗位城市需进一步确认"));
    assert.ok(!result.concerns.some(concern => concern.includes("不在你的意向城市")));
  }
  assert.equal(matchJob(profile, jobInput({ city: "北京" }), now).eligible, "unsuitable");
  assert.equal(matchJob(profile, jobInput({ city: "杭州" }), now).eligible, "likely");
});

test("truncated official city summaries do not exclude an unlisted fourth city", () => {
  const profile: Profile = { ...profileInput, version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  const partial = matchJob(profile, jobInput({ city: "上海、北京、深圳等 4 个城市" }), now);
  assert.equal(partial.eligible, "review");
  assert.ok(partial.concerns.includes("岗位城市需进一步确认"));
  assert.ok(!partial.concerns.some(concern => concern.includes("不在你的意向城市")));
  const included = matchJob(profile, jobInput({ city: "上海、杭州、深圳等 4 个城市" }), now);
  assert.equal(included.eligible, "likely");
  assert.ok(included.reasons.includes("意向城市匹配：杭州"));
  assert.equal(matchJob(profile, jobInput({ city: "北京" }), now).eligible, "unsuitable");
});

test("an explicit graduation-month window takes precedence over its campus cohort label", () => {
  const base: Profile = { ...profileInput, version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const range of [
    "面向2027届毕业生（2026年9月-2027年8月期间毕业），硕士及以上，Python、PyTorch。",
    "面向2027届，毕业时间为2026-09至2027-08，硕士及以上，Python、PyTorch。",
    "2027届（2026年9月1日至2027年8月31日之间毕业），硕士及以上，Python、PyTorch。",
  ]) {
    for (const graduationMonth of ["2026-09", "2026-11", "2027-06", "2027-08"]) {
      const result = matchJob({ ...base, graduationMonth }, jobInput({ requirements: range }), now);
      assert.equal(result.eligible, "likely", `${graduationMonth} ${range}: ${JSON.stringify(result)}`);
      assert.ok(result.reasons.some(reason => reason.includes("毕业窗口")));
    }
    const outside = matchJob({ ...base, graduationMonth: "2026-06" }, jobInput({ requirements: range }), now);
    assert.equal(outside.eligible, "unsuitable");
    assert.ok(outside.concerns.some(concern => concern.includes("不在明确范围内")));
  }
  const internship = matchJob({ ...base, graduationMonth: "2026-11" }, jobInput({
    type: "internship", requirements: "面向2027届毕业生（2026年9月-2027年8月期间毕业），硕士及以上，Python。",
  }), now);
  assert.equal(internship.eligible, "review", "internship intent still needs confirmation without misclassifying graduation");
});

test("application deadlines and work periods are not treated as graduation windows", () => {
  const profile: Profile = { ...profileInput, graduationMonth: "2026-11", version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const requirements of [
    "面向2027届毕业生。申请期间：2026年9月-2027年8月，硕士及以上，Python。",
    "面向2027届毕业生。工作期间：2026年9月-2027年8月，硕士及以上，Python。",
    "面向2027届毕业生。截止时间：2026年9月-2027年8月，硕士及以上，Python。",
    "面向2027届毕业生。项目周期：2026年9月-2027年8月，硕士及以上，Python。",
  ]) {
    const result = matchJob(profile, jobInput({ requirements }), now);
    assert.equal(result.eligible, "unsuitable", JSON.stringify(result));
    assert.ok(result.concerns.some(concern => concern.includes("毕业年份不一致")));
    assert.ok(!result.reasons.some(reason => reason.includes("毕业窗口")));
  }
  assert.equal(matchJob(profile, jobInput({ requirements: "面向2027届，硕士及以上，Python。" }), now).eligible, "unsuitable");
  const invalid = matchJob(profile, jobInput({ requirements: "毕业时间为2027年13月-2026年8月，面向2027届，硕士及以上，Python。" }), now);
  assert.equal(invalid.eligible, "review");
  const unsupported = matchJob(profile, jobInput({
    requirements: "面向2027届（2026年9月（含）至2027年8月（含）期间毕业），硕士及以上，Python。",
  }), now);
  assert.equal(unsupported.eligible, "review");
});

test("conditional or ambiguous degree and cohort wording remains review while single thresholds still reject", () => {
  const profile: Profile = { ...profileInput, degree: "本科", graduationMonth: "2027-06", version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const requirements of [
    "2027届，硕士学历；本科优秀者也可，Python。",
    "2027届，本科、硕士岗位要求另行确认；博士学位的候选人属于另一个方向，Python。",
    "2026届优先，本科及以上，Python。",
    "非2027届，本科及以上，Python。",
  ]) {
    const result = matchJob(profile, jobInput({ requirements }), now);
    assert.equal(result.eligible, "review", JSON.stringify(result));
    assert.ok(result.concerns.some(concern => /人工确认/.test(concern)));
  }
  for (const requirements of ["2027届，硕士及以上，Python。", "2027届，博士学位，Python。", "2026届，本科及以上，Python。"]) {
    assert.equal(matchJob(profile, jobInput({ requirements }), now).eligible, "unsuitable", requirements);
  }
});

test("explicit description qualifications are checked when requirements are empty without using team biographies", () => {
  const profile: Profile = { ...profileInput, degree: "本科", version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const description of [
    "任职要求：博士学位；2027届；Python、PyTorch。",
    "任职资格\n博士学位，2027届，Python、PyTorch。\n公司介绍\n团队研究大模型。",
    "Qualifications: Ph.D. degree required; 2027届; Python, PyTorch.",
  ]) {
    const result = matchJob(profile, jobInput({ requirements: "  ", description }), now);
    assert.equal(result.eligible, "unsuitable", JSON.stringify(result));
    assert.ok(result.concerns.some(concern => /学历低于.*原文/.test(concern)));
    assert.ok(result.concerns.some(concern => /博士学位|Ph.D. degree required/.test(concern)));
  }
  for (const description of [
    "团队多位成员拥有博士学位。面向2027届，Python、PyTorch。",
    "岗位要求\n本科及以上，2027届，Python、PyTorch。\n团队介绍\n成员拥有博士学位。",
    "岗位要求：本科及以上，2027届，Python、PyTorch。团队介绍：成员拥有博士学位。",
  ]) {
    const result = matchJob(profile, jobInput({ requirements: "", description }), now);
    assert.equal(result.eligible, "likely", JSON.stringify(result));
    assert.ok(!result.concerns.some(concern => /学历低于/.test(concern)));
  }
  const structured = matchJob(profile, jobInput({
    requirements: "2027届，本科及以上，Python、PyTorch。", description: "博士学位 required（另一个岗位的介绍）。",
  }), now);
  assert.equal(structured.eligible, "likely", "nonempty explicit requirements retain precedence over a description");
});

test("preferred optional and negated degrees are never promoted to mandatory thresholds", () => {
  const profile: Profile = { ...profileInput, degree: "本科", version: 1, updatedAt: "2026-10-11T00:00:00Z" };
  const now = new Date("2026-10-11T00:00:00Z");
  for (const qualification of [
    "硕士学历优先", "不要求硕士学历", "无需博士学位", "硕士学历不是必须的",
    "Master's degree preferred", "Master’s degree optional", "Ph.D. degree not required",
    "No master's degree required", "A doctoral degree is not mandatory", "A master's degree is a plus",
    "Master's degree, preferred", "硕士学历，优先考虑",
  ]) {
    for (const fallback of [false, true]) {
      const detail = `2027届；${qualification}；Python、PyTorch。`;
      const result = matchJob(profile, jobInput(fallback ? {
        requirements: "", description: `任职要求：${detail}`,
      } : { requirements: detail }), now);
      assert.equal(result.eligible, "likely", `${qualification} fallback=${fallback}: ${JSON.stringify(result)}`);
      assert.ok(!result.reasons.some(reason => /学历满足/.test(reason)), "optional credentials must not imply a mandatory gate was passed");
    }
  }
  for (const qualification of [
    "Bachelor's degree required，Master's degree preferred",
    "Bachelor's degree required and Master's degree preferred",
  ]) {
    const mixed = matchJob(profile, jobInput({ requirements: `2027届，${qualification}，Python、PyTorch。` }), now);
    assert.equal(mixed.eligible, "likely");
    assert.ok(mixed.reasons.some(reason => /学历满足.*Bachelor's degree required/.test(reason)));
  }
  for (const requirements of [
    "2027届，不要求工作经验但需要硕士学历，Python、PyTorch。",
    "2027届，Python preferred and Master's degree required，PyTorch。",
  ]) {
    const result = matchJob(profile, jobInput({ requirements }), now);
    assert.equal(result.eligible, "unsuitable", "a qualifier for another condition must not erase the degree gate");
    assert.ok(result.concerns.some(concern => /学历低于.*原文/.test(concern)));
  }
  for (const requirements of [
    "2027届，Master's degree required for research；Bachelor's degree required for product，Python、PyTorch。",
    "2027届，硕士学历；条件优秀者可放宽，Python、PyTorch。",
    "2027届，Bachelor's degree required or Master's degree preferred，Python、PyTorch。",
  ]) {
    const result = matchJob(profile, jobInput({ requirements }), now);
    assert.equal(result.eligible, "review", JSON.stringify(result));
    assert.ok(result.concerns.some(concern => /人工确认.*原文/.test(concern)));
  }
});

test("invalid batches and dates never partially commit, and normal reopen retains data", async () => {
  await withStore(async ({ store, reopen }) => {
    await assert.rejects(store.upsertJobs([
      jobInput({ id: "valid-first" }), jobInput({ id: "bad-second", deadline: "2026-02-30" }),
    ]), /有效日期/);
    assert.deepEqual((await store.getState()).jobs, []);
    await assert.rejects(store.saveJob(jobInput({ type: "not-a-type" as JobInput["type"] })), /格式/);
    await assert.rejects(store.saveJob(jobInput({ url: "https://user:password@example.org/job" })), /凭据/);
    await assert.rejects(store.saveJob(jobInput({ url: "https://example.invalid/job", demo: false })), /真实岗位/);
    await store.saveProfile(profileInput, 0);
    await Promise.all(Array.from({ length: 8 }, (_, index) => store.saveJob(jobInput({
      id: `job-${index}`, url: `https://example.org/testing/${index}`,
    }))));
    const before = await store.getState();
    await assert.rejects(reopen(), /另一个 store/);
    await store.close();
    const second = await reopen();
    const after = await second.getState();
    assert.equal(after.jobs.length, 8);
    assert.deepEqual(after, before);
    await assert.rejects(store.getState(), /已关闭/);
  });
});

test("applications retain history per job and survive removal of the source job", async () => {
  await withStore(async ({ store, reopen }) => {
    const job = (await store.saveJob(jobInput())).jobs[0]!;
    const input = { jobId: job.id, company: job.company, title: job.title, url: job.url,
      status: "saved" as const, deadline: null, notes: "准备申请" };
    const first = (await store.saveApplication(input)).applications[0]!;
    assert.equal(first.history.length, 1);
    const updated = (await store.saveApplication({ ...input, status: "applied", notes: "用户手动标记已投递" })).applications[0]!;
    assert.equal(updated.id, first.id);
    assert.deepEqual(updated.history.map(event => event.status), ["saved", "applied"]);
    const repeat = (await store.saveApplication({ ...input, status: "applied", notes: "用户手动标记已投递" })).applications[0]!;
    assert.equal(repeat.history.length, 2);
    const afterRemoval = await store.deleteJob(job.id);
    assert.equal(afterRemoval.applications[0]!.id, first.id);
    assert.equal(afterRemoval.jobs.length, 0);
    await store.close();
    const second = await reopen();
    assert.deepEqual((await second.getState()).applications[0]!.history, repeat.history);
    await second.deleteApplication(first.id);
    assert.deepEqual((await second.getState()).applications, []);
  });
});

test("tracking an already applied job preserves its status, notes and history", async () => {
  await withStore(async ({ store }) => {
    const job = (await store.saveJob(jobInput())).jobs[0]!;
    const saved = await store.saveApplication({
      jobId: job.id, company: job.company, title: job.title, url: job.url,
      status: "applied", deadline: job.deadline, notes: "已投递；等待笔试通知，不能覆盖。",
    });
    const application = saved.applications[0]!;
    const result = await store.trackJob(job.id);
    assert.equal(result.applications.length, 1);
    assert.deepEqual(result.applications[0], application);
    // Tracking again is also harmless if the source job was subsequently removed.
    await store.deleteJob(job.id);
    assert.deepEqual((await store.trackJob(job.id)).applications[0], application);
  });
});

test("concurrent trackJob calls create one saved record and never reset an intervening update", async () => {
  await withStore(async ({ store }) => {
    const job = (await store.saveJob(jobInput())).jobs[0]!;
    await Promise.all(Array.from({ length: 8 }, () => store.trackJob(job.id)));
    const application = (await store.getState()).applications[0]!;
    assert.equal((await store.getState()).applications.length, 1);
    assert.equal(application.status, "saved");
    assert.equal(application.history.length, 1);

    await Promise.all([
      store.saveApplication({
        id: application.id, jobId: job.id, company: job.company, title: job.title, url: job.url,
        status: "applied", deadline: job.deadline, notes: "并发期间用户更新的投递备注",
      }),
      store.trackJob(job.id), store.trackJob(job.id),
    ]);
    const latest = (await store.getState()).applications;
    assert.equal(latest.length, 1);
    assert.equal(latest[0]!.id, application.id);
    assert.equal(latest[0]!.status, "applied");
    assert.equal(latest[0]!.notes, "并发期间用户更新的投递备注");
    assert.deepEqual(latest[0]!.history.map(event => event.status), ["saved", "applied"]);
    await assert.rejects(store.trackJob("missing-job"), /岗位不存在/);
    assert.equal((await store.getState()).applications.length, 1);
  });
});

test("demo load and clear preserve confirmed profile and real user records", async () => {
  await withStore(async ({ store }) => {
    const saved = await store.saveProfile(profileInput, 0);
    const job = (await store.saveJob(jobInput())).jobs[0]!;
    await store.saveApplication({ company: job.company, title: job.title, jobId: job.id, url: job.url,
      status: "applied", deadline: null, notes: "手动测试记录" });
    const loaded = await store.loadDemo();
    assert.deepEqual(loaded.profile, saved.profile);
    assert.equal(loaded.jobs.filter(job => job.demo).length, 3);
    assert.ok(loaded.jobs.filter(job => job.demo).every(job => new URL(job.url).hostname === "example.invalid" && job.publishedAt === null));
    assert.equal(loaded.applications.filter(application => application.demo).length, 3);
    assert.equal((await store.loadDemo()).applications.length, loaded.applications.length);
    const cleared = await store.clearDemo();
    assert.equal(cleared.jobs.length, 1);
    assert.equal(cleared.applications.length, 1);
    assert.equal(cleared.jobs[0]!.id, job.id);
    assert.equal(cleared.applications[0]!.status, "applied");
    assert.deepEqual(cleared.profile, saved.profile);
    assert.equal(cleared.settings.showDemo, false);
  });
});

test("source runs retain the last thirty and failed collection cannot claim added jobs", async () => {
  await withStore(async ({ store }) => {
    for (let index = 0; index < 35; index++) await store.recordSourceRun({
      id: `run-${index}`, sourceId: "test", sourceName: "测试来源", status: "success", count: 1,
      observedAt: new Date(Date.UTC(2026, 9, 11, 0, index)).toISOString(),
    });
    const state = await store.getState();
    assert.equal(state.sourceRuns.length, 30);
    assert.equal(state.sourceRuns[0]!.id, "run-34");
    assert.ok(!state.sourceRuns.some(run => run.id === "run-0"));
    await assert.rejects(store.recordSourceRun({
      id: "failed-bad", sourceId: "test", sourceName: "测试来源", status: "failed", count: 2,
      observedAt: new Date().toISOString(), error: "模拟失败",
    }), /新增岗位/);
  });
});

test("unfinished action intents reopen as unknown, never replay, and credentials are not stored", async () => {
  await withStore(async ({ store, reopen }) => {
    const now = new Date().toISOString();
    const action = { id: "action-1", planId: "plan-1", status: "intent" as const,
      createdAt: now, updatedAt: now, payload: { url: "https://example.org/form", profileVersion: 1 } };
    await assert.rejects(store.recordAction({ ...action, payload: { apiKey: "NEVER_PERSIST_THIS" } }), /凭据/);
    await store.recordAction(action);
    await assert.rejects(store.recordAction(action), /覆盖操作日志/);
    await store.close();
    const next = await reopen();
    const stored = (await next.getActions())[0]!;
    assert.equal(stored.status, "unknown");
    assert.deepEqual(stored.payload, action.payload);
    assert.match(JSON.stringify(stored.result), /不会自动重放/);
    await next.updateAction(action.id, "verified", { verified: ["field-1"], optional: undefined });
    assert.equal((await next.getActions())[0]!.status, "verified");
    await assert.rejects(next.updateAction(action.id, "unknown", { reason: "overwrite" }), /已验证/);
    const exported = await next.exportState();
    assert.ok(!JSON.stringify(exported).includes("apiKey"));
    assert.ok(!(await readFile(next.databasePath)).includes(Buffer.from("NEVER_PERSIST_THIS")));
  });
});

test("an empty or corrupted SQLite file is rejected and preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "offeragent-corrupt-"));
  try {
    const path = join(directory, "offeragent.sqlite");
    await writeFile(path, "");
    await assert.rejects(createStore({ directory }), /文件头有误/);
    assert.equal((await readFile(path)).length, 0);
    await writeFile(path, "not a database");
    await assert.rejects(createStore({ directory }), /文件头有误/);
    assert.equal(await readFile(path, "utf8"), "not a database");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
