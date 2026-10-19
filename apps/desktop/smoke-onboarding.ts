import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { dialog, type BrowserWindow } from 'electron';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent } from '../../packages/shared/src/contracts.js';
import { ONBOARDING_STORAGE_KEY } from '../../packages/ui/src/onboarding.js';
import { SmokeStepRunner } from './smoke-deadline.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;

/** Hidden first-run UI using the production parser and named IPC. No native page or model is exercised. */
export async function smokeOnboarding(window: BrowserWindow, methods: Methods, _send: (event: AppEvent) => void,
  stateDirectory: string, store: DomainStore, projectRoot: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-onboarding-only')
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic') || window.isVisible()) {
    throw new Error('首次引导验收仅允许隐藏的专用隔离 smoke。');
  }
  const runner = new SmokeStepRunner('first-run-hidden-real-parser-and-ipc');
  const assertions: Array<{ name: string; passed: true }> = [], forbiddenCommands: string[] = [], screenshots: string[] = [];
  const replaced = new Map<string, Methods[string]>(), originalChooser = dialog.showOpenDialog;
  const expect = (value: unknown, name: string) => { if (!value) throw new Error(name); assertions.push({ name, passed: true }); };
  const ui = <T = unknown>(name: string, expression: string) => runner.run(name, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const waitFor = async (name: string, expression: string) => {
    const until = performance.now() + 7000;
    while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); }
    throw new Error(name);
  };
  const click = (id: string) => ui('owned-onboarding-button', `(() => {const b=document.querySelector('[data-testid="'+${JSON.stringify(id)}+'"]');if(!(b instanceof HTMLButtonElement)||b.disabled||!b.checkVisibility())throw new Error('引导按钮不可用');b.click();})()`);
  const reload = async () => { await runner.run('reload-owned-renderer', () => new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); })); await waitFor('onboarding-reload-ready', '!!document.querySelector(".workbench")'); };
  const replace = (name: string, method: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = method; };
  const welcomeVisible = 'document.querySelector(\'[data-testid="onboarding-dialog"][data-stage="import"]\')?.checkVisibility()===true';
  let cancelledChooser = true, chooserCalls = 0;
  try {
    expect((await store.getState()).profile.version === 0, 'onboardingBeginsWithEmptyIsolatedProfile');
    for (const name of ['browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'openTestForm', 'fillApproved', 'runCareerFill',
      'prepareCareerFill', 'prepareFill', 'configureModel', 'runAgent', 'cancelAgent', 'discoverJobs', 'refreshSource', 'collectPageJobs',
      'capturePage', 'importApplyDock', 'importApplicationFacts', 'exportData', 'exportTelemetry']) {
      if (methods[name]) replace(name, async () => { forbiddenCommands.push(name); throw new Error('首次引导检查禁止联网、模型、真实网页输入和无关文件操作。'); });
    }
    if (methods.browserBounds) replace('browserBounds', async () => undefined);
    dialog.showOpenDialog = (async () => {
      chooserCalls++;
      return cancelledChooser ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [join(projectRoot, 'apps/desktop/fixtures/focused-resume.md')] };
    }) as typeof dialog.showOpenDialog;
    await ui('clear-isolated-onboarding-receipt', `localStorage.removeItem(${JSON.stringify(ONBOARDING_STORAGE_KEY)})`);
    await reload(); await waitFor('first-run-welcome-visible', welcomeVisible);
    expect(await ui<boolean>('welcome-three-stages', 'document.querySelectorAll(".onboarding-steps li").length===3'), 'welcomeShowsOnlyThreeClearStages');
    expect(await ui<boolean>('welcome-source-and-confirmation-copy', 'document.querySelector(\'[data-testid="onboarding-dialog"]\')?.textContent.includes("来源原文会保留")===true'), 'welcomeExplainsDraftAndConfirmation');
    expect(chooserCalls === 0 && (await store.getState()).profile.version === 0, 'openingGuideDoesNotReadFilesOrWriteFacts');
    const shot = await runner.run('hidden-welcome-renderer-capture', () => window.webContents.capturePage());
    const shotPath = join(stateDirectory, 'onboarding-welcome.png'); await writeFile(shotPath, shot.toPNG(), { mode: 0o600 }); screenshots.push(shotPath);
    await click('onboarding-skip');
    expect(await ui<boolean>('skip-receipt-only', `localStorage.getItem(${JSON.stringify(ONBOARDING_STORAGE_KEY)})===JSON.stringify({version:1,status:'skipped'})`), 'skipStoresOnlyNonPersonalGuideReceipt');
    await reload();
    expect(await ui<boolean>('skip-survives-reload', '!document.querySelector(\'[data-testid="onboarding-dialog"]\')'), 'skippedGuideDoesNotForceItselfOnReload');
    await click('workspace-settings'); await waitFor('settings-reopen-entry', 'document.querySelector(\'[data-testid="onboarding-reopen"]\')?.checkVisibility()===true'); await click('onboarding-reopen'); await waitFor('manual-guide-visible', welcomeVisible);
    expect(true, 'settingsCanReopenGuideAfterSkip');
    await click('onboarding-import');
    await waitFor('cancelled-import-remains-import-step', 'document.querySelector(\'[data-testid="onboarding-profile-guide"][data-stage="import"]\')?.checkVisibility()===true&&document.querySelector(\'[data-testid="onboarding-import-again"]\')?.disabled===false');
    expect(chooserCalls === 1 && (await store.getState()).profile.version === 0, 'cancelledFileSelectionDoesNotAdvanceOrSave');
    cancelledChooser = false; await click('onboarding-import-again');
    await waitFor('real-parser-draft-ready', 'document.querySelector(\'[data-testid="onboarding-profile-guide"][data-stage="review"]\')?.checkVisibility()===true&&document.querySelector(\'[data-testid="resume-confirm"]\')?.disabled===true');
    expect(chooserCalls === 2 && (await store.getState()).profile.version === 0, 'actualResumeParserPopulatesDraftWithoutSavingOrConfirming');
    expect(await ui<boolean>('education-not-guessed', 'document.querySelector(\'[data-testid="resume-education"]\')?.value===""&&document.querySelector(\'[data-testid="resume-education"]\')?.options.length===3'), 'bothImportedEducationsStayUnselectedUntilUserChooses');
    expect(await ui<boolean>('complete-editor-collapsed-during-review', 'document.querySelector(".profile-complete-editor")?.open===false'), 'firstReviewKeepsAdvancedEditorCollapsed');
    await ui('select-one-fictional-education-in-owned-ui', `(() => {const select=document.querySelector('[data-testid="resume-education"]');const option=[...select.options].find(option=>option.text.includes('硕士'));if(!option)throw new Error('虚构硕士候选缺失');select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor('explicit-confirm-ready', 'document.querySelector(\'[data-testid="resume-confirm"]\')?.disabled===false');
    await click('resume-confirm');
    await waitFor('guide-final-stage-visible', 'document.querySelector(\'[data-testid="onboarding-dialog"][data-stage="apply"]\')?.checkVisibility()===true');
    const saved = (await store.getState()).profile, primary = saved.career!.educations.find(record => record.id === saved.career!.primaryEducationId);
    expect(primary?.degree === '硕士' && primary.confirmation === 'confirmed' && primary.confirmedRevision === primary.revision, 'explicitUserConfirmationSelectsAndConfirmsOnlyChosenEducation');
    expect(saved.career!.educations.filter(record => record.id !== primary!.id).every(record => record.confirmation === 'pending')
      && saved.career!.projects.every(record => record.confirmation === 'pending'), 'otherImportedCareerRecordsRemainPending');
    const bytes = await readFile(join(projectRoot, 'apps/desktop/fixtures/focused-resume.md')), hash = createHash('sha256').update(bytes).digest('hex');
    expect(saved.career!.sources.some(source => source.fileHash === hash && source.text.includes('虚构快速申请简历')) && primary!.evidence.length > 0, 'realParserSourceHashTextAndRecordEvidenceRemainSaved');
    expect((await store.getState()).applications.length === 0, 'guideNeverCreatesApplicationOrSubmission');
    await click('onboarding-browse'); await waitFor('final-guide-dismissed', '!document.querySelector(\'[data-testid="onboarding-dialog"]\')');
    expect(await ui<boolean>('complete-receipt-only', `localStorage.getItem(${JSON.stringify(ONBOARDING_STORAGE_KEY)})===JSON.stringify({version:1,status:'completed'})`), 'completionReceiptOnlyMarksHelpAsSeen');
    await ui('remove-receipt-to-check-existing-user', `localStorage.removeItem(${JSON.stringify(ONBOARDING_STORAGE_KEY)})`); await reload();
    expect(await ui<boolean>('existing-profile-not-forced', '!document.querySelector(\'[data-testid="onboarding-dialog"]\')'), 'existingSavedProfileIsNeverForcedToReimportEvenWithoutReceipt');
    expect(forbiddenCommands.length === 0, 'onboardingMakesNoModelNetworkNativeInputOrUnrelatedFileCalls');
    const result = { ok: true, passed: true, assertionCount: assertions.length, evidence: 'hidden-own-renderer-real-parser-named-ipc-fictional-profile', assertions, screenshots, forbiddenCommands, chooserCalls, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'onboarding-ui.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); return result;
  } catch (error) {
    await writeFile(join(stateDirectory, 'onboarding-ui.json'), JSON.stringify({ passed: false, assertions, screenshots, forbiddenCommands, chooserCalls, harness: runner.snapshot(), failure: { stage: runner.snapshot().stage, message: error instanceof Error ? error.message : 'unknown' } }, null, 2), { mode: 0o600 });
    throw error;
  } finally { dialog.showOpenDialog = originalChooser; for (const [name, method] of replaced) methods[name] = method; }
}
