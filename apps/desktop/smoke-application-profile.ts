import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { dialog, type BrowserWindow } from 'electron';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent, AppState, BrowserState, Profile, ProfileInput } from '../../packages/shared/src/contracts.js';
import type { CareerFillPreview } from '../../packages/shared/src/career-form.js';
import { createCareerFormFixtureProfile } from './fixtures/career-form-profile.js';
import { pickCareerInput } from '../../packages/profile/src/career-input.js';
import { parseApplicationFacts } from '../../packages/profile/src/application-facts.js';
import { prepareOneClickCareer } from '../../packages/ui/src/one-click-career.js';
import { buildCareerPlan, type CareerFormObservation } from '../../packages/forms/src/career-plan.js';
import { SmokeStepRunner } from './smoke-deadline.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const values = (profile: Profile): ProfileInput => { const { version: _version, updatedAt: _updated, career, ...base } = profile; return { ...base, career: pickCareerInput(career) }; };
/** Actual isolated file/IPC/profile save and confirmation; planner proof is a synthetic observation, never webpage input. */
export async function smokeApplicationProfile(window: BrowserWindow, methods: Methods, send: (event: AppEvent) => void,
  stateDirectory: string, store: DomainStore) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-profile-only')
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic') || window.isVisible()) throw new Error('资料导入检查仅允许隐藏的专用隔离smoke。');
  const runner = new SmokeStepRunner('application-profile-hidden-real-ipc');
  const assertions: Array<{ name: string; passed: true }> = [], screenshots: string[] = [], forbiddenCommands: string[] = [];
  const selectors: string[] = []; const replaced = new Map<string, Methods[string]>();
  const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalBounds = methods.browserBounds!, originalBrowser = methods.browserState!;
  const expect = (condition: unknown, name: string) => { if (!condition) throw new Error(name); assertions.push({ name, passed: true }); };
  const ui = <T = unknown>(name: string, expression: string) => runner.run(name, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const waitFor = async (name: string, expression: string) => { const until = performance.now() + 7000; while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); } throw new Error(name); };
  const waitHost = async (name: string, predicate: () => Promise<boolean>) => { const until = performance.now() + 7000; while (performance.now() < until) { if (await predicate()) return; await delay(25); } throw new Error(name); };
  const invoke = <T = unknown>(name: string, args: unknown[] = []) => ui<T>('actual-profile-ipc', `window.offer[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
  const click = (selector: string) => ui('owned-profile-button', `(() => {const button=document.querySelector(${JSON.stringify(selector)});if(!(button instanceof HTMLButtonElement)||button.disabled||!button.checkVisibility())throw new Error('资料界面按钮不可用');button.click();})()`);
  const screenshot = async (name: string) => { const image = await runner.run('hidden-owned-profile-capture', () => window.webContents.capturePage()); const path = join(stateDirectory, name); await writeFile(path, image.toPNG(), { mode: 0o600 }); screenshots.push(path); };
  const replace = (name: string, value: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = value; };
  try {
    runner.setStage('install-hidden-private-store-and-provider-guards');
    expect((await store.getState()).profile.version === 0, 'profileImportBeginsInNewEmptyIsolatedStore');
    await originalBounds({ x: 0, y: 0, width: 800, height: 600 }, false); replace('browserBounds', async () => undefined);
    for (const name of ['browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'openTestForm', 'fillApproved', 'runCareerFill', 'prepareCareerFill', 'prepareFill', 'configureModel',
      'runAgent', 'cancelAgent', 'discoverJobs', 'refreshSource', 'collectPageJobs', 'capturePage', 'importResume', 'importApplyDock', 'exportData', 'exportTelemetry']) {
      if (methods[name]) replace(name, async () => { forbiddenCommands.push(name); throw new Error('隐藏资料协议检查禁止联网、模型、网页填写和无关资料操作。'); });
    }
    const fictional = createCareerFormFixtureProfile(); fictional.career!.internships[0]!.role = ''; fictional.career!.internships[0]!.current = true; fictional.career!.internships[0]!.endDate = '';
    fictional.career!.projects.forEach(record => { record.role = ''; record.url = ''; });
    const input = values(fictional); input.career!.primaryEducationId = null;
    let current = await invoke<AppState>('saveProfile', [input, 0]);
    const masterId = current.profile.career!.educations[0]!.id;
    current = await invoke<AppState>('confirmCareerRecord', ['educations', masterId, current.profile.version, current.profile.career!.educations[0]!.revision]);
    const primary = values(current.profile); primary.career!.primaryEducationId = masterId;
    current = await invoke<AppState>('saveProfile', [primary, current.profile.version]);
    const internshipId = current.profile.career!.internships[0]!.id, projectIds = current.profile.career!.projects.map(record => record.id);
    const touched = [{ collection: 'internships' as const, id: internshipId }, ...projectIds.map(id => ({ collection: 'projects' as const, id }))];
    for (const record of touched) { const source = current.profile.career![record.collection].find(item => item.id === record.id)!; current = await invoke<AppState>('confirmCareerRecord', [record.collection, record.id, current.profile.version, source.revision]); }
    const originalProfile = structuredClone(current.profile), before = JSON.stringify(current.profile);
    const roles = ['虚构算法研发实习生', '虚构检索项目主要开发者', '虚构流程工具开发者'];
    const links = ['https://github.com/offeragent-fixtures/fictional-project-alpha', 'https://github.com/offeragent-fixtures/fictional-project-beta'];
    const document = { schemaVersion: 1, educations: [], internships: [{ recordId: internshipId, organization: '虚构冲突单位名称（不可默认覆盖）', role: roles[0], current: true }], projects: projectIds.map((recordId, index) => ({ recordId, role: roles[index + 1], url: links[index] })) };
    const firstPath = join(stateDirectory, 'fictional-application-facts.json'), conflictPath = join(stateDirectory, 'fictional-application-conflict.json'), templatePath = join(stateDirectory, 'blank-application-facts-template.json');
    const firstBytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
    const conflictBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, educations: [], internships: [{ recordId: internshipId, role: '虚构冲突角色（不可默认覆盖）' }], projects: [{ recordId: projectIds[0], url: 'https://github.com/offeragent-fixtures/fictional-conflicting-project' }] }, null, 2) + '\n');
    await writeFile(firstPath, firstBytes, { mode: 0o600 }); await writeFile(conflictPath, conflictBytes, { mode: 0o600 });
    const originalHash = hash(firstBytes), conflictHash = hash(conflictBytes); const openQueue = [firstPath, conflictPath];
    dialog.showOpenDialog = (async () => { const next = openQueue.shift(); if (!next) throw new Error('额外文件选择未授权给本轮fixture'); selectors.push('open-application-facts-only'); return { canceled: false, filePaths: [next] }; }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async () => { selectors.push('save-blank-template-only'); return { canceled: false, filePath: templatePath }; }) as typeof dialog.showSaveDialog;

    runner.setStage('profile-guide-and-visible-career-fields');
    send({ type: 'navigate', page: 'profile' });
    await waitFor('profile-guide-visible', 'document.querySelector(\'[data-testid="application-profile-guide"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('profile-guide-import-entry', 'document.querySelector(\'[data-testid="application-facts-import"]\')?.checkVisibility()===true&&document.querySelector(\'[data-testid="application-facts-template"]\')?.checkVisibility()===true'), 'profileShowsDirectSupplementImportAndTemplateEntry');
    expect(await ui<boolean>('role-fields-direct-visible', `(() => {
      const records=${JSON.stringify(touched.map(item => item.id))};
      return records.every(id=>{const row=document.querySelector('[data-career-record-id="'+id+'"]');return [...(row?.querySelectorAll('.field')??[])].some(field=>/角色|职位/u.test(field.querySelector('.field-label')?.textContent??'')&&field.querySelector('input')?.checkVisibility());});
    })()`), 'threeRoleFieldsAreVisibleWithoutExpandingTwoLayers');
    expect(await ui<boolean>('project-links-direct-visible', `(() => {return ${JSON.stringify(projectIds)}.every(id=>{const row=document.querySelector('[data-career-record-id="'+id+'"]');return [...(row?.querySelectorAll('.field')??[])].some(field=>field.querySelector('.field-label')?.textContent.includes('GitHub')&&field.querySelector('input')?.checkVisibility());});})()`), 'bothProjectSpecificGithubInputsAreImmediatelyVisible');

    runner.setStage('actual-file-import-preview-before-any-store-write');
    await click('[data-testid="application-facts-import"]');
    await waitFor('facts-preview-visible', 'document.querySelector(\'[data-testid="application-facts-preview"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('preview-default-empty-selection', `(() => {const rows=[...document.querySelectorAll('[data-testid="application-facts-preview"] tr[data-fact-status]')];const empty=rows.filter(row=>row.getAttribute('data-fact-status')==='empty'),conflict=rows.filter(row=>row.getAttribute('data-fact-status')==='conflict');return empty.length===5&&empty.every(row=>row.querySelector('input')?.checked===true)&&conflict.length===1&&conflict.every(row=>row.querySelector('input')?.checked===false);})()`), 'previewDefaultsOnlyFiveEmptyFactsAndNeverSelectsNonemptyConflict');
    expect(JSON.stringify((await store.getState()).profile) === before, 'readingJsonAndPreviewingDifferencesDoesNotChangeStoredProfile');
    await click('[data-testid="application-facts-apply"]');
    await waitFor('profile-draft-ready-to-save', '!document.querySelector(\'[data-testid="application-facts-preview"]\')&&document.querySelector(\'[data-testid="profile-save"]\')?.disabled===false');
    expect(JSON.stringify((await store.getState()).profile) === before, 'applyingSelectionChangesOnlyEditableDraftUntilExplicitSave');
    expect(await ui<boolean>('draft-shows-all-imported-values', `(() => {const rows=[...document.querySelectorAll('.career-card input')];return ${JSON.stringify([...roles, ...links])}.every(value=>rows.some(input=>input.value===value));})()`), 'allThreeRolesAndDistinctProjectLinksReachTheEditableDraft');
    await click('[data-testid="profile-save"]');
    await waitHost('actual-profile-save-finished', async () => (await store.getState()).profile.version > originalProfile.version);
    current = await store.getState();
    const internship = current.profile.career!.internships.find(record => record.id === internshipId)!;
    expect(internship.role === roles[0] && current.profile.career!.projects.every((record, index) => record.role === roles[index + 1] && record.url === links[index]), 'realUiSavePersistsExactlyThreeRolesAndTwoDistinctUrls');
    expect(touched.every(item => { const record = current.profile.career![item.collection].find(record => record.id === item.id)!; return record.confirmation === 'pending' && record.confirmedRevision === null; }), 'allThreeChangedRecordsBecomePendingInsteadOfImportingConfirmation');
    const source = current.profile.career!.sources.find(value => value.fileHash === originalHash)!;
    expect(!!source && source.kind === 'manual' && source.text === firstBytes.toString('utf8') && source.fileName === 'fictional-application-facts.json', 'savedProvenanceRetainsIndependentOriginalFileHashAndExactText');
    expect(touched.every(item => { const record = current.profile.career![item.collection].find(record => record.id === item.id)!; return record.evidence.some(evidence => evidence.sourceId === source.id && evidence.field === 'role'); }) && current.profile.career!.projects.every(record => record.evidence.some(evidence => evidence.sourceId === source.id && evidence.field === 'url')), 'eachImportedRoleAndUrlKeepsItsOwnFieldLevelSourceEvidence');
    expect(current.profile.career!.primaryEducationId === masterId && JSON.stringify(current.profile.career!.educations) === JSON.stringify(originalProfile.career!.educations)
      && current.profile.fullName === originalProfile.fullName && current.profile.email === originalProfile.email && current.profile.phone === originalProfile.phone && current.profile.school === originalProfile.school && current.profile.degree === originalProfile.degree, 'ordinaryContactFactsAndChosenDefaultEducationRemainUnchanged');
    expect(internship.current === true && internship.endDate === '' && internship.organization === originalProfile.career!.internships[0]!.organization, 'ongoingFlagAndEmptyEndDateRemainAndUnselectedOrganizationConflictIsPreserved');

    runner.setStage('explicit-career-confirmation-and-production-pure-planner-proof');
    const syntheticObservation = (profile: Profile): CareerFormObservation => ({ id: 'fictional-readonly-profile-observation', url: 'https://example.invalid/fictional-profile-planner', generation: 1, signature: 'fictional-observation-structure', addControls: [], groups: [
      { id: 'fictional-education-group', collection: 'educations', signature: 'fictional-education-signature', fields: [{ id: 'fictional-school', key: 'school', type: 'text', value: '', editable: true, signature: 'fictional-school-signature' }] },
      ...touched.map(item => ({ id: `fictional-group-${item.id}`, collection: item.collection, signature: `fictional-signature-${item.id}`, fields: [
        { id: `fictional-role-${item.id}`, key: 'role' as const, type: 'text', value: '', editable: true, signature: `fictional-role-signature-${item.id}` },
        ...(item.collection === 'projects' ? [{ id: `fictional-url-${item.id}`, key: 'url' as const, type: 'text', value: '', editable: true, signature: `fictional-url-signature-${item.id}` }] : []),
      ] })),
    ] });
    const publicObservation = (profile: Profile, observed: CareerFormObservation): CareerFillPreview => ({ planId: 'fictional-public-observation-only', url: observed.url, profileVersion: profile.version,
      groups: observed.groups.map(group => ({ id: group.id, collection: group.collection, signature: group.signature, fields: group.fields.map(field => ({ id: field.id, key: field.key, type: field.type, value: field.value, editable: field.editable })) })), bindings: [], selectedRecordIds: {}, preserveGroupIds: [], issues: [], steps: [] });
    const pendingPreparation = prepareOneClickCareer(current.profile, publicObservation(current.profile, syntheticObservation(current.profile)));
    expect(touched.every(item => !pendingPreparation.selection[item.collection].includes(item.id)), 'oneClickSelectionExcludesAllUnconfirmedImportedRevisions');
    for (const item of touched) {
      const selector = `[data-career-record-id="${item.id}"]`;
      await waitFor('career-row-can-confirm', `(() => {const row=document.querySelector(${JSON.stringify(selector)});return [...(row?.querySelectorAll('button')??[])].some(button=>button.textContent==='确认本条'&&!button.disabled&&button.checkVisibility());})()`);
      await ui('confirm-actual-career-row', `(() => {const row=document.querySelector(${JSON.stringify(selector)});const button=[...(row?.querySelectorAll('button')??[])].find(button=>button.textContent==='确认本条');if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('当前经历修订不可确认');button.click();})()`);
      await waitHost('actual-current-revision-confirmed', async () => { const record = (await store.getState()).profile.career![item.collection].find(record => record.id === item.id)!; return record.confirmation === 'confirmed' && record.confirmedRevision === record.revision; });
    }
    current = await store.getState();
    expect(touched.every(item => current.profile.career![item.collection].find(record => record.id === item.id)!.confirmation === 'confirmed'), 'threeRecordsConfirmedThroughRealUiAndVersionedHostApi');
    const observed = syntheticObservation(current.profile), preparation = prepareOneClickCareer(current.profile, publicObservation(current.profile, observed));
    expect(preparation.status === 'ready' && touched.every(item => preparation.selection[item.collection].includes(item.id)), 'productionOneClickHelperSelectsNewlyConfirmedFacts');
    if (preparation.status !== 'ready') throw new Error('虚构观察计划未准备好');
    const plan = buildCareerPlan(current.profile, observed, preparation.options);
    const ready = plan.steps.flatMap(step => step.kind === 'fill-group' ? step.items.filter(item => item.status === 'ready').map(item => ({ ...item, recordId: step.binding.recordId })) : []);
    expect(touched.every((item, index) => ready.some(field => field.recordId === item.id && field.key === 'role' && field.value === roles[index]))
      && projectIds.every((id, index) => ready.some(field => field.recordId === id && field.key === 'url' && field.value === links[index])), 'actualProductionPlannerReadsAllFiveConfirmedImportedValuesWithoutModelOrBrowserInput');
    await screenshot('profile-confirmed-import-fixture.png');

    runner.setStage('nonempty-conflict-preview-and-empty-template-export');
    const confirmedBeforeConflict = JSON.stringify(current.profile);
    await waitFor('facts-import-enabled-after-confirmations', 'document.querySelector(\'[data-testid="application-facts-import"]\')?.disabled===false');
    await click('[data-testid="application-facts-import"]');
    await waitFor('second-conflict-preview', 'document.querySelector(\'[data-testid="application-facts-preview"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('nonempty-conflict-never-default-selected', 'document.querySelectorAll(\'[data-testid="application-facts-preview"] tr[data-fact-status="conflict"]\').length===2&&[...document.querySelectorAll(\'[data-testid="application-facts-preview"] input[type="checkbox"]\')].every(input=>!input.checked)&&document.querySelector(\'[data-testid="application-facts-apply"]\')?.disabled===true'), 'reimportedNonemptyConflictsStayUnselectedAndCannotAutoApply');
    expect(JSON.stringify((await store.getState()).profile) === confirmedBeforeConflict, 'secondImportDoesNotOverwriteConfirmedNonemptyFacts');
    await ui('cancel-owned-import-preview', `(() => {const panel=document.querySelector('[data-testid="application-facts-preview"]');const button=[...(panel?.querySelectorAll('button')??[])].find(button=>button.textContent==='取消导入');if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('取消导入按钮不可用');button.click();})()`);
    await click('[data-testid="application-facts-template"]'); await waitHost('blank-template-exported', async () => { try { return (await readFile(templatePath)).length > 0; } catch { return false; } });
    const templateBytes = await readFile(templatePath), template = parseApplicationFacts(templateBytes);
    const strings: string[] = []; const visit = (value: unknown) => { if (typeof value === 'string') strings.push(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') Object.values(value).forEach(visit); }; visit(template);
    expect(template.schemaVersion === 1 && strings.every(value => value === '') && ![...roles, ...links, ...touched.map(item => item.id), current.profile.fullName].some(value => templateBytes.toString('utf8').includes(value)), 'exportedBlankTemplateParsesAndContainsNoCurrentFactsOrRecordIds');
    expect(hash(await readFile(firstPath)) === originalHash && hash(await readFile(conflictPath)) === conflictHash, 'bothOriginalFictionalImportFilesRemainByteIdentical');
    expect(await ui<boolean>('recruitment-preference-visible', `Array.from(document.querySelectorAll('select')).some(n=>Array.from(n.options).some(o=>o.textContent==='只找正式校招')&&n.checkVisibility())`),'explicitRecruitmentPreferenceIsAvailableInExistingProfileForm');
    await ui('choose-campus-only-in-owned-renderer', `(()=>{const n=Array.from(document.querySelectorAll('select')).find(n=>Array.from(n.options).some(o=>o.textContent==='只找正式校招'));if(!n||n.disabled)throw new Error('招聘偏好不可用');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'campus');n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor('preference-save-ready', `document.querySelector('[data-testid="profile-save"]')?.disabled===false`);
    await click('[data-testid="profile-save"]');
    await waitHost('preference-saved-through-real-ipc',async()=>JSON.stringify((await store.getState()).profile.acceptedRecruitmentTypes)==='["campus"]');
    expect(true,'rendererChoicePersistsRecruitmentPreferenceThroughRealProfileSaveIPC');
    expect(selectors.length === 3 && openQueue.length === 0, 'onlyTwoOpenSelectorsAndOneTemplateSaveSelectorAreReplaced');
    expect(forbiddenCommands.length === 0 && !window.isVisible() && (await originalBrowser() as BrowserState).visible === false, 'allWorkStayedHiddenWithoutNetworkProviderOrNativeBrowserInput');
    const report = { ok: true, assertionCount: assertions.length, assertions, screenshots, forbiddenCommands, selectors,
      realIsolatedSQLite: true, actualIpcImportDraftSaveAndConfirmation: true, systemSelectorsOnlyReplaced: true,
      inputFixtureHashes: { first: originalHash, conflict: conflictHash }, originalsPreserved: true,
      sourceHashAndFieldEvidenceIndependentlyVerified: true, productionPurePlannerChecked: true, plannerObservationIsSynthetic: true,
      nativeInputs: 0, enterpriseInputs: 0, realModelCalls: 0, realWebpageCorrectnessMeasured: false,
      actualNativeViewHidden: true, screenshotsContainOwnedRendererOnly: true, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'smoke-application-profile-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    try { await screenshot('application-profile-failure.png'); } catch { /* Preserve the first bounded failure. */ }
    await writeFile(join(stateDirectory, 'smoke-application-profile-failure.json'), JSON.stringify({ ok: false, assertionCount: assertions.length, assertions, screenshots,
      forbiddenCommands, selectors, nativeInputs: 0, realModelCalls: 0, message: error instanceof Error ? error.message : '隐藏资料导入检查未完成', harness: runner.snapshot() }, null, 2), { mode: 0o600 }); throw error;
  } finally {
    dialog.showOpenDialog = originalOpen; dialog.showSaveDialog = originalSave;
    for (const [name, method] of replaced) methods[name] = method;
  }
}
