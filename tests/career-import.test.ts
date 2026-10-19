import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { normalizeCareerDate, parseCareerCandidates } from '../packages/profile/src/career-import.js';
import { readResume } from '../packages/profile/src/import.js';
import { normalizeCareer } from '../packages/domain/src/validation.js';

function parse(text: string) { return parseCareerCandidates({ text, fileName: 'fictional.txt', fileHash: createHash('sha256').update(text).digest('hex') }); }
function normalized(text: string) { return text.replace(/\s+/g, ' ').trim(); }
function checkEvidence(result: ReturnType<typeof parse>) {
  assert.doesNotThrow(() => normalizeCareer(result.career), 'import candidates must meet the shared save contract');
  const source = result.career.sources[0]!;
  for (const record of [...result.career.educations, ...result.career.internships, ...result.career.projects, ...result.career.publications]) {
    assert.ok(record.evidence.length);
    assert.ok(!('revision' in record)); assert.ok(!('confirmation' in record)); assert.ok(!('confirmedAt' in record));
    for (const evidence of record.evidence) {
      assert.equal(evidence.sourceId, source.id);
      assert.ok(normalized(source.text).includes(normalized(evidence.quote)), evidence.quote);
      assert.ok(evidence.location);
    }
  }
  assert.equal(result.career.primaryEducationId, null);
}

test('negated or future paper states remain pending progress candidates with their original evidence', () => {
  for (const status of ['not accepted', 'not submitted', 'will be published', 'has not been accepted', '尚未投稿', '未接收', '拟发表', '待接收', '计划投稿中']) {
    const result = parse(`Publications\nTitle: Fictional Paper\nStatus: ${status}`);
    assert.equal(result.career.publications[0]?.status, 'in-progress', status);
    assert.ok(result.warnings.some(value => value.includes('状态')), status);
    assert.ok(result.career.publications[0]?.evidence.some(value => value.field === 'status' && value.originalValue === status));
    checkEvidence(result);
  }
  const accepted = parse('论文发表\n论文标题：虚构论文\n论文状态：已录用、尚未发表');
  assert.equal(accepted.career.publications[0]?.status, 'accepted');
});

test('labelled Chinese resume preserves multiple schools, internships, projects and publication statuses as pending inputs', () => {
  const result = parse([
    '教育背景', '学校：虚构南山大学', '学历：本科', '专业：计算机科学', '开始时间：2020', '毕业时间：2024年6月',
    '学校：虚构东海学院', '学历：硕士', '专业：人工智能', '时间：2024.09 - 2027.06',
    '实习经历', '公司：虚构星云公司', '岗位：算法实习生', '时间：2023年6月 - 2023年9月', '职责：研究检索算法。',
    '公司：虚构山海研究院', '职位：研发实习生', '时间：2025 - 至今', '技术栈：Python、SQL',
    '项目经历', '项目名称：虚构检索助手', '角色：独立开发', '时间：2023 - 2024', '项目描述：实现离线检索。',
    '项目名称：虚构分析系统', '角色：成员', '时间：2025年1月 至今', '链接：https://example.invalid/project',
    '论文成果', '论文标题：Fictional Search Study', '作者：Example A; Example B', '会议：Fictional Symposium', '状态：已录用',
    '论文标题：Fictional Analysis Study', '发表日期：2025年6月2日', '状态：预印本', 'DOI：10.0000/fictional',
  ].join('\n'));
  assert.deepEqual([result.career.educations.length, result.career.internships.length, result.career.projects.length, result.career.publications.length], [2, 2, 2, 2]);
  assert.equal(result.career.educations[0]?.startDate, '2020');
  assert.equal(result.career.educations[0]?.endDate, '2024-06');
  assert.equal(result.career.educations[1]?.startDate, '2024-09');
  assert.equal(result.career.internships[1]?.current, true);
  assert.equal(result.career.internships[1]?.endDate, '');
  assert.deepEqual(result.career.internships[1]?.technologies, ['Python', 'SQL']);
  assert.equal(result.career.projects[1]?.ongoing, true);
  assert.deepEqual(result.career.publications.map(value => value.status), ['accepted', 'preprint']);
  assert.equal(result.career.publications[1]?.publicationDate, '2025-06-02');
  const date = result.career.educations[0]?.evidence.find(value => value.field === 'endDate');
  assert.equal(date?.originalValue, '2024年6月');
  assert.match(date?.quote ?? '', /2024年6月/);
  checkEvidence(result);
});

test('English section headings and common date range headers create distinct records without guessing a major', () => {
  const result = parse([
    '# Education', 'Fictional University | Bachelor | 2020 - 2024', 'Major: Computer Science',
    'Fictional College | Master | 2024.09 - 2027.06',
    'Internships', 'Fictional Company | Research Intern | 2023.06 - 2023.09', 'Responsibilities: Built a fixture.',
    'Fictional Labs | Engineering Intern | 2025 - present',
    'Projects', '1. Fictional Search | 2024 - 2025', 'Role: Developer',
    '2. Fictional Renderer | 2025.06 - ongoing',
    'Publications', '1. Fictional Accepted Paper | Accepted', 'Authors: Example A, Example B',
    '2. Fictional Published Paper | Published', 'Publication Date: 2025-10',
  ].join('\n'));
  assert.deepEqual([result.career.educations.length, result.career.internships.length, result.career.projects.length, result.career.publications.length], [2, 2, 2, 2]);
  assert.equal(result.career.educations[0]?.school, 'Fictional University');
  assert.equal(result.career.educations[0]?.major, 'Computer Science');
  assert.equal(result.career.educations[1]?.major, '');
  assert.equal(result.career.internships[0]?.role, 'Research Intern');
  assert.equal(result.career.internships[1]?.current, true);
  assert.equal(result.career.projects[1]?.ongoing, true);
  assert.deepEqual(result.career.publications.map(value => value.status), ['accepted', 'published']);
  checkEvidence(result);
});

test('companies and universities mentioned in descriptions do not become additional records', () => {
  const result = parse('教育经历\n学校：虚构大学\n学历：本科\n参与与另一大学合作的项目。\n实习经历\n公司：虚构公司\n职位：研发实习生\n负责与另一公司合作，团队来自第三大学。\n\n参与另一公司的实习生测评。\n项目经历\n项目名称：虚构检索助手\n学校：此处是项目的数据标签\n\n团队来自另一大学并与另一公司合作。\n专业技能\nPython');
  assert.equal(result.career.educations.length, 1);
  assert.equal(result.career.internships.length, 1);
  assert.equal(result.career.projects.length, 1);
  assert.match(result.career.projects[0]?.description ?? '', /另一大学/);
});

test('common publication section variants close the project section while research projects remain projects', () => {
  for (const heading of ['论文发表', '论文与研究成果', '科研成果']) {
    const result = parse(`科研项目\n项目名称：虚构实验系统\n${heading}\n论文标题：虚构论文\n状态：已录用\n研究项目\n项目名称：虚构研究系统`);
    assert.equal(result.career.projects.length, 2, heading);
    assert.equal(result.career.publications.length, 1, heading);
    assert.equal(result.career.publications[0]?.title, '虚构论文');
    assert.equal(result.career.publications[0]?.status, 'accepted');
    checkEvidence(result);
  }
});

test('unknown explicit sections do not inherit the preceding career collection', () => {
  for (const heading of ['## 未知材料', '社团活动', '志愿服务', '补充材料：', '# Additional Material']) {
    const result = parse(`项目经历\n项目名称：虚构项目\n${heading}\n1. 该条属于其他材料\n教育背景\n学校：虚构大学`);
    assert.equal(result.career.projects.length, 1, heading);
    assert.equal(result.career.educations.length, 1, heading);
    assert.doesNotMatch(result.career.projects[0]?.description ?? '', /其他材料/);
    checkEvidence(result);
  }
  const labelled = parse('项目经历\n项目名称：虚构项目\n角色：研发\n描述：这是普通字段值。');
  assert.equal(labelled.career.projects[0]?.role, '研发');
  assert.equal(labelled.career.projects[0]?.description, '这是普通字段值。');
});

test('unsupported and invalid date wording remains unknown; year precision is never expanded', () => {
  for (const [raw, expected] of [['2024', '2024'], ['2024年', '2024'], ['2024/6', '2024-06'], ['2024年2月29日', '2024-02-29']] as const) assert.equal(normalizeCareerDate(raw), expected);
  for (const raw of ['2023年2月29日', '2024-13', 'May 2024', '约2024', '2024下半年']) assert.equal(normalizeCareerDate(raw), undefined);
  const result = parse('教育背景\n学校：虚构大学\n开始时间：2020\n毕业时间：预计2027年夏天');
  assert.equal(result.career.educations[0]?.startDate, '2020');
  assert.equal(result.career.educations[0]?.endDate, '');
  assert.ok(result.warnings.some(value => /未能明确识别/.test(value)));
  checkEvidence(result);
});

test('a date range on its own line belongs to the surrounding explicit record without adding a second record', () => {
  const result = parse('实习经历\n2023.06 - 2023.09\n公司：虚构公司\n角色：研发实习生\n公司：虚构研究院\n2024 至今\n项目经历\n项目名称：虚构项目\n2025年1月 - 2025年2月');
  assert.equal(result.career.internships.length, 2);
  assert.equal(result.career.internships[0]?.startDate, '2023-06');
  assert.equal(result.career.internships[0]?.endDate, '2023-09');
  assert.equal(result.career.internships[1]?.startDate, '2024');
  assert.equal(result.career.internships[1]?.current, true);
  assert.equal(result.career.projects[0]?.endDate, '2025-02');
  checkEvidence(result);
});

test('publication status requires explicit words, retains conflicting status and never assumes publication from a venue or year', () => {
  const result = parse('论文\n论文标题：Unknown Fixture\n会议：Fictional Conference 2025\n描述：研究 published 与 accepted 标签的分类。\n论文标题：Conflicting Fixture\n状态：已录用\n状态：已发表\n论文标题：Not Published Fixture\n状态：尚未发表\n论文标题：Submitted Fixture\n状态：已投稿');
  assert.deepEqual(result.career.publications.map(value => value.status), ['in-progress', 'in-progress', 'in-progress', 'submitted']);
  assert.ok(result.warnings.some(value => /不表示已经发表/.test(value)));
  assert.ok(result.warnings.some(value => /不同状态/.test(value)));
});

test('ambiguous record fragments are preserved for review without invented names, degree or project metrics', () => {
  const result = parse('项目经历\n负责优化系统性能，尚无明确项目名称。\n描述：原文没有数字指标。\n论文\n描述：准备整理研究结果。');
  assert.equal(result.career.projects[0]?.name, '');
  assert.match(result.career.projects[0]?.description ?? '', /原文没有数字指标/);
  assert.equal(result.career.publications[0]?.title, '');
  assert.equal(result.career.publications[0]?.status, 'in-progress');
  assert.ok(result.warnings.some(value => /缺少明确名称/.test(value)));
  checkEvidence(result);
});

test('invalid chronology, contradictory ongoing state and invalid links remain reviewable instead of blocking save', () => {
  const result = parse('实习经历\n公司：虚构公司\n开始时间：2025\n结束时间：2024\n项目经历\n项目名称：虚构项目\n时间：2024 - 至今\n结束时间：2025\n链接：javascript:fixture\n论文\n论文标题：虚构论文\n日期：待确认');
  assert.equal(result.career.internships[0]?.endDate, '');
  assert.equal(result.career.projects[0]?.endDate, '');
  assert.equal(result.career.projects[0]?.ongoing, false);
  assert.equal(result.career.projects[0]?.url, '');
  checkEvidence(result);
});

test('flat explicit school labels produce pending education candidates without joining several schools together', () => {
  const result = parse('姓名：虚构同学\n学校：虚构大学\n学历：本科\n专业：计算机\n毕业时间：2024\n学校：虚构学院\n学历：硕士');
  assert.deepEqual(result.career.educations.map(value => [value.school, value.degree]), [['虚构大学', '本科'], ['虚构学院', '硕士']]);
  assert.equal(result.career.educations[0]?.endDate, '2024');
  checkEvidence(result);
  assert.equal(parse('姓名：虚构同学\n曾与虚构大学合作。\nPython').career.educations.length, 0);
});

test('original file hash and deterministic source/record IDs survive repeated imports and do not modify the TXT source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-career-txt-'));
  try {
    const text = '教育背景\n学校：虚构大学\n学历：本科\n实习经历\n公司：虚构公司\n角色：研发实习生\n专业技能\n熟悉 Python；尚未学习 PyTorch。';
    const path = join(directory, 'fictional.txt'); await writeFile(path, text);
    const a = await readResume(path), b = await readResume(path);
    assert.deepEqual(a.career, b.career);
    assert.equal(a.career?.sources[0]?.fileHash, createHash('sha256').update(Buffer.from(text)).digest('hex'));
    assert.equal(a.career?.sources[0]?.fileName, 'fictional.txt');
    assert.equal(a.career?.sources[0]?.text, a.text);
    assert.deepEqual(a.suggested?.skills, ['Python']);
    assert.ok(a.evidence?.some(value => value.field === 'school'));
    assert.equal(await readFile(path, 'utf8'), text);
    const changed = parseCareerCandidates({ text: `${text}\nDifferent extraction`, fileHash: a.career!.sources[0]!.fileHash!, fileName: 'fictional.txt' });
    assert.notEqual(changed.career.sources[0]?.id, a.career?.sources[0]?.id, 'extraction snapshot changes must not reuse an immutable source ID');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('DOCX blocks retain part/table locations, exclude tracked deletion, and preserve original file bytes', async () => {
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
  const xml = `<w:document><w:body>${paragraph('教育背景')}<w:tbl><w:tr>${cell('学校')}${cell('虚构大学')}${cell('学历')}${cell('本科')}</w:tr></w:tbl>${paragraph('实习经历')}${paragraph('公司：虚构公司')}${paragraph('职位：研发实习生')}<w:del>${paragraph('公司：删除公司')}</w:del>${paragraph('项目经历')}${paragraph('项目名称：虚构项目')}${paragraph('论文')}${paragraph('论文标题：虚构论文')}${paragraph('状态：已录用')}</w:body></w:document>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(xml) });
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-career-docx-'));
  try {
    const path = join(directory, 'fictional.docx'); await writeFile(path, bytes);
    const result = await readResume(path);
    assert.equal(result.career?.educations[0]?.school, '虚构大学');
    assert.ok(result.career?.educations[0]?.evidence.some(value => /表格 1 第 1 行/.test(value.location)));
    assert.equal(result.career?.internships.length, 1);
    assert.doesNotMatch(result.career?.sources[0]?.text ?? '', /删除公司/);
    assert.equal(result.career?.publications[0]?.status, 'accepted');
    assert.deepEqual(await readFile(path), Buffer.from(bytes));
    checkEvidence({ career: result.career!, warnings: result.warnings! });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('DOCX career parsing stays within the 80000 character preview while existing conflict evidence remains intact', async () => {
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const xml = `<w:document><w:body>${paragraph('教育背景')}${paragraph('学校：虚构大学')}${paragraph('学历：本科')}${paragraph('first@example.invalid')}${paragraph('x'.repeat(81_000))}${paragraph('项目经历')}${paragraph('项目名称：预览外项目')}${paragraph('second@example.invalid')}</w:body></w:document>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(xml) });
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-career-limit-'));
  try {
    const path = join(directory, 'fictional.docx'); await writeFile(path, bytes);
    const result = await readResume(path);
    assert.equal(result.text?.length, 80_000);
    assert.equal(result.career?.sources[0]?.text.length, 80_000);
    assert.equal(result.career?.projects.length, 0);
    assert.equal(result.suggested?.email, undefined);
    assert.ok(result.evidence?.some(value => value.value === 'second@example.invalid'));
    assert.ok(result.warnings?.some(value => /超过 80000/.test(value)));
    checkEvidence({ career: result.career!, warnings: result.warnings! });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('DOCX table-like tab-separated career labels preserve actual source evidence', () => {
  const text = '实习经历\n公司\t虚构公司\t职位\t研发实习生\t时间\t2024 - 2025\n项目经历\n项目名称\t虚构项目\t角色\t开发者';
  const result = parse(text);
  assert.equal(result.career.internships[0]?.organization, '虚构公司');
  assert.equal(result.career.internships[0]?.role, '研发实习生');
  assert.equal(result.career.internships[0]?.startDate, '2024');
  assert.equal(result.career.projects[0]?.name, '虚构项目');
  checkEvidence(result);
});

test('explicit Chinese internship position aliases stay with their own companies and remain unconfirmed candidates', () => {
  const aliases = ['实习职位', '实习职位名称', '职位名称', '职务'];
  const lines = ['实习经历'];
  for (const [index, alias] of aliases.entries()) lines.push(`公司：虚构公司${index}`, `${alias} ： 算法实习职位${index}`, '开始时间：2025', '结束时间：2025年6月');
  const result = parse(lines.join('\n'));
  assert.equal(result.career.internships.length, aliases.length);
  for (const [index, record] of result.career.internships.entries()) {
    assert.equal(record.organization, `虚构公司${index}`); assert.equal(record.role, `算法实习职位${index}`);
    assert.equal(record.startDate, '2025'); assert.equal(record.endDate, '2025-06');
    assert.ok(record.evidence.some(item => item.field === 'role' && item.quote.includes(aliases[index]!) && item.originalValue === record.role));
  }
  checkEvidence(result);
});

test('two project roles and repository or portfolio links do not cross record boundaries, including spaced labels', () => {
  const result = parse([
    '项目经历', '项目名称：虚构检索助手', '项目中担任的角色：核心研发', 'GitHub   链接 ： https://example.invalid/retrieval', '时间：2024 - 2025',
    '项目名称：虚构可视化工具', '你的角色：界面开发', '作品链接：https://example.invalid/visualization', '开始时间：2025年7月',
  ].join('\n'));
  assert.deepEqual(result.career.projects.map(record => [record.name, record.role, record.url]), [
    ['虚构检索助手', '核心研发', 'https://example.invalid/retrieval'], ['虚构可视化工具', '界面开发', 'https://example.invalid/visualization'],
  ]);
  assert.equal(result.career.projects[0]!.startDate, '2024'); assert.equal(result.career.projects[0]!.endDate, '2025');
  assert.equal(result.career.projects[1]!.startDate, '2025-07');
  assert.ok(result.career.projects[0]!.evidence.some(item => item.field === 'url' && item.quote.includes('GitHub   链接')));
  assert.ok(!result.career.projects[1]!.evidence.some(item => item.quote.includes('/retrieval')));
  checkEvidence(result);
});

test('all explicit GitHub, repository and portfolio aliases are accepted only as labelled values in the project block', () => {
  for (const label of ['GitHub', 'GitHub链接', 'GitHub 地址', 'GitHub\u00a0\u00a0链接', '代码仓库', '代码仓库地址', '仓库地址', '作品链接', '作品集', '项目地址']) {
    const result = parse(`项目经历\n项目名称：虚构项目\n${label}：https://example.invalid/project`);
    assert.equal(result.career.projects[0]!.url, 'https://example.invalid/project', label);
    assert.ok(result.career.projects[0]!.evidence.some(item => item.field === 'url' && item.originalValue === 'https://example.invalid/project'));
    checkEvidence(result);
  }
});

test('personal links outside project sections are retained in sources without being distributed to projects', () => {
  const result = parse([
    '个人信息', 'GitHub：https://example.invalid/personal', '作品集：https://example.invalid/portfolio',
    '项目经历', '项目名称：虚构项目甲', '你的角色：开发者', '项目名称：虚构项目乙', '你的角色：协作者',
    '联系方式', 'GitHub 地址：https://example.invalid/another-personal',
  ].join('\n'));
  assert.equal(result.career.projects.length, 2); assert.deepEqual(result.career.projects.map(record => record.url), ['', '']);
  assert.ok(result.career.sources[0]!.text.includes('/personal')); assert.ok(result.career.sources[0]!.text.includes('/another-personal'));
  assert.ok(result.career.projects.every(record => record.evidence.every(item => item.field !== 'url')));
  checkEvidence(result);
});

test('contradictory role and URL aliases remain blank with all evidence, including multiple cells on one row', () => {
  for (const separator of ['\n', '\t']) {
    const result = parse(`项目经历\n项目名称：虚构项目\n你的角色：开发者${separator}项目中担任的角色：维护者\nGitHub：https://example.invalid/repo${separator}作品集：https://example.invalid/demo`);
    assert.equal(result.career.projects[0]!.role, ''); assert.equal(result.career.projects[0]!.url, '');
    assert.equal(result.career.projects[0]!.evidence.filter(item => item.field === 'role').length, 2);
    assert.equal(result.career.projects[0]!.evidence.filter(item => item.field === 'url').length, 2);
    assert.ok(result.warnings.some(item => item.includes('role') && item.includes('冲突')));
    assert.ok(result.warnings.some(item => item.includes('url') && item.includes('冲突')));
    checkEvidence(result);
  }
  const same = parse('项目经历\n项目名称：虚构项目\n你的角色：开发者\n项目中担任的角色：开发者\nGitHub：https://example.invalid/repo\n仓库地址：https://example.invalid/repo');
  assert.equal(same.career.projects[0]!.role, '开发者'); assert.equal(same.career.projects[0]!.url, 'https://example.invalid/repo');
  assert.ok(!same.warnings.some(item => item.includes('冲突'))); checkEvidence(same);
});

test('free-form role descriptions and bare URLs are not guessed, while invalid labelled links remain reviewable', () => {
  const free = parse('项目经历\n项目名称：虚构项目\n负责主要研发，并协助其他成员维护代码。\nhttps://example.invalid/unlabelled');
  assert.equal(free.career.projects[0]!.role, ''); assert.equal(free.career.projects[0]!.url, '');
  assert.match(free.career.projects[0]!.description, /负责主要研发/); checkEvidence(free);
  for (const url of ['javascript:alert(1)', 'https://username:password@example.invalid/repository', '未知，稍后补充']) {
    const result = parse(`项目经历\n项目名称：虚构项目\n代码仓库：${url}`);
    assert.equal(result.career.projects[0]!.url, '');
    assert.ok(result.warnings.some(item => item.includes('链接')));
    assert.ok(result.career.projects[0]!.evidence.some(item => item.field === 'url' && item.originalValue === url));
    checkEvidence(result);
  }
});

test('tab-separated explicit internship and project aliases retain DOCX-style cell ownership', () => {
  const result = parse('实习经历\n公司\t虚构研究所\t职务\t研究实习生\n项目经历\n项目名称\t虚构工具\t你的角色\t开发者\tGitHub   地址\thttps://example.invalid/tool');
  assert.equal(result.career.internships[0]!.role, '研究实习生');
  assert.equal(result.career.projects[0]!.role, '开发者'); assert.equal(result.career.projects[0]!.url, 'https://example.invalid/tool');
  checkEvidence(result);
});
