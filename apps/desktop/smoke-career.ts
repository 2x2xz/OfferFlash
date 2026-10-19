import type { BrowserWindow } from 'electron';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent, AppState, Profile, ProfileInput } from '../../packages/shared/src/contracts.js';
import { readResume } from '../../packages/profile/src/import.js';
import { mergeCareerImport, pickCareerInput } from '../../packages/profile/src/career-input.js';
import { getProfileSummary } from '../../packages/agent/src/profile-summary.js';

const dto = (profile: Profile): ProfileInput => {
  const { version: _version, updatedAt: _updatedAt, ...input } = profile;
  return { ...input, ...(profile.career ? { career: pickCareerInput(profile.career) } : {}) };
};

/** Own renderer + privileged IPC integration, using only a bundled fictional resume. */
export async function smokeStructuredCareer(window: BrowserWindow, store: DomainStore, fixturePath: string, send: (event: AppEvent) => void) {
  const imported = await readResume(fixturePath);
  if (!imported.career) throw new Error('虚构履历没有结构化候选');
  let profile = (await store.getState()).profile;
  const input = { ...dto(profile), career: mergeCareerImport(pickCareerInput(profile.career), imported.career) };
  const save = async (payload: ProfileInput, version: number) => window.webContents.executeJavaScript(`window.offer.saveProfile(${JSON.stringify(payload)}, ${version})`) as Promise<AppState>;
  profile = (await save(input, profile.version)).profile;
  const pendingIds = [...imported.career.educations, ...imported.career.internships, ...imported.career.projects, ...imported.career.publications].map(record => record.id);
  const initial = getProfileSummary(profile);
  if (initial.careerSummary?.projects.length) throw new Error('未确认项目进入了模型概要');
  send({ type: 'navigate', page: 'profile' });
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
  // The primary path now opens the short review. The legacy editor remains an
  // explicit More Tools entry, and this regression exercises that real entry.
  await window.webContents.executeJavaScript(`(() => {
    const button=Array.from(document.querySelectorAll('.nav button')).find(item=>item.textContent.trim()==='个人资料');
    if (!button) throw new Error('更多工具没有完整资料入口');
    button.click();
  })()`);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const rendered = await window.webContents.executeJavaScript("document.querySelectorAll('.career-card').length");
  const confirmed: string[] = [];
  for (const collection of ['educations', 'internships', 'projects', 'publications'] as const) for (const record of imported.career[collection]) {
    const selector = `[data-career-record-id="${record.id}"]`;
    await window.webContents.executeJavaScript(`(() => { const card = document.querySelector(${JSON.stringify(selector)}); const button = Array.from(card?.querySelectorAll('button') || []).find(item => item.textContent.includes('确认本条')); if (!button || button.disabled) throw new Error('履历确认按钮不可用'); button.click(); })()`);
    let settled = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise(done => setTimeout(done, 30));
      profile = (await store.getState()).profile;
      if (profile.career?.[collection].find(item => item.id === record.id)?.confirmation === 'confirmed') { settled = true; break; }
    }
    if (!settled) throw new Error(`履历确认未结算：${collection}`);
    confirmed.push(record.id);
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 50))');
  }
  const master = imported.career.educations.find(record => record.degree === '硕士');
  if (!master) throw new Error('虚构硕士候选缺失');
  await window.webContents.executeJavaScript(`(() => { const select = document.querySelector('.profile-fieldset select'); if (!select) throw new Error('默认教育选择缺失'); select.value = ${JSON.stringify(master.id)}; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 60))');
  await window.webContents.executeJavaScript("(() => { const button = document.querySelector('.profile-save-actions .button-primary'); if (!button || button.disabled) throw new Error('履历保存按钮不可用'); button.click(); })()");
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(done => setTimeout(done, 30)); profile = (await store.getState()).profile;
    if (profile.career?.primaryEducationId === master.id) break;
  }
  if (profile.career?.primaryEducationId !== master.id || profile.school !== master.school || profile.graduationMonth !== '2027-06') throw new Error('默认教育没有投影到普通字段');
  const before = getProfileSummary(profile);
  const repeat = mergeCareerImport(pickCareerInput(profile.career), imported.career);
  profile = (await save({ ...dto(profile), career: repeat }, profile.version)).profile;
  if (profile.career!.projects.length !== 1 || profile.career!.educations.length !== 3 || profile.career!.projects[0]!.confirmation !== 'confirmed') throw new Error('重复导入覆盖或重复创建了既有履历');
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
  const projectSelector = `[data-career-record-id="${imported.career.projects[0]!.id}"]`;
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(projectSelector)}).querySelector('summary').click()`);
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
  await window.webContents.executeJavaScript(`(() => { const card = document.querySelector(${JSON.stringify(projectSelector)}); const label = Array.from(card.querySelectorAll('label')).find(item => item.querySelector('.field-label')?.textContent.includes('角色')); const input = label?.querySelector('input'); if (!input) throw new Error('项目角色编辑缺失'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '开发与评测'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))');
  await window.webContents.executeJavaScript("(() => { const button = document.querySelector('.profile-save-actions .button-primary'); if (!button || button.disabled) throw new Error('编辑履历后无法保存'); button.click(); })()");
  let editSeen = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(done => setTimeout(done, 30)); profile = (await store.getState()).profile;
    const project = profile.career!.projects.find(record => record.id === imported.career!.projects[0]!.id)!;
    if (project.role === '开发与评测' && project.confirmation === 'pending') { editSeen = true; break; }
  }
  if (!editSeen || getProfileSummary(profile).careerSummary!.projects.length) throw new Error('修改履历没有撤销旧确认');
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))');
  await window.webContents.executeJavaScript(`(() => { const card = document.querySelector(${JSON.stringify(projectSelector)}); const button = Array.from(card.querySelectorAll('button')).find(item => item.textContent.includes('确认本条')); if (!button || button.disabled) throw new Error('修改后确认按钮不可用'); button.click(); })()`);
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(done => setTimeout(done, 30)); profile = (await store.getState()).profile;
    if (profile.career!.projects[0]!.confirmation === 'confirmed') break;
  }
  if (profile.career!.projects[0]!.confirmation !== 'confirmed') throw new Error('修改后确认未完成');
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(projectSelector)}).scrollIntoView({block:'start'})`);
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
  return { candidateCounts: { educations: imported.career.educations.length, internships: imported.career.internships.length,
    projects: imported.career.projects.length, publications: imported.career.publications.length },
    pendingAfterImport: initial.careerSummary!.pendingCount, renderedCards: rendered, confirmedViaUI: confirmed.length,
    selectedSchool: profile.school, selectedGraduationMonth: profile.graduationMonth,
    sourcePersisted: profile.career!.sources.some(source => source.kind === 'resume' && source.fileHash === imported.career!.sources[0]!.fileHash),
    reimportPreserved: before.careerSummary!.projects.length === getProfileSummary(profile).careerSummary!.projects.length,
    editedRecordNeedsReview: editSeen, editedRecordReconfirmed: true,
    originalRoleEvidencePreserved: profile.career!.projects[0]!.evidence.some(item => item.field === 'role' && item.originalValue === '开发'),
    importedPendingIds: pendingIds, ok: true };
}
