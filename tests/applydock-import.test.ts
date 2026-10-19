import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplyDockImport } from '../packages/profile/src/applydock.js';
import { emptyCareer, profileCareerOnSave } from '../packages/domain/src/career.js';
import type { Profile } from '../packages/shared/src/contracts.js';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const clip = (id: string, category: string, label: string, value: string) => ({ id, category, label, value });
function profile(): Profile {
  return { fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '', degree: '', major: '', majorEn: '',
    graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '', career: emptyCareer(), version: 3, updatedAt: '2026-01-01T00:00:00.000Z' };
}
function populated(): Profile {
  const current = profile();
  current.fullName = '虚构已有用户'; current.email = 'kept@example.invalid';
  current.career!.sources.push({ id: 'source-original', kind: 'manual', label: '原资料', text: '虚构大学 原文', createdAt: current.updatedAt });
  current.career!.educations.push({ id: 'education-original', school: '虚构大学', schoolEn: '', degree: '硕士', major: '计算机', majorEn: '',
    startDate: '', endDate: '2027-06', description: '', sourceNote: '原资料保持',
    evidence: [{ field: 'school', sourceId: 'source-original', quote: '虚构大学', originalValue: '虚构大学', location: '原位置' }],
    revision: 2, confirmation: 'confirmed', confirmedRevision: 2, confirmedAt: current.updatedAt });
  current.career!.primaryEducationId = 'education-original';
  current.school = '虚构大学'; current.degree = '硕士'; current.major = '计算机'; current.graduationMonth = '2027-06';
  current.career!.internships.push({ id: 'intern-original', organization: '虚构实验室', role: '', startDate: '2025-06', endDate: '', current: false,
    description: '保留原有说明', technologies: [], sourceNote: '原说明', evidence: [], revision: 1, confirmation: 'confirmed', confirmedRevision: 1, confirmedAt: current.updatedAt });
  current.career!.projects.push({ id: 'project-original', name: '虚构检索助手', role: '', startDate: '', endDate: '', ongoing: false,
    description: '', technologies: [], url: '', sourceNote: '已有项目', evidence: [], revision: 1, confirmation: 'confirmed', confirmedRevision: 1, confirmedAt: current.updatedAt });
  return current;
}
const archive = (clips: unknown[], applications: unknown[] = []) => ({ version: 1, clips, applications });

test('ApplyDock archive supplements only empty ordinary fields and never imports applications or root secrets', () => {
  const current = populated(), before = structuredClone(current);
  const result = buildApplyDockImport(bytes({ ...archive([
    clip('basic:name', '基本信息', '姓名', '虚构新姓名'), clip('basic:email', '基本信息', '邮箱', 'new@example.invalid'),
    clip('basic:phone', '基本信息', '手机号', '123456789'), clip('basic:fullNameEn', '基本信息', '英文姓名', 'Fictional Person'),
  ], [{ notes: 'private-application-note', stage: 'Offer' }]), apiKey: 'sk-' + 'ThisIsAFictionalCredentialValue' }), current);
  assert.equal(result.profile.fullName, before.fullName); assert.equal(result.profile.email, before.email);
  assert.equal(result.profile.phone, '123456789'); assert.equal(result.profile.fullNameEn, 'Fictional Person');
  assert.deepEqual(result.conflicts.map(item => item.field).sort(), ['email', 'fullName']);
  assert.equal(result.profile.career!.sources[1]!.kind, 'manual');
  assert.equal(result.sourceLabel, 'ApplyDock 已保存资料导入');
  assert.doesNotMatch(JSON.stringify(result), /private-application-note|sk[-]ThisIsAFictionalCredentialValue|applications/);
  assert.ok(!('version' in result.profile)); assert.ok(!('updatedAt' in result.profile));
  assert.deepEqual(current, before, 'conversion must not mutate its input');
});

test('ApplyDock excludes unsupported identity/contact attributes and obvious credential clips from source text too', () => {
  const result = buildApplyDockImport(bytes(archive([
    clip('basic:birthDate', '基本信息', '出生日期', '2000-01-01'), clip('basic:wechat', '基本信息', '微信', 'fictional-wechat'),
    clip('custom-passport', '基本信息', '护照号', 'fictional-passport'), clip('snippet:api-key', '技能与其他', 'API Key', 'not-a-real-key'),
    clip('snippet:notes', '技能与其他', '配置', 'sk-' + 'ThisIsAFictionalCredentialValue'),
    clip('basic:name', '基本信息', '姓名', '虚构用户'),
  ])), profile());
  assert.equal(result.profile.fullName, '虚构用户');
  assert.doesNotMatch(JSON.stringify(result), /2000-01-01|fictional-wechat|fictional-passport|not-a-real-key|sk-This/);
  assert.ok(result.warnings.length);
});

test('multiple education source groups retain deterministic distinct identities and never select a default', () => {
  const data = bytes(archive([
    clip('education:first:school', '教育经历', '学校 · 本科', '虚构本科大学'),
    clip('education:first:degree', '教育经历', '学历 · 本科', '本科'),
    clip('education:first:start', '教育经历', '入学时间 · 本科', '2020年'),
    clip('education:second:school', '教育经历', '学校 · 硕士', '虚构硕士大学'),
    clip('education:second:degree', '教育经历', '学历 · 硕士', '硕士'),
    clip('education:second:end', '教育经历', '毕业时间 · 硕士', '2027年6月'),
  ]));
  const result = buildApplyDockImport(data, profile());
  assert.equal(result.profile.career!.educations.length, 2);
  assert.equal(new Set(result.profile.career!.educations.map(item => item.id)).size, 2);
  assert.equal(result.profile.career!.educations[0]!.startDate, '2020');
  assert.equal(result.profile.career!.educations[1]!.endDate, '2027-06');
  assert.equal(result.profile.career!.primaryEducationId, null);
  for (const record of result.profile.career!.educations) {
    assert.ok(!('confirmation' in record)); assert.ok(!('revision' in record));
    assert.ok(record.evidence.every(item => result.profile.career!.sources[0]!.text.includes(item.quote)));
  }
  const saved = profileCareerOnSave(result.profile, profile(), '2026-01-02T00:00:00.000Z');
  assert.ok(saved.career.educations.every(item => 'confirmation' in item && item.confirmation === 'pending' && 'confirmedAt' in item && item.confirmedAt === null));
  const repeated = buildApplyDockImport(data, { ...profile(), ...saved });
  assert.equal(repeated.profile.career!.educations.length, 2);
  assert.equal(repeated.changes.length, 0, 'same archive must not duplicate groups or provenance');
});

test('the confirmed default education, its evidence and original sources are preserved byte for byte', () => {
  const current = populated();
  const result = buildApplyDockImport(bytes(archive([
    clip('education:master:school', '教育经历', '学校 · 硕士', '虚构大学'),
    clip('education:master:degree', '教育经历', '学历 · 硕士', '硕士'),
    clip('education:master:major', '教育经历', '专业 · 硕士', '不同专业'),
    clip('education:master:start', '教育经历', '入学时间 · 硕士', '2025-09'),
  ])), current);
  assert.equal(result.profile.career!.primaryEducationId, current.career!.primaryEducationId);
  const { revision: _r, confirmation: _c, confirmedRevision: _cr, confirmedAt: _ca, ...original } = current.career!.educations[0]!;
  assert.deepEqual(result.profile.career!.educations[0], original);
  const { createdAt: _at, ...source } = current.career!.sources[0]!;
  assert.deepEqual(result.profile.career!.sources[0], source);
  assert.ok(result.conflicts.some(item => item.recordId === original.id && item.field === 'major'));
  assert.ok(result.warnings.some(item => item.includes('默认教育')));
  const saved = profileCareerOnSave(result.profile, current, '2026-01-02T00:00:00.000Z');
  assert.equal(saved.career.educations[0]!.confirmation, 'confirmed');
  assert.equal(saved.career.primaryEducationId, current.career!.primaryEducationId);
});

test('explicit labelled roles and links supplement uniquely matching existing experiences and become pending on save', () => {
  const current = populated();
  const result = buildApplyDockImport(bytes(archive([
    clip('custom-role', '实习经历', '职务 · 虚构实验室', '研究实习生'),
    clip('custom-end', '实习经历', '结束时间 · 虚构实验室', '2025年9月'),
    clip('custom-project-role', '项目经历', '项目角色 · 虚构检索助手', '独立开发'),
    clip('custom-project-url', '项目经历', '项目链接 · 虚构检索助手', 'https://example.invalid/fictional'),
  ])), current);
  assert.equal(result.profile.career!.internships[0]!.role, '研究实习生');
  assert.equal(result.profile.career!.internships[0]!.endDate, '2025-09');
  assert.equal(result.profile.career!.internships[0]!.current, false);
  assert.equal(result.profile.career!.projects[0]!.role, '独立开发');
  assert.equal(result.profile.career!.projects[0]!.url, 'https://example.invalid/fictional');
  assert.equal(result.profile.career!.internships[0]!.sourceNote, '原说明');
  const saved = profileCareerOnSave(result.profile, current, '2026-01-02T00:00:00.000Z');
  assert.equal(saved.career.internships[0]!.confirmation, 'pending');
  assert.equal(saved.career.projects[0]!.confirmation, 'pending');
  assert.equal(saved.career.primaryEducationId, current.career!.primaryEducationId);
});

test('explicit grouped snippet IDs work without labels when their identity clip uniquely names a record', () => {
  const result = buildApplyDockImport(bytes(archive([
    clip('snippet:intern-fixture-company', '实习经历', 'fixture', '虚构实验室'),
    clip('snippet:intern-fixture-role', '实习经历', 'fixture', '算法实习生'),
    clip('snippet:project-fixture-name', '项目经历', 'fixture', '虚构检索助手'),
    clip('snippet:project-fixture-link', '项目经历', 'fixture', 'https://example.invalid/project'),
  ])), populated());
  assert.equal(result.profile.career!.internships[0]!.role, '算法实习生');
  assert.equal(result.profile.career!.projects[0]!.url, 'https://example.invalid/project');
});

test('single-group and numbered source IDs remain explicit groups instead of relying on record order', () => {
  const result = buildApplyDockImport(bytes(archive([
    clip('snippet:intern-company', '实习经历', 'fixture', '虚构实验室'),
    clip('snippet:intern-role', '实习经历', 'fixture', '算法实习生'),
    clip('snippet:project1-name', '项目经历', 'fixture', '虚构检索助手'),
    clip('snippet:project1-link', '项目经历', 'fixture', 'https://example.invalid/project'),
  ])), populated());
  assert.equal(result.profile.career!.internships[0]!.role, '算法实习生');
  assert.equal(result.profile.career!.projects[0]!.url, 'https://example.invalid/project');
  assert.equal(result.profile.career!.internships.length, 1); assert.equal(result.profile.career!.projects.length, 1);
});

test('untrusted field names cannot use inherited object properties as supported profile fields', () => {
  const result = buildApplyDockImport(bytes(archive([
    clip('basic:__proto__', '基本信息', '__proto__', 'not-a-field'),
    clip('education:fixture:constructor', '教育经历', 'constructor', 'not-an-education'),
    clip('snippet:project1:toString', '项目经历', 'toString', 'not-a-project-field'),
  ])), profile());
  assert.equal(result.profile.fullName, '');
  assert.equal(result.profile.career!.educations.length, 0);
  assert.equal(result.profile.career!.projects.length, 0);
  assert.ok(!Object.hasOwn(result.profile, '__proto__'));
});

test('ambiguous schools or companies cannot select an experience and unknown snippets remain original sources', () => {
  const current = populated();
  current.career!.internships.push({ ...current.career!.internships[0]!, id: 'intern-second' });
  const result = buildApplyDockImport(bytes(archive([
    clip('custom-role', '实习经历', '职务 · 虚构实验室', '不应选择'),
    clip('snippet:project-complete', '项目经历', '完整经历', '第一行\n第二行：存在介绍，但不推断角色和时间。'),
    clip('snippet:project-new-role', '项目经历', '角色', '不应凭角色创建项目'),
  ])), current);
  assert.ok(result.profile.career!.internships.every(item => item.role === ''));
  assert.equal(result.profile.career!.projects.length, 1);
  assert.ok(result.conflicts.some(item => item.field === 'internships.identity'));
  assert.ok(result.profile.career!.sources.at(-1)!.text.includes('第一行\n第二行'));
  assert.ok(!result.changes.some(item => item.recordId));
});

test('conflicting candidates do not fill an empty field with whichever happened to appear first', () => {
  const current = populated();
  const result = buildApplyDockImport(bytes(archive([
    clip('role-a', '项目经历', '项目角色 · 虚构检索助手', '研发'),
    clip('role-b', '项目经历', '角色 · 虚构检索助手', '研究'),
    clip('email-a', '基本信息', '邮箱', 'first@example.invalid'),
    clip('email-b', '基本信息', '电子邮箱', 'second@example.invalid'),
  ])), current);
  assert.equal(result.profile.career!.projects[0]!.role, '');
  assert.equal(result.profile.email, current.email);
  assert.deepEqual(new Set(result.conflicts.map(item => item.field)), new Set(['email', 'role']));
});

test('unknown dates, credential URLs and incompatible end dates remain unfilled', () => {
  const current = populated(); current.career!.internships[0]!.current = true;
  const result = buildApplyDockImport(bytes(archive([
    clip('end', '实习经历', '结束时间 · 虚构实验室', '2026-06'),
    clip('project-start', '项目经历', '开始时间 · 虚构检索助手', '预计明年'),
    clip('project-url', '项目经历', '项目链接 · 虚构检索助手', 'https://example.invalid/?token=fictional'),
  ])), current);
  assert.equal(result.profile.career!.internships[0]!.endDate, '');
  assert.equal(result.profile.career!.internships[0]!.current, true);
  assert.equal(result.profile.career!.projects[0]!.startDate, '');
  assert.equal(result.profile.career!.projects[0]!.url, '');
  assert.ok(!result.profile.career!.sources.some(item => item.text.includes('token=fictional')));
  assert.ok(result.conflicts.some(item => item.field === 'endDate'));
});

test('legacy fields, education and snippets use the same non-destructive conversion and preserve multiline provenance', () => {
  const result = buildApplyDockImport(bytes({ fields: { name: '虚构用户', school: '不要重复', birthDate: '2000-01-01' },
    education: [{ id: 'legacy-one', school: '虚构大学', degree: '本科', start: '2020', end: '2024年6月' }],
    snippets: [{ id: 'project-originaltext', label: '项目原文', value: '第一行\n第二行' }], resumeRevision: 'fixture' }), profile());
  assert.equal(result.profile.fullName, '虚构用户');
  assert.equal(result.profile.career!.educations.length, 1);
  assert.equal(result.profile.career!.educations[0]!.school, '虚构大学');
  assert.equal(result.profile.career!.educations[0]!.startDate, '2020');
  assert.ok(result.profile.career!.sources[0]!.text.includes('第一行\n第二行'));
  assert.doesNotMatch(JSON.stringify(result), /2000-01-01/);
});

test('legacy single education fields become an unconfirmed group without inventing dates or a default', () => {
  const result = buildApplyDockImport(bytes({ fields: { school: '虚构学院', degree: '本科', major: '数学', graduation: '2024' } }), profile());
  assert.equal(result.profile.career!.educations.length, 1);
  assert.equal(result.profile.career!.educations[0]!.endDate, '2024');
  assert.equal(result.profile.career!.primaryEducationId, null);
  assert.equal(result.profile.school, '');
});

test('an existing legacy OfferAgent education survives the import through the existing migration contract', () => {
  const current = populated(); delete current.career;
  const result = buildApplyDockImport(bytes(archive([clip('basic:phone', '基本信息', '手机号', '123456789')])), current);
  assert.equal(result.profile.school, current.school);
  assert.equal(result.profile.career!.educations.length, 1);
  assert.equal(result.profile.career!.primaryEducationId, 'legacy-education');
  const saved = profileCareerOnSave(result.profile, current, '2026-01-02T00:00:00.000Z');
  assert.equal(saved.career.primaryEducationId, 'legacy-education');
  assert.equal(saved.career.educations[0]!.confirmation, 'confirmed');
  assert.equal(saved.school, current.school);
});

test('malformed structures, duplicate clip IDs, unsupported versions and oversized files are rejected', () => {
  for (const value of [null, [], {}, { version: 2, clips: [], applications: [] }, { version: 1, clips: {}, applications: [] },
    { version: 1, clips: [clip('same', '', '', 'a'), clip('same', '', '', 'b')], applications: [] },
    { version: 1, clips: [{ id: 'missing', category: '', label: '' }], applications: [] },
    { fields: { name: 3 } }, { fields: {}, education: [{ id: 'a', school: 'A' }, { id: 'a', school: 'B' }] },
    { fields: {}, education: [{ id: 'a' }, { id: 'a' }] },
    archive(Array.from({ length: 501 }, (_, i) => clip(String(i), '', '', ''))),
  ]) assert.throws(() => buildApplyDockImport(bytes(value), profile()), /格式/);
  assert.throws(() => buildApplyDockImport(new Uint8Array(2 * 1024 * 1024 + 1), profile()), /格式/);
  assert.throws(() => buildApplyDockImport(Uint8Array.of(255), profile()), /格式/);
});
