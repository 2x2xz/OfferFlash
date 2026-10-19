import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { buildFillPlan } from '../packages/forms/src/index.js';
import { READ_FORM } from '../packages/browser/src/read-scripts.js';
import type { BrowserController } from '../packages/browser/src/controller.js';
import type { FormObservation, Profile } from '../packages/shared/src/contracts.js';

const profile: Profile = {
  version: 7, updatedAt: '2026-10-17T00:00:00.000Z', fullName: '虚构候选人', fullNameEn: 'Fictional Candidate',
  email: 'fixture@example.invalid', phone: '13800000000', school: '虚构大学', schoolEn: 'Fictional University',
  degree: '硕士', major: '计算机', majorEn: 'Computer Science', graduationMonth: '2027-06', skills: [],
  cities: [], targetRoles: [], resumeText: '',
};
const controllerCode = build({
  entryPoints: [resolve('packages/browser/src/controller.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'isolated-electron-test', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export class WebContentsView { constructor() { return globalThis.makeFixtureView(); } }', loader: 'js',
    }));
  } }],
}).then(result => result.outputFiles[0]!.text);

/** Only transport/focus are simulated here; the real native select is separately exercised in desktop smoke. */
async function fixture(type = 'select') {
  const raw = { url: 'https://fixture.example.invalid/application', title: '虚构表单', viewport: { width: 900, height: 700 }, fields: [{
    index: 0, label: type === 'select' ? '学历' : '毕业时间', type, value: type === 'select' ? '-1' : '', editable: true,
    required: false, section: '', identity: 'degree|degree||-1|||', bounds: { x: 10, y: 10, width: 200, height: 40 },
    options: type === 'select' ? [{ label: '请选择', value: '-1' }, { label: '本科', value: 'b' }, { label: '硕士', value: 'm' }] : [],
  }] };
  let currentProfile = structuredClone(profile), visible = false, focused = false, windowFocused = true;
  const events: Array<{ type: string; keyCode?: string }> = [], inserted: string[] = [];
  let onChar: (() => void) | undefined;
  let zoomFactor = 1;
  const contents = {
    id: 1, session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, on() {} },
    setZoomMode(mode: string) { assert.equal(mode, 'isolated'); },
    setZoomFactor(value: number) { zoomFactor = value; }, getZoomFactor: () => zoomFactor,
    setVisualZoomLevelLimits: async () => {}, setWindowOpenHandler() {}, on() {},
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    isDestroyed: () => false, getURL: () => raw.url, getTitle: () => raw.title,
    focus() { focused = true; }, isFocused: () => focused && windowFocused,
    async executeJavaScript(script: string) {
      if (script === READ_FORM) return structuredClone(raw);
      assert.match(script, /document\.elementFromPoint/u);
      return { exists: true, focused, uncovered: visible, value: raw.fields[0]!.value, url: raw.url, valid: true };
    },
    sendInputEvent(event: { type: string; keyCode?: string }) {
      events.push(event);
      if (event.type === 'mouseUp') focused = true;
      if (event.type === 'char') { raw.fields[0]!.value = 'm'; onChar?.(); }
      if (event.type === 'keyDown' && event.keyCode === 'Tab') focused = false;
    },
    async insertText(value: string) { inserted.push(value); raw.fields[0]!.value = value; },
  };
  const module = { exports: {} as { BrowserController: typeof BrowserController } };
  runInNewContext(await controllerCode, { module, exports: module.exports, require: createRequire(import.meta.url),
    structuredClone, URL, AbortController, DOMException, Buffer, setTimeout, clearTimeout,
    makeFixtureView: () => ({ webContents: contents, setVisible(value: boolean) { visible = value; }, setBounds() {} }),
  });
  const controller = new module.exports.BrowserController({
    window: { contentView: { addChildView() {} }, focus() { windowFocused = true; }, isFocused: () => windowFocused } as never,
    onState() {}, getProfile: async () => structuredClone(currentProfile),
  });
  controller.setVisible(true);
  return { controller, raw, events, inserted,
    changeProfile() { currentProfile.version++; }, loseFocus() { windowFocused = false; },
    onChar(callback: () => void) { onChar = callback; },
  };
}

test('native select sends only the observed unique label and verifies the actual option value', async () => {
  const f = await fixture(), plan = await f.controller.preparePlan();
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(result.unresolved.length, 0);
  assert.equal(f.events.filter(event => event.type === 'char').map(event => event.keyCode).join(''), '硕士');
  assert.equal(f.inserted.length, 0, 'select is never assigned via a text or JS value setter');
  assert.equal(f.events.some(event => /Enter|Return/u.test(event.keyCode ?? '')), false);
  assert.throws(() => f.controller.getPlan(plan.id), /失效/u, 'the approved plan is consumed once');
});

test('native select stops remaining characters immediately when the real window loses focus', async () => {
  const f = await fixture(), plan = await f.controller.preparePlan();
  f.onChar(() => f.loseFocus());
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /焦点/u);
  assert.equal(f.events.filter(event => event.type === 'char').length, 1);
  assert.equal(f.events.some(event => event.keyCode === 'Tab'), false);
});

test('a select change handler that replaces its options stops the old plan before the next character', async () => {
  const f = await fixture(), plan = await f.controller.preparePlan();
  f.onChar(() => { f.raw.fields[0]!.options[2]!.label = '网页已更换此选项'; });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /页面/u);
  assert.equal(f.events.filter(event => event.type === 'char').length, 1);
});

test('unknown exact-day segmented controls stay manual and receive no attempted personal-value input', async () => {
  const f = await fixture('date'), plan = await f.controller.preparePlan();
  assert.equal(plan.items[0]?.status, 'review');
  await assert.rejects(f.controller.fillApproved(plan.id, ['field-0']), /无法自动填写/);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  // Preserve the executor's independent guard even for an internal resolver
  // that incorrectly marks this unsupported control as ready.
  const forced = await f.controller.preparePlan(async (observation, candidate) => {
    const result = buildFillPlan(observation, candidate);
    result.items[0] = { ...result.items[0]!, status: 'ready', value: candidate.graduationMonth };
    return result;
  });
  const result = await f.controller.fillApproved(forced.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /分段日期/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
});

test('async model recognition blocks concurrent browser actions and rejects a stale profile', async () => {
  const f = await fixture();
  let release!: () => void, observed!: FormObservation, boundProfile!: Profile;
  const wait = new Promise<void>(resolveWait => { release = resolveWait; });
  const preparing = f.controller.preparePlan(async (observation, candidate) => {
    observed = observation; boundProfile = candidate; await wait; return buildFillPlan(observation, candidate);
  });
  while (!observed) await setImmediate();
  await assert.rejects(f.controller.navigate('https://fixture.example.invalid/other'), /识别/u);
  await assert.rejects(f.controller.fillApproved('unknown', ['field-0']), /识别/u);
  await assert.rejects(f.controller.collectVisibleJobs(), /识别/u);
  await assert.rejects(f.controller.preparePlan(), /识别/u);
  f.changeProfile(); release();
  await assert.rejects(preparing, /页面或资料变化/u);
  assert.equal(boundProfile.version, 7); assert.equal(f.events.length, 0);
  const currentPlan = await f.controller.preparePlan();
  assert.equal(currentPlan.profileVersion, 8, 'failed async recognition releases its lock for a new observation');
});

test('async recognition also rejects changed field values even when structural signatures stay equal', async () => {
  const f = await fixture();
  let release!: () => void, entered = false;
  const wait = new Promise<void>(resolveWait => { release = resolveWait; });
  const preparing = f.controller.preparePlan(async (observation, candidate) => {
    entered = true; await wait; return buildFillPlan(observation, candidate);
  });
  while (!entered) await setImmediate();
  f.raw.fields[0]!.value = 'b'; release();
  await assert.rejects(preparing, /页面或资料变化/u);
  assert.equal(f.events.length, 0);
});

function readControls(controls: object[]) {
  const result = runInNewContext(READ_FORM, {
    document: { title: '虚构原生控件', querySelectorAll: () => controls, getElementById: () => null },
    location: { href: 'https://fixture.example.invalid/application' }, innerWidth: 900, innerHeight: 700,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  }) as { fields: Array<{ type: string; editable: boolean; identity: string; options: Array<{ label: string; value: string }> }> };
  return result.fields;
}
function control(changes: Record<string, unknown> = {}) {
  return Object.freeze({
    tagName: 'SELECT', id: 'degree', name: 'degree', value: '-1', size: 0, multiple: false, disabled: false, readOnly: false,
    labels: [], options: [], min: '', max: '', step: '', required: false,
    getBoundingClientRect: () => ({ x: 10, y: 10, width: 200, height: 40 }),
    getAttribute: (name: string) => name === 'aria-label' ? '学历' : '', closest: () => null,
    ...changes,
  });
}
function option(text: string, value: string, flags: { disabled?: boolean; hidden?: boolean; groupDisabled?: boolean } = {}) {
  return Object.freeze({ text, value, disabled: flags.disabled ?? false, hidden: flags.hidden ?? false,
    closest: () => flags.groupDisabled ? { disabled: true } : null });
}

test('read-only native observations exclude disabled groups and hidden options before matching', () => {
  const select = control({ options: Object.freeze([
    option('请选择', '-1'), option('硕士', 'disabled-group', { groupDisabled: true }),
    option('硕士', 'disabled-option', { disabled: true }), option('硕士', 'hidden-option', { hidden: true }), option('硕士', 'm'),
  ]) });
  const fields = readControls([select]);
  assert.equal(JSON.stringify(fields[0]!.options), JSON.stringify([{ label: '请选择', value: '-1' }, { label: '硕士', value: 'm' }]));
  assert.equal(fields[0]!.editable, true);
});

test('multi-select, listboxes and truncated option sets cannot become normal automatic selects', () => {
  const tooMany = Array.from({ length: 501 }, (_, index) => option(`选项 ${index}`, `${index}`));
  const fields = readControls([control({ multiple: true }), control({ size: 4 }), control({ options: tooMany })]);
  assert.equal(fields[0]!.type, 'select-multiple'); assert.equal(fields[1]!.type, 'select-multiple');
  assert.equal(fields[2]!.editable, false, 'an incomplete 500-option observation is never offered as editable');
});

test('native constraints are included in observed identity so a later date range cannot reuse a plan', () => {
  const before = readControls([control({ tagName: 'INPUT', type: 'month', min: '2026-01', max: '2028-12', step: '1' })]);
  const after = readControls([control({ tagName: 'INPUT', type: 'month', min: '2027-07', max: '2028-12', step: '1' })]);
  assert.notEqual(before[0]!.identity, after[0]!.identity);
});

test('hiding and reopening the browser during async recognition invalidates that observation', async () => {
  const f = await fixture();
  let release!: () => void, entered = false;
  const wait = new Promise<void>(resolveWait => { release = resolveWait; });
  const preparing = f.controller.preparePlan(async (observation, candidate) => {
    entered = true; await wait; return buildFillPlan(observation, candidate);
  });
  while (!entered) await setImmediate();
  f.controller.setVisible(false); f.controller.setVisible(true); release();
  await assert.rejects(preparing, /页面或资料变化/u);
  assert.equal(f.events.length, 0);
});

test('async resolver cannot bind an approved plan to a different URL or observation', async () => {
  const f = await fixture();
  await assert.rejects(f.controller.preparePlan(async (observation, candidate) => ({
    ...buildFillPlan(observation, candidate), observationId: 'not-this-observation',
  })), /绑定当前页面和资料/u);
  await assert.rejects(f.controller.preparePlan(async (observation, candidate) => ({
    ...buildFillPlan(observation, candidate), url: 'https://fixture.example.invalid/another',
  })), /绑定当前页面和资料/u);
  assert.equal(f.events.length, 0);
});
