import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { app, type BrowserWindow } from 'electron';
import { BrowserController } from '../../packages/browser/src/controller.js';
import type { CareerFillOutcome, CareerFillPreview } from '../../packages/shared/src/contracts.js';
import type { CareerRunnerJournalEvent } from '../../packages/forms/src/career-runner.js';
import { createCareerFormFixtureProfile } from './fixtures/career-form-profile.js';
import { SmokeStepRunner } from './smoke-deadline.js';

const sourcePaths = [
  'packages/browser/src/controller.ts', 'packages/browser/src/feishu-native.ts', 'packages/browser/src/feishu-scripts.ts',
  'packages/forms/src/career-plan.ts', 'packages/forms/src/career-runner.ts', 'apps/desktop/fixtures/career-form-profile.ts',
] as const;
const fixturePaths = ['apps/desktop/fixtures/feishu-career.html', 'apps/desktop/smoke-feishu-career.ts'] as const;
interface FixtureSnapshot {
  url: string; groupIds: string[]; fields: Record<string, string>;
  protected: { email: string; checked: boolean; fileValue: string; files: number; hidden: string; submissions: number; submitClicks: number };
  counters: { adds: number; trustedAdds: number; typed: number; trustedTyped: number;
    selectOpens: number; trustedSelectOpens: number; selections: number; trustedSelections: number;
    monthOpens: number; trustedMonthOpens: number; years: number; trustedYears: number; months: number; trustedMonths: number;
    untrustedEvents: number; events: Array<{ type: string; action: string; path: string; trusted: boolean }> };
  appBridge: boolean;
}

/** An original loopback fixture using the production class/API, with a fresh local profile and no store/model. */
export async function smokeFeishuCareer(window: BrowserWindow, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || process.argv.includes('--live-product-check')) throw new Error('飞书虚构履历验收只允许显式隔离 smoke。');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const reportPath = join(stateDirectory, 'feishu-career-report.json');
  const markerPath = join(root, '.backups/feishu-native-fixture/native-ready.json');
  const expect = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const digest = async (paths: readonly string[]) => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])));
  const beforeDigests = await digest(sourcePaths); const beforeFixtureDigests = await digest(fixturePaths);
  await rm(markerPath, { force: true });
  const buildDigests = JSON.parse(await readFile(join(root, 'dist/desktop/career-build-digests.json'), 'utf8'));
  expect(JSON.stringify(buildDigests.sourceDigests) === JSON.stringify({ ...beforeDigests, ...beforeFixtureDigests })
    && buildDigests.backendSha256 === createHash('sha256').update(await readFile(join(root, 'dist/desktop/backend.js'))).digest('hex'),
  '源码或后端与本次构建清单不同，请重新构建后验收。');
  const html = await readFile(join(root, 'apps/desktop/fixtures/feishu-career.html'), 'utf8');
  const profile = createCareerFormFixtureProfile(); const initialProfile = JSON.stringify(profile);
  const selectedRecordIds = { educations: profile.career!.educations.map(record => record.id),
    internships: profile.career!.internships.map(record => record.id), projects: profile.career!.projects.map(record => record.id) };
  const expected: Record<string, string> = {};
  for (const [index, record] of profile.career!.educations.entries()) Object.assign(expected, {
    [`education[${index}].school`]: record.school, [`education[${index}].degree`]: record.degree,
    [`education[${index}].fieldOfStudy`]: record.major, [`education[${index}].period:start`]: record.startDate,
    [`education[${index}].period:end`]: record.endDate,
  });
  for (const [index, record] of profile.career!.internships.entries()) Object.assign(expected, {
    [`internship[${index}].company`]: record.organization, [`internship[${index}].title`]: record.role,
    [`internship[${index}].period:start`]: record.startDate, [`internship[${index}].period:end`]: record.endDate,
    [`internship[${index}].desc`]: record.description,
  });
  for (const [index, record] of profile.career!.projects.entries()) Object.assign(expected, {
    [`project[${index}].name`]: record.name, [`project[${index}].role`]: record.role,
    [`project[${index}].period:start`]: record.startDate, [`project[${index}].period:end`]: record.endDate,
    [`project[${index}].desc`]: record.description, [`project[${index}].link`]: record.url,
  });
  expect(Object.keys(expected).length === 32, '虚构资料字段数不是冻结的 32 项。');
  let pageRequests = 0, rejectedWrites = 0;
  const server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) { rejectedWrites++; response.writeHead(405).end('No writes accepted.'); return; }
    if (request.url !== '/offeragent-fixtures/feishu-career') { response.writeHead(404).end(); return; }
    pageRequests++; response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; connect-src 'none'" });
    response.end(request.method === 'HEAD' ? '' : html);
  });
  const steps = new SmokeStepRunner('native-feishu-career-fixture');
  let browser: BrowserController | undefined, initial: FixtureSnapshot | undefined, immediate: FixtureSnapshot | undefined, delayed: FixtureSnapshot | undefined;
  let preview: CareerFillPreview | undefined, outcome: CareerFillOutcome | undefined;
  const journal: CareerRunnerJournalEvent[] = [];
  const readFixture = () => steps.run('independent-fixed-path-read', () => browser!.view.webContents.executeJavaScript(`(() => {
    const counters=window.feishuCareerFixture;if(!counters)throw new Error('原创虚构飞书样表未加载');
    const byCy=(root,value)=>Array.from(root.querySelectorAll('[data-cy]')).filter(element=>element.getAttribute('data-cy')===value);
    const fields={};
    for(const path of ${JSON.stringify(Object.keys(expected))}){
      const side=/^(.*):(start|end)$/.exec(path);
      if(side){const endpoint=byCy(document,side[1]+'Input'+(side[2]==='start'?'Begin':'End'));
        if(endpoint.length!==1){fields[path]='[missing]';continue;}
        const year=byCy(endpoint[0],'year'),month=byCy(endpoint[0],'month');
        if(year.length!==1||month.length!==1){fields[path]='[ambiguous]';continue;}
        fields[path]=year[0].textContent==='YYYY'&&month[0].textContent==='MM'?'':year[0].textContent+'-'+month[0].textContent;
      }else{const wrapper=byCy(document,path);if(wrapper.length!==1){fields[path]='[missing]';continue;}
        if(path.endsWith('.degree')){const selected=byCy(wrapper[0],'selectedValue');fields[path]=selected.length===1?selected[0].textContent:selected.length?'[ambiguous]':'';}
        else{const inputs=wrapper[0].querySelectorAll('input,textarea');fields[path]=inputs.length===1?inputs[0].value:'[ambiguous]';}}
    }
    return {url:location.href,groupIds:Array.from(document.querySelectorAll('[data-fixture-group-id]')).map(node=>node.getAttribute('data-fixture-group-id')),
      fields,protected:{email:document.getElementById('fixture-existing-email').value,checked:document.getElementById('fixture-existing-check').checked,
        fileValue:document.getElementById('fixture-file').value,files:document.getElementById('fixture-file').files.length,
        hidden:document.getElementById('fixture-hidden').value,submissions:counters.submissions,submitClicks:counters.submitClicks},
      counters:JSON.parse(JSON.stringify(counters)),appBridge:typeof window.offer!=='undefined'||typeof require!=='undefined'};
  })()`) as Promise<FixtureSnapshot>);
  try {
    steps.setStage('serve-original-fixture');
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('本机虚构样站端口未建立。');
    const origin = `http://127.0.0.1:${address.port}`, url = origin + '/offeragent-fixtures/feishu-career';
    browser = new BrowserController({ window, getProfile: async () => structuredClone(profile), onState: () => {}, careerFixtureOrigin: origin });
    const area = window.getContentBounds(); expect(area.width >= 640 && area.height >= 450, '原生样表窗口尺寸不足。');
    browser.resize({ x: 8, y: 8, width: area.width - 16, height: area.height - 16 }); browser.setVisible(true);
    app.focus({ steal: true }); window.show(); window.focus(); browser.view.webContents.focus();
    await steps.run('production-controller-navigate', () => browser!.navigate(url), 15_000);
    browser.view.webContents.focus();
    const until = Date.now() + 700;
    while ((!window.isFocused() || !browser.view.webContents.isFocused()) && Date.now() < until) await delay(25);
    expect(window.isFocused() && browser.view.webContents.isFocused(), '原生样表未取得窗口与网页焦点，未执行填写。');
    initial = await readFixture();
    expect(initial.url === url && !initial.appBridge && JSON.stringify(initial.groupIds) === JSON.stringify(['education[0]']), '原始网页组或隔离状态不正确。');
    expect(initial.protected.email === 'keep-career@example.invalid' && initial.protected.checked && initial.protected.files === 0
      && initial.protected.fileValue === '' && initial.protected.hidden === 'keep-fictional-hidden-state'
      && initial.protected.submissions === 0 && initial.protected.submitClicks === 0, '保护字段基线不正确。');
    steps.setStage('production-career-preview-and-native-execution');
    preview = await steps.run('production-prepare-career-fill', () => browser!.prepareCareerFill({ profileVersion: 1, selectedRecordIds }), 8_000);
    expect(preview.profileVersion === 1 && preview.issues.length === 0 && preview.bindings.length === 1
      && preview.bindings[0]!.recordId === selectedRecordIds.educations[0], '初始经历预览未绑定明确的虚构记录。');
    outcome = await steps.run('production-run-career-fill', () => browser!.runCareerFill(preview!.planId, async event => { journal.push(structuredClone(event)); }), 180_000);
    expect(outcome.status === 'completed' && outcome.addedCount === 5 && outcome.verifiedCount === 32 && outcome.pending.length === 0
      && outcome.bindings.length === 6, '生产原生链未核实五次新增与六条经历的 32 个字段。');
    for (const [collection, ids] of Object.entries(selectedRecordIds)) {
      expect(JSON.stringify(outcome.bindings.filter(binding => binding.collection === collection).map(binding => binding.recordId)) === JSON.stringify(ids), '网页组绑定记录的类别或顺序错误。');
    }
    steps.setStage('independent-immediate-and-one-second-read'); immediate = await readFixture(); await delay(1_000); delayed = await readFixture();
    for (const snapshot of [immediate, delayed]) {
      expect(snapshot.url === url && !snapshot.appBridge && JSON.stringify(snapshot.groupIds) === JSON.stringify(['education[0]', 'education[1]', 'internship[0]', 'internship[1]', 'project[0]', 'project[1]']), '独立重读的六组记录身份不正确。');
      expect(JSON.stringify(snapshot.fields) === JSON.stringify(expected), '独立固定路径重读发现字段串组、丢失或日期不符。');
      expect(JSON.stringify(snapshot.protected) === JSON.stringify(initial.protected), '保护邮箱、勾选、附件、隐藏值或提交计数变化。');
      const native = snapshot.counters;
      expect(native.adds === 5 && native.trustedAdds === 5 && native.typed === 18 && native.trustedTyped === 18
        && native.selectOpens === 2 && native.trustedSelectOpens === 2 && native.selections === 2 && native.trustedSelections === 2
        && native.monthOpens === 12 && native.trustedMonthOpens === 12 && native.years === 12 && native.trustedYears === 12
        && native.months === 12 && native.trustedMonths === 12 && native.untrustedEvents === 0,
      '没有得到预期的可信原生新增、输入、单选和年月选择事件。');
    }
    expect(JSON.stringify(profile) === initialProfile, '虚构资料在填写后被修改。');
    expect(journal.length === 74 && journal.filter(event => event.phase === 'intent').length === 37
      && journal.filter(event => event.phase === 'result' && event.status === 'verified').length === 37, '37 次动作的 intent/result 不完整。');
    for (let index = 0; index < journal.length; index += 2) expect(journal[index]!.phase === 'intent' && journal[index + 1]!.phase === 'result'
      && journal[index]!.action.id === journal[index + 1]!.action.id, '动作 intent/result 没有逐次配对。');
    expect(pageRequests >= 1 && rejectedWrites === 0, '样表未加载或尝试网络写入。');
    const sourceDigests = await digest(sourcePaths), fixtureDigests = await digest(fixturePaths);
    expect(JSON.stringify(sourceDigests) === JSON.stringify(beforeDigests) && JSON.stringify(fixtureDigests) === JSON.stringify(beforeFixtureDigests), '验收期间源码或原创样表变化，不能生成当前候选门禁。');
    const report = { ok: true, fixtureOnly: true, realEnterpriseVerified: false, realModelCalled: false, modelCalls: 0,
      productionBrowserController: true, productionPrepareCareerFill: true, productionRunCareerFill: true,
      fakeRecords: 6, verifiedNativeFields: 32, nativeAddedGroups: 5, submitted: false, uploads: 0,
      protectedFieldsUnchanged: true, profileUnchanged: true, ordinaryStoreRead: false,
      nativeDiagnostics: browser.getCareerDiagnostics(),
      immediateIndependentRead: true, oneSecondIndependentRead: true, sourceDigests, fixtureDigests,
      pageRequests, rejectedWrites, preview, outcome, initial, immediate, delayed, journal, harness: steps.snapshot() };
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFile(markerPath, JSON.stringify({ ok: true, reportPath, sourceDigests, fixtureDigests,
      reportSha256: createHash('sha256').update(await readFile(reportPath)).digest('hex'),
      backendSha256: buildDigests.backendSha256,
      verifiedNativeFields: 32, nativeAddedGroups: 5, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return report;
  } catch (error) {
    await writeFile(join(stateDirectory, 'feishu-career-failure.json'), JSON.stringify({ ok: false, fixtureOnly: true,
      realEnterpriseVerified: false, realModelCalled: false, submitted: false, pageRequests, rejectedWrites,
      message: error instanceof Error ? error.message : String(error), nativeDiagnostics: browser?.getCareerDiagnostics(),
      preview, outcome, initial, immediate, delayed, journal, harness: steps.snapshot() }, null, 2), { mode: 0o600 });
    throw error;
  } finally {
    browser?.cancelCareerFill(); browser?.dispose();
    await new Promise<void>((done, reject) => {
      if (!server.listening) { done(); return; }
      server.close(error => error ? reject(error) : done()); server.closeIdleConnections(); server.closeAllConnections();
    });
  }
}
