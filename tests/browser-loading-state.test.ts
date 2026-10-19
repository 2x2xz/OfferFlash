import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { BrowserController } from '../packages/browser/src/controller.js';
import { READ_FORM } from '../packages/browser/src/read-scripts.js';
import { buildFillPlan } from '../packages/forms/src/index.js';
import type { BrowserState, Profile } from '../packages/shared/src/contracts.js';
import { runQuickFill } from '../packages/ui/src/apply-flow.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';

const bundled = build({ entryPoints: [resolve('packages/browser/src/controller.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'loading-event-fixture', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export class WebContentsView { constructor() { return globalThis.makeView(); } }', loader: 'js',
    }));
  } }],
}).then(result => result.outputFiles[0]!.text);

test('an explicit education-only request never selects omitted internship or project collections', async () => {
  const f = await fixture();
  const profile = createCareerFormFixtureProfile();
  const selected = profile.career!.educations[0]!.id;
  const options = (f.controller as any).careerOptions({ profileVersion: profile.version,
    selectedRecordIds: { educations: [selected] } }, profile);
  assert.deepEqual(JSON.parse(JSON.stringify(options.selectedRecordIds)), { educations: [selected], internships: [], projects: [] });
  assert.throws(() => (f.controller as any).careerOptions({ profileVersion: profile.version,
    selectedRecordIds: { educations: [selected, selected] } }, profile), /所选履历列表无效/);
});

/** Fake Electron events test the production event wiring; no browser or model is started. */
async function fixture() {
  const raw = { url: 'https://fixture.example.invalid/apply', title: '虚构加载事件样本', viewport: { width: 900, height: 700 },
    fields: [{ index: 0, label: '邮箱', type: 'email', value: '', editable: true, required: true,
      section: '', identity: 'email|email|||', bounds: { x: 100, y: 100, width: 220, height: 40 }, options: [] }],
  };
  const profile: Profile = { version: 1, updatedAt: '2026-10-18T00:00:00Z', fullName: '', fullNameEn: '',
    email: 'fixture@example.invalid', phone: '', school: '', schoolEn: '', major: '', majorEn: '', degree: '',
    graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '' };
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const published: BrowserState[] = [];
  let mainFrameLoading = false;
  let zoomFactor = 1;
  const contents = {
    id: 1, session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, on() {} },
    setZoomMode(mode: string) { assert.equal(mode, 'isolated'); },
    setZoomFactor(value: number) { zoomFactor = value; }, getZoomFactor: () => zoomFactor,
    setVisualZoomLevelLimits: async () => {}, setWindowOpenHandler() {},
    on(name: string, listener: (...args: unknown[]) => void) { listeners.set(name, listener); },
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }, isDestroyed: () => false,
    getURL: () => raw.url, getTitle: () => raw.title, isLoadingMainFrame: () => mainFrameLoading,
    async executeJavaScript(script: string) { assert.equal(script, READ_FORM); return structuredClone(raw); },
  };
  const module = { exports: {} as { BrowserController: typeof BrowserController } };
  runInNewContext(await bundled, { module, exports: module.exports, require: createRequire(import.meta.url),
    structuredClone, URL, AbortController, DOMException, Buffer, setTimeout, clearTimeout,
    makeView: () => ({ webContents: contents, setVisible() {}, setBounds() {} }),
  });
  const controller = new module.exports.BrowserController({
    window: { contentView: { addChildView() {} } } as never,
    onState(state) { published.push(state); }, getProfile: async () => structuredClone(profile),
  });
  controller.setVisible(true);
  return { controller, published, raw,
    emit(name: string, ...args: unknown[]) { listeners.get(name)?.(...args); },
    mainLoading(value: boolean) { mainFrameLoading = value; },
  };
}

test('background iframe spinner events do not cancel a quick fill while its plan is being prepared', async () => {
  const f = await fixture();
  const before = f.controller.getState();
  let filled = 0;
  const outcome = await runQuickFill({ context: { url: before.url, profileVersion: 1 },
    isCurrent: () => f.controller.getState().url === before.url && f.published.every(state => state.loading === before.loading),
    prepare: () => f.controller.preparePlan(async (observation, profile) => {
      f.emit('did-start-navigation', {}, 'https://analytics.example.invalid/frame', false, false);
      f.emit('did-start-loading');
      await new Promise(resolve => setImmediate(resolve));
      f.emit('did-frame-finish-load', {}, false, 1, 2);
      f.emit('did-stop-loading');
      return buildFillPlan(observation, profile);
    }),
    fill: async (planId, fieldIds) => { filled++; return { planId, verified: fieldIds.map(fieldId => ({ fieldId, label: '邮箱' })), unresolved: [] }; },
    onPreview() {}, onFilling() {},
  });
  assert.equal(outcome.filled, true);
  assert.equal(filled, 1);
  assert.equal(f.controller.getState().loading, false);
});

test('main navigation immediately marks loading and invalidates a plan even at the same URL', async () => {
  const f = await fixture();
  const oldPlan = await f.controller.preparePlan();
  f.mainLoading(true);
  f.emit('did-start-navigation', {}, f.raw.url, false, true);
  assert.equal(f.controller.getState().loading, true);
  assert.throws(() => f.controller.getPlan(oldPlan.id), /失效/);
  f.emit('did-frame-finish-load', {}, false, 1, 2);
  assert.equal(f.controller.getState().loading, true, 'a subframe finishing must not finish the main navigation');
  f.emit('did-stop-loading');
  assert.equal(f.controller.getState().loading, true, 'a spinner stop cannot overrule an active main frame');
  f.mainLoading(false);
  f.emit('did-frame-finish-load', {}, true, 1, 1);
  assert.equal(f.controller.getState().loading, false, 'main-frame completion does not require a later tab spinner stop');
  f.emit('did-start-loading');
  assert.equal(f.controller.getState().loading, false, 'late analytics must not mark the main page loading again');
});

test('a main navigation during recognition rejects the prepared plan through the original generation check', async () => {
  const f = await fixture();
  await assert.rejects(f.controller.preparePlan(async (observation, profile) => {
    f.emit('did-start-navigation', {}, f.raw.url, false, true);
    f.emit('did-frame-finish-load', {}, true, 1, 1);
    return buildFillPlan(observation, profile);
  }), /页面或资料变化/);
});

test('same-document main navigation invalidates old plans without waiting for a load event that will not occur', async () => {
  const f = await fixture();
  const oldPlan = await f.controller.preparePlan();
  f.emit('did-start-navigation', {}, `${f.raw.url}#details`, true, true);
  f.raw.url += '#details';
  f.emit('did-navigate-in-page', {}, f.raw.url, true, 1, 1);
  assert.equal(f.controller.getState().loading, false);
  assert.equal(f.controller.getState().url, f.raw.url);
  assert.throws(() => f.controller.getPlan(oldPlan.id), /失效/);
});

test('aborted and failed main loads clear busy state without treating subframe failures as main failures', async () => {
  const f = await fixture();
  f.mainLoading(true);
  f.emit('did-start-navigation', {}, f.raw.url, false, true);
  f.emit('did-fail-load', {}, -105, 'subframe failed', 'https://analytics.example.invalid/frame', false);
  assert.equal(f.controller.getState().loading, true);
  assert.equal(f.controller.getState().error, undefined);
  f.mainLoading(false);
  f.emit('did-fail-load', {}, -3, 'aborted', f.raw.url, true);
  f.emit('did-stop-loading');
  assert.equal(f.controller.getState().loading, false);
  assert.equal(f.controller.getState().error, undefined);
  f.emit('did-start-navigation', {}, f.raw.url, false, true);
  f.emit('did-fail-load', {}, -105, 'fixture main load failed', f.raw.url, true);
  assert.equal(f.controller.getState().loading, false);
  assert.match(f.controller.getState().error!, /fixture main load failed/);
});
