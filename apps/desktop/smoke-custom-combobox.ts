import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { app, type BrowserWindow } from 'electron';
import type { BrowserController } from '../../packages/browser/src/controller.js';
import { READ_FORM } from '../../packages/browser/src/read-scripts.js';
import { withConfirmedEducation } from '../../packages/profile/src/career-input.js';
import type { AppState, FillPlan, FillResult } from '../../packages/shared/src/contracts.js';
import { SmokeStepRunner } from './smoke-deadline.js';

interface FixtureSnapshot {
  form: { url: string; fields: Array<{ index: number; label: string; type: string; value: string; bounds: unknown; [key: string]: unknown }> };
  protected: { email: string; checked: boolean; fileValue: string; fileCount: number; hidden: string; submissions: number };
  native: { opens: number; selections: number; trustedOpens: number; trustedSelections: number; lastSelectedId: string; untrustedClicks: number };
  selectedIds: string[]; expanded: string | null; appBridge: boolean;
}

const expectedDegrees = [
  { id: 'bachelor', label: "Bachelor's degree", values: ['本科', '学士', 'bachelor', 'bachelors', "bachelor's", "bachelor's degree", 'bachelordegree'] },
  { id: 'master', label: "Master's degree", values: ['硕士', 'master', 'masters', "master's", "master's degree", 'masterdegree'] },
  { id: 'doctor', label: 'Doctorate', values: ['博士', 'phd', 'ph.d.', 'doctorate', 'doctoral'] },
  { id: 'associate', label: 'Associate degree', values: ['专科', '大专', 'associate', 'associate degree'] },
];

/** Production native controller against original local HTML; no model, live enterprise or layout claim. */
export async function smokeCustomCombobox(
  window: BrowserWindow, browser: BrowserController,
  methods: Record<string, (...args: any[]) => Promise<any>>, stateDirectory: string,
) {
  if (!process.argv.includes('--smoke-test') || process.argv.includes('--live-product-check')) {
    throw new Error('ARIA 原生单选验收仅允许隔离桌面 smoke。');
  }
  for (const name of ['getState', 'prepareFill', 'fillApproved', 'browserNavigate']) {
    if (typeof methods[name] !== 'function') throw new Error(`ARIA 单选验收缺少生产方法 ${name}`);
  }
  const expect = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const steps = new SmokeStepRunner('native-custom-combobox');
  const beforeState = await methods.getState!() as AppState;
  const profile = withConfirmedEducation(beforeState.profile);
  const degree = profile.degree.normalize('NFKC').trim().toLowerCase();
  const expected = expectedDegrees.find(option => option.values.some(value => value.normalize('NFKC').trim().toLowerCase() === degree));
  if (!expected) throw new Error('隔离资料没有已确认且可对应本机样表的默认学历，未修改资料或开始原生操作。');
  const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../../apps/desktop/fixtures/custom-combobox.html'), 'utf8');
  let pageRequests = 0, rejectedWrites = 0;
  const server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      rejectedWrites++; response.writeHead(405).end('This fictional fixture never accepts writes.'); return;
    }
    if (request.url !== '/offeragent-fixtures/custom-combobox') { response.writeHead(404).end(); return; }
    pageRequests++;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? '' : html);
  });
  let initial: FixtureSnapshot | undefined, immediate: FixtureSnapshot | undefined, delayed: FixtureSnapshot | undefined;
  let plan: FillPlan | undefined, result: FillResult | undefined;
  const readFixture = () => steps.run('independent-read-form-and-protected-state', () => browser.view.webContents.executeJavaScript(`(() => {
    const form=${READ_FORM};
    const native=window.customComboFixture;
    if(!native)throw new Error('原创单选样表尚未加载');
    return {form,protected:{email:document.getElementById('combo-existing-email').value,
      checked:document.getElementById('combo-existing-check').checked,
      fileValue:document.getElementById('combo-file').value,fileCount:document.getElementById('combo-file').files.length,
      hidden:document.getElementById('combo-hidden').value,submissions:native.submissions},
      native:{opens:native.opens,selections:native.selections,trustedOpens:native.trustedOpens,
        trustedSelections:native.trustedSelections,lastSelectedId:native.lastSelectedId,untrustedClicks:native.untrustedClicks},
      selectedIds:Array.from(document.querySelectorAll('#combo-degree-options [role="option"][aria-selected="true"]')).map(element=>element.id),
      expanded:document.getElementById('combo-degree').getAttribute('aria-expanded'),
      appBridge:typeof window.offer!=='undefined'||typeof require!=='undefined'};
  })()`) as Promise<FixtureSnapshot>);
  const otherFields = (snapshot: FixtureSnapshot) => snapshot.form.fields.filter(field => field.index !== 0)
    .map(({ bounds: _bounds, ...field }) => field);
  try {
    steps.setStage('serve-and-open-original-fixture');
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('ARIA 单选本机测试端口未建立。');
    const url = `http://127.0.0.1:${address.port}/offeragent-fixtures/custom-combobox`;
    await steps.run('production-browser-navigate', () => methods.browserNavigate!(url), 15_000);
    const bounds = browser.view.getBounds();
    expect(bounds.width >= 320 && bounds.height >= 300, '原生网页区域尚未建立；此入口不替代布局界面验收。');
    browser.setVisible(true);
    app.focus({ steal: true }); window.show(); window.focus(); browser.view.webContents.focus();
    const focusDeadline = Date.now() + 700;
    while ((!window.isFocused() || !browser.view.webContents.isFocused()) && Date.now() < focusDeadline) await delay(25);
    expect(window.isFocused() && browser.view.webContents.isFocused(), '本机 ARIA 验收未获得原生窗口焦点，没有开始填写。');
    initial = await readFixture();
    expect(initial.form.url === url && !initial.appBridge && initial.form.fields[0]?.type === 'combobox'
      && initial.form.fields[0]?.value === '' && initial.expanded === 'false', '独立观察不符合原创空白单选样表。');
    expect(initial.protected.email === 'keep-combobox@example.invalid' && initial.protected.checked
      && initial.protected.fileCount === 0 && initial.protected.submissions === 0, '原始样表保护字段不符合基线。');
    steps.setStage('production-rules-plan-and-native-fill');
    plan = await steps.run('production-prepare-plan-without-model', () => methods.prepareFill!() as Promise<FillPlan>);
    const selected = plan.items.filter(item => item.status === 'ready');
    expect(selected.length === 1 && selected[0]?.fieldId === 'field-0' && selected[0]?.profileKey === 'degree'
      && selected[0]?.value === profile.degree.trim() && plan.recognition?.mode !== 'model', '生产计划没有唯一绑定当前虚构默认学历，或意外调用模型。');
    result = await steps.run('production-native-approved-fill', () => methods.fillApproved!(plan!.id, [selected[0]!.fieldId]) as Promise<FillResult>, 15_000);
    expect(result.verified.length === 1 && result.verified[0]?.fieldId === 'field-0' && result.unresolved.length === 0,
      '原生 ARIA 下拉没有核实为成功；失败记录保留，不用 DOM setter 代替。');
    steps.setStage('independent-immediate-and-one-second-read');
    immediate = await readFixture();
    await delay(1_000);
    delayed = await readFixture();
    for (const snapshot of [immediate, delayed]) {
      expect(snapshot.form.url === url && snapshot.form.fields[0]?.value === expected.label && snapshot.expanded === 'false'
        && JSON.stringify(snapshot.selectedIds) === JSON.stringify([`combo-degree-${expected.id}`]), '独立重读没有保留默认学历对应的真实选项。');
      expect(JSON.stringify(snapshot.protected) === JSON.stringify(initial.protected)
        && JSON.stringify(otherFields(snapshot)) === JSON.stringify(otherFields(initial)), '下拉选择改动了非目标字段、勾选、附件或提交计数。');
      expect(snapshot.native.opens === 1 && snapshot.native.trustedOpens === 1 && snapshot.native.selections === 1
        && snapshot.native.trustedSelections === 1 && snapshot.native.untrustedClicks === 0
        && snapshot.native.lastSelectedId === `combo-degree-${expected.id}`, '未经过真实原生触发与选项点击，不能用脚本点击替代。');
      expect(!snapshot.appBridge, '原创网页错误取得了应用桥或 Node。');
    }
    const afterState = await methods.getState!() as AppState;
    expect(JSON.stringify(afterState.profile) === JSON.stringify(beforeState.profile)
      && JSON.stringify(afterState.applications) === JSON.stringify(beforeState.applications)
      && JSON.stringify(afterState.jobs) === JSON.stringify(beforeState.jobs), '控件填写改写了资料、岗位或申请状态。');
    expect(pageRequests >= 1 && rejectedWrites === 0, '本机样表未真实加载，或发生了不允许的网络写入。');
    const report = { ok: true, fixtureOnly: true, originalBundledHtml: true, realModelCalled: false,
      modelQualityEvaluated: false, realEnterpriseVerified: false, productUiLayoutVerified: false,
      productionPreparePlan: true, productionFillApproved: true, actionJournalUsed: true,
      trustedNativeTriggerAndOptionClicks: true, expectedConfirmedDegree: profile.degree,
      expectedOptionId: `combo-degree-${expected.id}`, verifiedNativeFields: 1,
      immediateIndependentRead: true, oneSecondIndependentRead: true, protectedFieldsUnchanged: true,
      profileUnchanged: true, jobsUnchanged: true, applicationsUnchanged: true,
      submitted: false, uploads: 0, pageRequests, rejectedWrites, initial, immediate, delayed,
      fillResult: result, harness: steps.snapshot() };
    await writeFile(join(stateDirectory, 'custom-combobox-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  } catch (error) {
    await writeFile(join(stateDirectory, 'custom-combobox-failure.json'), JSON.stringify({ ok: false,
      fixtureOnly: true, realModelCalled: false, productUiLayoutVerified: false,
      message: error instanceof Error ? error.message : String(error),
      pageRequests, rejectedWrites, initial, immediate, delayed, plan, result, harness: steps.snapshot(),
    }, null, 2), { mode: 0o600 });
    throw error;
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) { resolve(); return; }
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections(); server.closeAllConnections();
    });
  }
}
