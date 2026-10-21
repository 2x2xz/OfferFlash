import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, type DomainStore } from '../packages/domain/src/store.js';
import { normalizePersonalProfile, normalizeProfile } from '../packages/domain/src/validation.js';
import { confirmedPersonalProfile, emptyPersonalInput, personalHasContent, pickPersonalInput } from '../packages/profile/src/personal-input.js';
import { emptyCareerInput, newCareerRecord, pickCareerInput } from '../packages/profile/src/career-input.js';
import { getProfileSummary } from '../packages/agent/src/profile-summary.js';
import { buildJobMatchingInput } from '../packages/agent/src/job-matching.js';
import { buildApplyDockImport } from '../packages/profile/src/applydock.js';
import { applyApplicationFactsSelection, buildApplicationFactsPreview } from '../packages/profile/src/application-facts.js';
import type { PersonalProfileInput, Profile, ProfileInput } from '../packages/shared/src/contracts.js';

const basics = (): Omit<ProfileInput, 'career' | 'personal'> => ({ fullName: '虚构测试用户', fullNameEn: '', phone: '', email: '', school: '', schoolEn: '', degree: '', major: '', majorEn: '', graduationMonth: '', skills: ['Python'], cities: [], targetRoles: ['算法'], resumeText: '' });
function personal(): PersonalProfileInput {
  return { schemaVersion: 1, languages: [
    { id: 'language-one', language: '虚构语言甲', examName: '虚构考试甲', score: 'A', certificateName: '', selfAssessment: '用户原文能力说明', listeningSpeaking: '', readingWriting: '', sourceNote: '用户明确提供' },
    { id: 'language-two', language: '虚构语言乙', examName: '虚构考试乙', score: '81 / 120', certificateName: '虚构证书乙', selfAssessment: '', listeningSpeaking: '', readingWriting: '', sourceNote: '虚构证书材料' },
  ], software: [{ id: 'software-one', name: '虚构工具', proficiency: '', description: '做过原创测试项目', sourceNote: '' }],
  awards: [{ id: 'award-one', name: '虚构荣誉', issuer: '虚构机构', date: '2025', description: '', sourceNote: '' }],
  selfEvaluation: '第一段原创虚构自评。\n第二段原文保留。', sourceNote: '测试资料，非真实用户信息' };
}
function input(profile: Profile): ProfileInput {
  const { version: _version, updatedAt: _updatedAt, personal: saved, career, ...rest } = profile;
  return { ...rest, ...(saved ? { personal: pickPersonalInput(saved) } : {}), ...(career ? { career: pickCareerInput(career) } : {}) };
}
async function withStore(body: (store: DomainStore, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'offerflash-personal-'));
  const store = await createStore({ directory });
  try { await body(store, directory); } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('older profiles retain absent optional fields; saving basics does not invent personal facts', async () => withStore(async store => {
  const initial = (await store.getState()).profile;
  assert.ok(!Object.hasOwn(initial, 'personal')); assert.ok(!Object.hasOwn(initial, 'birthDate'));
  const saved = (await store.saveProfile(basics(), initial.version)).profile;
  assert.ok(!Object.hasOwn(saved, 'personal')); assert.ok(!Object.hasOwn(saved, 'birthDate'));
  assert.equal(confirmedPersonalProfile(saved), undefined);
}));

test('personal saves are pending; only host version/revision confirmation seals the current facts', async () => withStore(async store => {
  let saved = (await store.saveProfile({ ...basics(), birthDate: '2000-02-29', personal: personal() }, 0)).profile;
  assert.equal(saved.personal!.revision, 1); assert.equal(saved.personal!.confirmedRevision, null); assert.equal(saved.personal!.confirmedAt, null);
  assert.equal(confirmedPersonalProfile(saved), undefined);
  const previousVersion = saved.version;
  saved = (await store.confirmPersonalProfile(saved.version, saved.personal!.revision)).profile;
  assert.equal(saved.version, previousVersion + 1); assert.equal(saved.personal!.revision, 1);
  assert.equal(saved.personal!.confirmedRevision, 1); assert.ok(saved.personal!.confirmedAt);
  assert.equal(confirmedPersonalProfile(saved), saved.personal);
  assert.equal(saved.personal!.languages[0]!.score, 'A');
  assert.equal(saved.personal!.languages[0]!.certificateName, '');
  assert.equal(saved.personal!.languages[0]!.listeningSpeaking, ''); assert.equal(saved.personal!.languages[0]!.readingWriting, '');
  assert.equal(saved.personal!.software[0]!.proficiency, '');
  assert.equal(saved.personal!.selfEvaluation, personal().selfEvaluation);
}));

test('unchanged saves and older callers preserve seals, birth date, bank originals and other business records', async () => withStore(async store => {
  let saved = (await store.saveProfile({ ...basics(), birthDate: '1999-12-01', personal: personal() }, 0)).profile;
  saved = (await store.confirmPersonalProfile(saved.version, 1)).profile;
  const confirmed = structuredClone(saved.personal);
  const bank = await store.assets.saveAnswer({ questionPattern: '虚构语言原文', answer: '保留本地原答案，不拆字段。', scope: { kind: 'general' }, risk: 'ordinary', demo: false }, null);
  const answerBefore = structuredClone(bank.answers);
  const application = { company: '虚构公司', title: '虚构岗位', url: '', status: 'saved' as const, deadline: null, notes: '保留原记录' };
  const before = (await store.saveApplication(application)).applications;
  saved = (await store.saveProfile(input(saved), saved.version)).profile;
  assert.deepEqual(saved.personal, confirmed);
  const state = await store.saveProfile(basics(), saved.version);
  assert.deepEqual(state.profile.personal, confirmed); assert.equal(state.profile.birthDate, '1999-12-01');
  assert.deepEqual((await store.assets.getState()).answers, answerBefore); assert.deepEqual(state.applications, before);
}));

test('editing personal data invalidates its seal without altering sources in previous saved state', async () => withStore(async store => {
  let saved = (await store.saveProfile({ ...basics(), personal: personal() }, 0)).profile;
  saved = (await store.confirmPersonalProfile(saved.version, 1)).profile;
  const original = structuredClone(saved);
  const draft = input(saved); draft.personal!.languages[0]!.selfAssessment = '新的明确自评';
  saved = (await store.saveProfile(draft, saved.version)).profile;
  assert.equal(saved.personal!.revision, 2); assert.equal(saved.personal!.confirmedRevision, null); assert.equal(saved.personal!.confirmedAt, null);
  assert.equal(confirmedPersonalProfile(saved), undefined); assert.equal(original.personal!.languages[0]!.selfAssessment, '用户原文能力说明');
  await assert.rejects(store.confirmPersonalProfile(original.version, 1), /更新/);
  await assert.rejects(store.confirmPersonalProfile(saved.version, 1), /修改/);
  saved = (await store.confirmPersonalProfile(saved.version, 2)).profile;
  assert.equal(saved.personal!.confirmedRevision, 2);
}));

test('confirmation rejects empty and unnamed partial records instead of generating false facts', async () => withStore(async store => {
  let saved = (await store.saveProfile({ ...basics(), personal: emptyPersonalInput() }, 0)).profile;
  assert.equal(personalHasContent(saved.personal), false);
  await assert.rejects(store.confirmPersonalProfile(saved.version, 1), /先填写/);
  const partial = personal(); partial.languages[0]!.language = '';
  saved = (await store.saveProfile({ ...input(saved), personal: partial }, saved.version)).profile;
  await assert.rejects(store.confirmPersonalProfile(saved.version, saved.personal!.revision), /名称/);
  await assert.rejects(store.confirmPersonalProfile(-1, 1), /有效/);
}));

test('birth dates require a complete calendar date and explicit empty values may clear them', async () => withStore(async store => {
  for (const birthDate of ['2000', '2000-02', '2025-02-29', '2000-13-01', '2000-02-30', '2000-2-1']) {
    assert.throws(() => normalizeProfile({ ...basics(), birthDate }), /日期/);
  }
  const saved = await store.saveProfile({ ...basics(), birthDate: '2000-02-29' }, 0);
  const cleared = await store.saveProfile({ ...input(saved.profile), birthDate: '' }, saved.profile.version);
  assert.equal(cleared.profile.birthDate, '');
}));

test('strict input DTOs reject fabricated seals, duplicate IDs and unbounded records', () => {
  assert.throws(() => normalizePersonalProfile({ ...personal(), revision: 1, confirmedRevision: 1, confirmedAt: '2026-01-01' }), /字段/);
  const duplicate = personal(); duplicate.software[0]!.id = duplicate.languages[0]!.id;
  assert.throws(() => normalizePersonalProfile(duplicate), /重复/);
  const tooMany = personal(); tooMany.languages = Array.from({ length: 51 }, (_, i) => ({ ...personal().languages[0]!, id: `language-${i}` }));
  assert.throws(() => normalizePersonalProfile(tooMany), /字段/);
  const invalid = personal(); invalid.awards[0]!.date = '2025-02-30'; assert.throws(() => normalizePersonalProfile(invalid), /日期/);
});

test('blank rows are removed and score, certificate and self-assessment remain independent', () => {
  const draft = emptyPersonalInput();
  draft.languages.push({ id: 'blank', language: ' ', examName: '', score: '', certificateName: '', selfAssessment: '', listeningSpeaking: '', readingWriting: '', sourceNote: '只有备注' });
  assert.deepEqual(normalizePersonalProfile(draft).languages, []);
  const result = normalizePersonalProfile(personal()); assert.equal(result.languages[0]!.certificateName, '');
  assert.equal(result.languages[1]!.selfAssessment, ''); assert.equal(result.languages[1]!.listeningSpeaking, '');
  assert.equal(result.languages[1]!.readingWriting, ''); assert.equal(result.languages[1]!.score, '81 / 120');
});

test('personal DTO projection removes host metadata while preserving every explicit entry and source note', () => {
  const saved = { ...personal(), revision: 3, confirmedRevision: 3, confirmedAt: '2026-01-01T00:00:00Z' };
  const projected = pickPersonalInput(saved);
  assert.deepEqual(projected, personal()); assert.ok(!Object.hasOwn(projected, 'revision')); assert.ok(!Object.hasOwn(projected, 'confirmedAt'));
});

test('birth, languages, software, awards and evaluation remain outside model summaries and job matching requests', async () => withStore(async store => {
  let saved = (await store.saveProfile({ ...basics(), birthDate: '2000-02-29', personal: personal() }, 0)).profile;
  saved = (await store.confirmPersonalProfile(saved.version, 1)).profile;
  const summary = JSON.stringify(getProfileSummary(saved));
  const matching = JSON.stringify(buildJobMatchingInput(saved, [], '2026-10-21T00:00:00.000Z', { includeCareerDetails: true }));
  for (const output of [summary, matching]) assert.doesNotMatch(output, /birthDate|personal|2000-02-29|虚构语言甲|虚构工具|虚构荣誉|第一段原创/);
}));

test('education categories survive DTOs and old saves without silently changing confirmed default education', async () => withStore(async store => {
  const career = emptyCareerInput();
  career.educations.push({ ...newCareerRecord('educations', 'education-one'), school: '虚构大学', degree: '本科', major: '计算机',
    majorCategory: '用户明确专业类别', schoolCategory: '用户明确学校类别', studyMode: '全日制' });
  let saved = (await store.saveProfile({ ...basics(), career }, 0)).profile;
  saved = (await store.confirmCareerRecord('educations', 'education-one', saved.version, 1)).profile;
  const selected = input(saved); selected.career!.primaryEducationId = 'education-one';
  saved = (await store.saveProfile(selected, saved.version)).profile;
  const { career: _career, ...oldCaller } = input(saved);
  saved = (await store.saveProfile(oldCaller, saved.version)).profile;
  assert.equal(saved.career!.primaryEducationId, 'education-one'); assert.equal(saved.career!.educations[0]!.confirmation, 'confirmed');
  assert.equal(pickCareerInput(saved.career).educations[0]!.majorCategory, '用户明确专业类别');
  assert.equal(saved.career!.educations[0]!.schoolCategory, '用户明确学校类别'); assert.equal(saved.career!.educations[0]!.studyMode, '全日制');
}));

test('reopen preserves the current personal seal and callers cannot import arbitrary confirmed answer text as facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offerflash-personal-reopen-'));
  let store = await createStore({ directory });
  try {
    let saved = (await store.saveProfile({ ...basics(), birthDate: '2000-02-29', personal: personal() }, 0)).profile;
    saved = (await store.confirmPersonalProfile(saved.version, 1)).profile;
    await store.close(); store = await createStore({ directory });
    assert.deepEqual((await store.getState()).profile.personal, saved.personal);
    const imported = buildApplyDockImport(new TextEncoder().encode(JSON.stringify({ version: 1, clips: [], applications: [] })), saved);
    assert.deepEqual(imported.profile.personal, personal()); assert.equal(imported.profile.birthDate, saved.birthDate);
    const preview = buildApplicationFactsPreview(JSON.stringify({ schemaVersion: 1, educations: [], internships: [], projects: [] }), saved);
    const draft = applyApplicationFactsSelection(preview, saved, []);
    assert.deepEqual(draft.personal, personal()); assert.equal(draft.birthDate, saved.birthDate);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
