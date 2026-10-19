import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import { READ_FORM, readTarget } from '../packages/browser/src/read-scripts.js';
import { READ_FEISHU_CAREER } from '../packages/browser/src/feishu-scripts.js';
import { buildFillPlan } from '../packages/forms/src/index.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import type { BrowserController } from '../packages/browser/src/controller.js';
import type { ApplicationFieldLocationInput, ApplicationWorkflowIssue, FillPlan, Profile } from '../packages/shared/src/contracts.js';

const code = build({ entryPoints: [resolve('packages/browser/src/controller.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'scroll-transport-fixture', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export class WebContentsView { constructor() { return globalThis.makeView(); } }', loader: 'js',
    }));
  } }],
}).then(result => result.outputFiles[0]!.text);

// This verifies controller guards with a simulated transport. Real wheel/focus
// behavior is separately checked by the desktop/live-page acceptance run.
test('production recovery retries a transient pre-input hover shift once without duplicating text', async () => {
  const f = await fixture(200, 2); let moved = false;
  f.move(() => { if (!moved) { moved = true; f.raw.fields[0]!.bounds.y += 3; } });
  const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(result.retryCount, 1);
  assert.equal(f.inserted.length, 1); assert.deepEqual(f.retries.map(item => item.attempt), [2]);
});
test('enabled recovery never retries blur, changed values or a failure after insert dispatch', async () => {
  for (const mode of ['blur', 'changed', 'insert'] as const) {
    const f = await fixture(200, 2);
    if (mode === 'blur') f.move(() => f.loseFocus());
    if (mode === 'changed') f.move(() => { f.raw.fields[0]!.value = 'manual value'; });
    if (mode === 'insert') f.insert(() => { throw f.error('uncertain insertion'); });
    const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(f.retries.length, 0); assert.equal(f.inserted.length, 0);
    assert.equal(result.unresolved.length, 1);
  }
});
async function fixture(y = 1100, fillRetryLimit: 0 | 2 = 0, isolatedReveal = false) {
  const raw = { url: 'https://fixture.example.invalid/apply', title: '虚构网申', viewport: { width: 900, height: 700 },
    fields: [{ index: 0, label: '姓名', type: 'text', value: '', editable: true, required: true,
      section: '', identity: 'name|name|||', bounds: { x: 100, y, width: 220, height: 40 }, options: [] }],
  };
  let profile: Profile = { version: 1, updatedAt: '2026-10-17T00:00:00.000Z', fullName: '虚构候选人',
    fullNameEn: '', email: '', phone: '', school: '', schoolEn: '', major: '', majorEn: '', degree: '',
    graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '' };
  let focused = true, viewFocused = true, viewFocusDelay = 0, refuseViewFocus = false, targetFocusDelay = 0;
  let visible = true, targetFocused = false, blocked = false;
  let focusCalls = 0, pointerIdentity = 'fixture-surface';
  let covered: (centerY: number) => boolean = () => false;
  let onWheel: (() => void) | undefined;
  let onRead: (() => void) | undefined;
  let onMove: (() => void) | undefined;
  let onClick: (() => void) | undefined;
  let onTargetRead: ((script: string) => unknown) | undefined;
  let onPointerRead: ((script: string) => unknown) | undefined;
  let onInsert: (() => void) | undefined;
  let onProfileRead: (() => void | Promise<void>) | undefined;
  let onCareerRead: (() => unknown) | undefined;
  let onReveal: (() => unknown | Promise<unknown>) | undefined;
  const isolatedCalls: Array<{ worldId: number; code: string; userGesture: boolean }> = [];
  const events: Array<{ type: string; deltaY?: number; hasPreciseScrollingDeltas?: boolean }> = [], inserted: string[] = [], insertedY: number[] = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const windowListeners = new Map<string, () => void>();
  const retries: Array<{attempt:number;maxAttempts:number}> = [];
  let zoomFactor = 1;
  const zoomModes: string[] = [], zoomChanges: number[] = [], observationZooms: number[] = [];
  const contents = {
    id: 1, session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, on() {} },
    setZoomMode(mode: string) { assert.equal(mode, 'isolated'); zoomModes.push(mode); },
    setZoomFactor(value: number) { zoomFactor = value; zoomChanges.push(value); }, getZoomFactor: () => zoomFactor,
    setVisualZoomLevelLimits: async () => {}, setWindowOpenHandler() {},
    on(name: string, callback: (...args: unknown[]) => void) { listeners.set(name, callback); },
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }, isDestroyed: () => false,
    getURL: () => raw.url, getTitle: () => raw.title,
    focus() { focusCalls++; if (!refuseViewFocus) { if (viewFocusDelay) setTimeout(() => { viewFocused = true; }, viewFocusDelay); else viewFocused = true; } }, isFocused: () => focused && viewFocused,
    async executeJavaScript(script: string) {
      if (script === READ_FORM) { observationZooms.push(zoomFactor); await onRead?.(); return structuredClone(raw); }
      if (script === READ_FEISHU_CAREER && onCareerRead) return structuredClone(await onCareerRead());
      assert.match(script, /document\.elementFromPoint/u);
      assert.doesNotMatch(script, /scrollIntoView|\.scroll(?:Top|Left)\s*=|\.focus\(|\.value\s*=/u);
      if (script.includes('pointerIdentity')) return onPointerRead ? await onPointerRead(script) : { exists: true, pointerIdentity, url: raw.url };
      if (onTargetRead) return await onTargetRead(script);
      return { exists: true, focused: targetFocused,
        uncovered: visible && !covered(raw.fields[0]!.bounds.y + raw.fields[0]!.bounds.height / 2),
        value: raw.fields[0]!.value, url: raw.url, valid: true };
    },
    ...(isolatedReveal ? { async executeJavaScriptInIsolatedWorld(worldId: number, sources: Array<{ code: string }>, userGesture: boolean) {
      assert.equal(worldId, 9468); assert.equal(userGesture, false); assert.equal(sources.length, 1);
      assert.match(sources[0]!.code, /offeragent-reveal-observed-field/u);
      assert.doesNotMatch(sources[0]!.code, /\.focus\(|\.value\s*=|insertText|sendInputEvent|\.click\(/u);
      isolatedCalls.push({ worldId, code: sources[0]!.code, userGesture });
      if (onReveal) return await onReveal();
      raw.fields[0]!.bounds.y = 200; return { url: raw.url, exists: true, scrolled: true, reason: 'requested' };
    } } : {}),
    sendInputEvent(event: typeof events[number]) {
      events.push(event);
      if (event.type === 'mouseMove') onMove?.();
      if (event.type === 'mouseWheel') {
        if (!blocked) raw.fields[0]!.bounds.y += event.deltaY ?? 0;
        onWheel?.();
      }
      if (event.type === 'mouseUp') { if (targetFocusDelay) setTimeout(() => { targetFocused = true; }, targetFocusDelay); else targetFocused = true; onClick?.(); }
    },
    async insertText(value: string) { onInsert?.(); inserted.push(value); insertedY.push(raw.fields[0]!.bounds.y); raw.fields[0]!.value = value; },
  };
  const module = { exports: {} as { BrowserController: typeof BrowserController; makeFixtureError(message: string): Error } };
  runInNewContext(await code + '\nmodule.exports.makeFixtureError = message => new Error(message);', { module, exports: module.exports, require: createRequire(import.meta.url),
    structuredClone, URL, AbortController, DOMException, Buffer, setTimeout, clearTimeout, performance,
    makeView: () => ({ webContents: contents, setVisible(value: boolean) { visible = value; }, setBounds() {} }),
  });
  const controller = new module.exports.BrowserController({
    window: { contentView: { addChildView() {} }, focus() { focused = true; }, isFocused: () => focused, isDestroyed: () => false,
      getContentBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      on(name: string, callback: () => void) { windowListeners.set(name, callback); },
      removeListener(name: string, callback: () => void) { if (windowListeners.get(name) === callback) windowListeners.delete(name); },
    } as never,
    onState() {}, getProfile: async () => { await onProfileRead?.(); return structuredClone(profile); }, fillRetryLimit, onRetry: event => retries.push(event),
  });
  controller.setVisible(true);
  return { raw, controller, events, inserted, insertedY, retries, zoomModes, zoomChanges, observationZooms, isolatedCalls, zoomFactor: () => zoomFactor,
    wheel: (callback: () => void) => { onWheel = callback; },
    observe: (callback: () => void) => { onRead = callback; },
    profileRead: (callback: () => void | Promise<void>) => { onProfileRead = callback; },
    careerRead: (callback: () => unknown) => { onCareerRead = callback; },
    reveal: (callback: () => unknown | Promise<unknown>) => { onReveal = callback; },
    setProfile: (value: Profile) => { profile = structuredClone(value); },
    loseFocus: () => { focused = false; windowListeners.get('blur')?.(); }, restoreFocus: () => { focused = true; viewFocused = true; },
    block: () => { blocked = true; }, move: (callback: () => void) => { onMove = callback; }, click: (callback: () => void) => { onClick = callback; },
    changePointerSurface: () => { pointerIdentity += '-changed'; }, focusCalls: () => focusCalls,
    cover: (predicate: (centerY: number) => boolean) => { covered = predicate; },
    delayViewFocus: (refuse = false, milliseconds = 75) => { viewFocusDelay = milliseconds; viewFocused = false; refuseViewFocus = refuse; },
    delayTargetFocus: (milliseconds = 125) => { targetFocusDelay = milliseconds; },
    targetRead: (callback: (script: string) => unknown) => { onTargetRead = callback; },
    pointerRead: (callback: (script: string) => unknown) => { onPointerRead = callback; },
    insert: (callback: () => void) => { onInsert = callback; },
    error: (message: string) => module.exports.makeFixtureError(message),
    changeProfile: () => { profile = { ...profile, version: profile.version + 1 }; },
    reload: () => listeners.get('did-start-navigation')?.({}, raw.url, false, true),
  };
}

test('browser zoom is isolated, accepts only the three percentages and invalidates old coordinate authorization', async () => {
  const f = await fixture(200);
  assert.deepEqual(f.zoomModes, ['isolated']); assert.deepEqual(f.zoomChanges, [1]);
  const plan = await f.controller.preparePlan();
  assert.equal(f.controller.setZoom(100).zoomPercent, 100);
  assert.equal(f.controller.getPlan(plan.id).id, plan.id, 'an unchanged factor does not replace current authorization');
  for (const invalid of [0.8, 0.9, 0, 70, 110, '80', NaN, undefined]) {
    assert.throws(() => f.controller.setZoom(invalid as 80), /80|90|100/u);
    assert.equal(f.zoomFactor(), 1); assert.equal(f.controller.getPlan(plan.id).id, plan.id);
  }
  assert.equal(f.controller.setZoom(90).zoomPercent, 90); assert.equal(f.zoomFactor(), 0.9);
  assert.throws(() => f.controller.getPlan(plan.id), /失效/u);
  await assert.rejects(f.controller.fillApproved(plan.id, ['field-0']), /缩放已变化/u);
  assert.equal(f.controller.setZoom(80).zoomPercent, 80); assert.equal(f.zoomFactor(), 0.8);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
});

test('prepare restores one hundred percent before both fresh production observations and never reuses the old plan', async () => {
  const f = await fixture(200), old = await f.controller.preparePlan();
  f.controller.setZoom(80); f.observationZooms.length = 0;
  let freshObservationId: string | undefined;
  f.observe(() => { assert.equal(f.zoomFactor(), 1); f.raw.fields[0]!.bounds.y = 180; });
  const fresh = await f.controller.preparePlan(async (observation, profile) => {
    freshObservationId = observation.id; assert.equal(observation.fields[0]!.bounds.y, 180);
    assert.equal(f.controller.getState().zoomPercent, 100); return buildFillPlan(observation, profile);
  });
  assert.deepEqual(f.observationZooms, [1, 1]); assert.equal(f.zoomFactor(), 1);
  assert.equal(fresh.observationId, freshObservationId); assert.notEqual(fresh.id, old.id);
  assert.throws(() => f.controller.getPlan(old.id), /失效/u);
  assert.equal(f.controller.getPlan(fresh.id).id, fresh.id);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
});

test('recognition and filling locks reject zoom and field location through the real controller methods', async () => {
  const f = await fixture(200);
  const preparing = f.controller.preparePlan();
  assert.throws(() => f.controller.setZoom(90), /等待当前浏览器操作/u);
  const duringRead = await f.controller.locateApplicationField({ kind: 'ordinary', planId: 'untrusted', fieldId: 'field-0' });
  assert.equal(duringRead.status, 'blocked');
  const plan = await preparing;
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0); assert.equal(f.zoomFactor(), 1);
  const filling = f.controller.fillApproved(plan.id, ['field-0']);
  assert.throws(() => f.controller.setZoom(80), /等待当前浏览器操作/u);
  const duringFill = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
  assert.equal(duringFill.status, 'blocked');
  const result = await filling;
  assert.equal(result.verified.length, 1); assert.equal(f.zoomFactor(), 1);
  assert.equal(f.controller.setZoom(90).zoomPercent, 90, 'the completed fill releases its operation lock');
});

test('locating an already visible observed field only rereads and never focuses, clicks, types or creates authorization', async () => {
  const f = await fixture(200), plan = await f.controller.preparePlan();
  const before = JSON.stringify(f.raw), started = Date.now();
  const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
  assert.equal(result.status, 'located'); assert.match(result.message, /没有改写内容/u);
  assert(Date.now() - started >= 130, 'a visible target still needs a stable interval before a final hit check');
  assert.equal(JSON.stringify(f.raw), before); assert.equal(f.focusCalls(), 0);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  assert.equal(f.controller.getPlan(plan.id).id, plan.id);
  const unknown = await f.controller.locateApplicationField({ kind: 'ordinary', planId: 'unknown', fieldId: 'field-0' });
  assert.equal(unknown.status, 'stale'); assert.throws(() => f.controller.getPlan('unknown'), /失效/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
});

test('location rejects stale profile, navigation or structure and blocked foreground without sending input', async () => {
  for (const mutation of ['profile', 'navigation', 'structure', 'hidden', 'blur'] as const) {
    const f = await fixture(200), plan = await f.controller.preparePlan();
    if (mutation === 'profile') f.changeProfile();
    else if (mutation === 'navigation') f.reload();
    else if (mutation === 'structure') f.raw.fields[0]!.identity += '-replacement';
    else if (mutation === 'hidden') f.controller.setVisible(false);
    else f.loseFocus();
    const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
    assert.equal(result.status, mutation === 'hidden' || mutation === 'blur' ? 'blocked' : 'stale', mutation);
    assert.equal(f.events.length, 0, mutation); assert.equal(f.inserted.length, 0, mutation); assert.equal(f.focusCalls(), 0, mutation);
  }
});

function persistedIssue(item: FillPlan['items'][number], patch: Partial<ApplicationWorkflowIssue> = {}): ApplicationWorkflowIssue {
  return { id: 'fictional-durable-issue', section: 'contact', status: 'open', scope: 'field', required: item.required ?? null,
    reasonCode: 'needs-review', reason: '固定诊断', label: item.label, fieldId: item.fieldId, fieldSignature: item.fieldSignature,
    fieldType: item.type, profileField: item.profileKey, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
    lastCheckedProfileVersion: 1, readbackVerified: false, ...patch };
}
test('readAttention revokes old plans and preserves exact ordinary metadata without creating filling authority', async () => {
  const f = await fixture(200), old = await f.controller.preparePlan();
  f.raw.fields[0]!.required = false; const before = JSON.stringify(f.raw);
  const observed = await f.controller.readAttention();
  assert.equal(observed.url, f.raw.url); assert.equal(observed.profileVersion, 1); assert.equal(observed.career, undefined);
  assert.equal(observed.ordinary.items[0]!.fieldId, 'field-0'); assert.equal(observed.ordinary.items[0]!.required, false);
  assert.equal(observed.ordinary.items[0]!.type, 'text'); assert.match(observed.ordinary.items[0]!.fieldSignature!, /^[a-f0-9]{64}$/u);
  assert.equal(f.zoomFactor(), 1); assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  assert.equal(JSON.stringify(f.raw), before);
  assert.throws(() => f.controller.getPlan(old.id), /失效/u);
  assert.throws(() => f.controller.getPlan(observed.ordinary.id), /失效/u);
  await assert.rejects(f.controller.fillApproved(old.id, ['field-0']), /过期/u);
  await assert.rejects(f.controller.fillApproved(observed.ordinary.id, ['field-0']), /过期/u);
  f.controller.setZoom(90); await f.controller.readAttention(); assert.equal(f.zoomFactor(), 1, 'a fresh read restores the native coordinate scale');
});

test('readAttention holds the controller operation lock throughout asynchronous page observation', async () => {
  const f = await fixture(200); let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
  let reads = 0; f.observe(async () => { if (++reads === 1) { entered(); await barrier; } });
  const pending = f.controller.readAttention(); await reading;
  assert.throws(() => f.controller.setZoom(90), /等待当前浏览器操作/u);
  await assert.rejects(f.controller.readAttention(), /等待当前操作/u);
  await assert.rejects(f.controller.preparePlan(), /已有字段识别/u);
  assert.equal((await f.controller.locateWorkflowIssue(persistedIssue({ fieldId: 'field-0', label: '姓名', currentValue: '', value: '', status: 'review', reason: '' }), f.raw.url, 1)).status, 'blocked');
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  release(); await pending; assert.equal(f.controller.setZoom(90).zoomPercent, 90);
});

test('readAttention rejects changed original values, field identity, generation and profile version without installing a plan', async () => {
  for (const mutation of ['value', 'structure', 'navigation', 'profile'] as const) {
    const f = await fixture(200), old = await f.controller.preparePlan(); let reads = 0;
    f.observe(() => { if (++reads !== 2) return; if (mutation === 'value') f.raw.fields[0]!.value = '用户刚修改的虚构内容';
      else if (mutation === 'structure') f.raw.fields[0]!.identity += '-replacement'; else if (mutation === 'navigation') f.reload(); else f.changeProfile(); });
    await assert.rejects(f.controller.readAttention(), /变化|跳转/u, mutation);
    assert.throws(() => f.controller.getPlan(old.id), /失效/u, mutation);
    assert.equal(f.events.length, 0, mutation); assert.equal(f.inserted.length, 0, mutation); assert.equal(f.focusCalls(), 0, mutation);
  }
});

test('readAttention preserves real career field projection and revokes old career plans without invoking the driver input path', async () => {
  const f = await fixture(200), profile = createCareerFormFixtureProfile(); f.setProfile(profile);
  f.raw.url = 'https://modelbest.jobs.feishu.cn/campus/resume/fictional-only/apply';
  const record = profile.career!.internships[0]!, bounds = { x: 100, y: 200, width: 220, height: 40 };
  const page = { url: f.raw.url, supported: true, reason: '', protectedControls: [], addControls: [], groups: [{
    id: 'internship[0]', kind: 'internship', key: '0', identity: 'fictional-internship-group', fields: [
      { fieldId: 'internship[0].company', path: 'internship[0].company', kind: 'internship', key: '0', property: 'company', type: 'text', value: record.organization, identity: 'fictional-company', editable: true, required: true, bounds },
      { fieldId: 'internship[0].title', path: 'internship[0].title', kind: 'internship', key: '0', property: 'title', type: 'text', value: '', identity: 'fictional-role', editable: true, required: false, bounds },
    ],
  }] };
  f.careerRead(() => page);
  const old = await f.controller.prepareCareerFill({ profileVersion: profile.version, selectedRecordIds: { educations: [], internships: [record.id], projects: [] } });
  const observed = await f.controller.readAttention(), current = observed.career!;
  assert(current); assert.equal(current.groups[0]!.id, 'internship[0]'); assert.match(current.groups[0]!.signature, /^[a-f0-9]{64}$/u);
  assert.equal(current.groups[0]!.fields[1]!.required, false); assert.equal(current.groups[0]!.fields[1]!.type, 'text');
  assert.match(current.groups[0]!.fields[1]!.signature!, /^[a-f0-9]{64}$/u); assert.equal(current.steps[0]!.items![1]!.required, false);
  await assert.rejects(f.controller.runCareerFill(old.planId), /失效/u);
  await assert.rejects(f.controller.runCareerFill(current.planId), /失效/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0); assert.equal(f.focusCalls(), 0);
});

for (const withKnownInternship of [false, true]) test(withKnownInternship
  ? 'readonly attention preserves an unbound blank education while retaining an independently identified internship'
  : 'readonly attention never assigns either confirmed education record to a sole blank webpage group', async () => {
  const f = await fixture(200), profile = createCareerFormFixtureProfile(); f.setProfile(profile);
  assert.equal(profile.career!.educations.length, 2);
  assert(profile.career!.educations.every(record => record.confirmation === 'confirmed' && record.confirmedRevision === record.revision));
  f.raw.url = 'https://modelbest.jobs.feishu.cn/campus/resume/fictional-only/apply';
  const bounds = { x: 100, y: 200, width: 220, height: 40 };
  const groups = [{ id: 'education[0]', kind: 'education', key: '0', identity: 'fictional-empty-education', fields: [
    { fieldId: 'education[0].school', path: 'education[0].school', kind: 'education', key: '0', property: 'school', type: 'text', value: '', identity: 'fictional-empty-school', editable: true, required: true, bounds },
    { fieldId: 'education[0].degree', path: 'education[0].degree', kind: 'education', key: '0', property: 'degree', type: 'feishu-single-select', value: '', identity: 'fictional-empty-degree', editable: true, required: true, bounds },
  ] }];
  const internship = profile.career!.internships[0]!;
  if (withKnownInternship) groups.push({ id: 'internship[0]', kind: 'internship', key: '0', identity: 'fictional-known-internship', fields: [
    { fieldId: 'internship[0].company', path: 'internship[0].company', kind: 'internship', key: '0', property: 'company', type: 'text', value: internship.organization, identity: 'fictional-known-company', editable: true, required: true, bounds },
    { fieldId: 'internship[0].title', path: 'internship[0].title', kind: 'internship', key: '0', property: 'title', type: 'text', value: '', identity: 'fictional-known-role', editable: true, required: true, bounds },
  ] });
  const page = { url: f.raw.url, supported: true, reason: '', protectedControls: [], addControls: [], groups };
  f.careerRead(() => page); const before = JSON.stringify(page);
  const observed = await f.controller.readAttention(), preview = observed.career!;
  assert(preview); assert.deepEqual([...preview.preserveGroupIds], ['education[0]']);
  assert.equal(preview.bindings.filter(binding => binding.collection === 'educations').length, 0);
  assert.equal(preview.steps.filter(step => step.collection === 'educations').length, 0);
  assert(preview.issues.some(issue => issue.collection === 'educations' && !issue.recordId), 'the unknown blank section is a notice, not a missing fact assigned to a particular resume record');
  assert(preview.steps.every(step => step.kind === 'fill-group'), 'a read-only refresh never plans new webpage groups');
  if (withKnownInternship) {
    assert.equal(preview.bindings.length, 1); assert.equal(preview.bindings[0]!.recordId, internship.id); assert.equal(preview.bindings[0]!.groupId, 'internship[0]');
    assert.equal(preview.steps.length, 1); assert.equal(preview.steps[0]!.collection, 'internships'); assert.equal(preview.steps[0]!.recordId, internship.id);
    assert.equal(preview.steps[0]!.groupId, 'internship[0]'); assert(preview.steps[0]!.items!.some(item => item.fieldId === 'internship[0].title' && item.status === 'ready'));
  } else { assert.equal(preview.bindings.length, 0); assert.equal(preview.steps.length, 0); }
  assert.equal(JSON.stringify(page), before); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0); assert.equal(f.focusCalls(), 0);
});

test('persisted exact field location rereads the visible frame without focusing or writing and grants only a read-only token', async () => {
  const f = await fixture(200), observed = await f.controller.readAttention();
  const issue = persistedIssue(observed.ordinary.items[0]!); let token: ApplicationFieldLocationInput | undefined;
  const locate = f.controller.locateApplicationField.bind(f.controller);
  f.controller.locateApplicationField = async (input, initialValues) => { token = structuredClone(input); return locate(input, initialValues); };
  const before = JSON.stringify(f.raw), result = await f.controller.locateWorkflowIssue(issue, f.raw.url, 1);
  assert.equal(result.status, 'located'); assert.match(result.message, /没有改写内容/u); assert(token);
  const readonlyToken = token;
  assert.equal(JSON.stringify(f.raw), before); assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  assert.throws(() => f.controller.getPlan(readonlyToken.planId), /失效/u);
  await assert.rejects(f.controller.fillApproved(readonlyToken.planId, ['field-0']), /过期/u);
  assert.equal(f.inserted.length, 0);
});

test('persisted location rejects stale signatures, ambiguous legacy labels and mismatched page or profile without input', async () => {
  for (const mutation of ['signature', 'ambiguous', 'profile', 'url', 'structure'] as const) {
    const f = await fixture(200), observed = await f.controller.readAttention(); let issue = persistedIssue(observed.ordinary.items[0]!);
    if (mutation === 'signature') issue.fieldSignature = '0'.repeat(64);
    if (mutation === 'ambiguous') { issue = { ...issue, fieldId: undefined, fieldSignature: undefined }; f.raw.fields.push({ ...structuredClone(f.raw.fields[0]!), index: 1 }); }
    if (mutation === 'profile') f.changeProfile();
    if (mutation === 'structure') f.raw.fields[0]!.identity += '-replacement';
    const result = await f.controller.locateWorkflowIssue(issue, mutation === 'url' ? `${f.raw.url}?different=1` : f.raw.url, 1);
    assert.equal(result.status, mutation === 'ambiguous' ? 'ambiguous' : 'stale', mutation);
    assert.equal(f.events.length, 0, mutation); assert.equal(f.inserted.length, 0, mutation); assert.equal(f.focusCalls(), 0, mutation);
  }
});

test('persisted location rechecks profile and navigation after asynchronous target identification', async () => {
  for (const mutation of ['profile', 'navigation'] as const) {
    const f = await fixture(200), observed = await f.controller.readAttention(), issue = persistedIssue(observed.ordinary.items[0]!);
    let reads = 0; f.profileRead(() => { if (++reads === 2) { if (mutation === 'profile') f.changeProfile(); else f.reload(); } });
    const result = await f.controller.locateWorkflowIssue(issue, f.raw.url, 1);
    assert.equal(result.status, 'stale', mutation); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0); assert.equal(f.focusCalls(), 0);
  }
});

test('persisted career location rejects a record identity value changed between semantic matching and the locator first read', async () => {
  const f = await fixture(200), profile = createCareerFormFixtureProfile(); f.setProfile(profile);
  f.raw.url = 'https://modelbest.jobs.feishu.cn/campus/resume/fictional-only/apply';
  f.controller.resize({ x: 0, y: 0, width: 900, height: 700 });
  const record = profile.career!.internships[0]!, replacement = profile.career!.internships[1]!;
  const bounds = { x: 100, y: 200, width: 220, height: 40 };
  const page = { url: f.raw.url, supported: true, reason: '', protectedControls: [], addControls: [], groups: [{
    id: 'internship[0]', kind: 'internship', key: '0', identity: 'fictional-stable-group', fields: [
      { fieldId: 'internship[0].company', path: 'internship[0].company', kind: 'internship', key: '0', property: 'company', type: 'text', value: record.organization, identity: 'fictional-stable-company', editable: true, required: true, bounds },
      { fieldId: 'internship[0].title', path: 'internship[0].title', kind: 'internship', key: '0', property: 'title', type: 'text', value: '', identity: 'fictional-stable-role', editable: true, required: true, bounds },
    ],
  }] };
  const observedCompanies: string[] = []; let changed = false;
  f.careerRead(() => { observedCompanies.push(page.groups[0]!.fields[0]!.value); return page; });
  f.targetRead(() => ({ url: f.raw.url, exists: true, field: structuredClone(page.groups[0]!.fields[1]!), uncovered: true, valid: true }));
  f.profileRead(() => {
    // This is the await after workflowCareerTarget has uniquely identified the
    // first record, before locateApplicationField establishes its first frame.
    if (!changed && observedCompanies.length === 1) { changed = true; page.groups[0]!.fields[0]!.value = replacement.organization; }
  });
  const issue = persistedIssue({ fieldId: 'legacy-unused', label: '实习职位', value: '', currentValue: '', status: 'review', reason: '' },
    { collection: 'internships', section: 'internships', recordId: record.id, profileField: 'role', fieldId: undefined, fieldSignature: undefined });
  const result = await f.controller.locateWorkflowIssue(issue, f.raw.url, profile.version);
  assert(changed); assert.equal(observedCompanies[0], record.organization);
  assert(observedCompanies.includes(replacement.organization), 'the locator must independently reread after the semantic-matching await');
  assert.equal(result.status, 'stale'); assert.equal(page.groups[0]!.fields[1]!.value, '');
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0); assert.equal(f.focusCalls(), 0); assert.equal(f.isolatedCalls.length, 0);
});

test('isolated viewport reveal locates a distant field through the fixed world without native focus or input', async () => {
  const f = await fixture(1100, 0, true), plan = await f.controller.preparePlan();
  const values = f.raw.fields.map(field => field.value);
  const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
  assert.equal(result.status, 'located'); assert.match(result.message, /没有修改网页内容/u);
  assert.equal(f.raw.fields[0]!.bounds.y, 200); assert.equal(f.isolatedCalls.length, 1);
  assert.equal(f.isolatedCalls[0]!.worldId, 9468); assert.equal(f.isolatedCalls[0]!.userGesture, false);
  assert.deepEqual(f.raw.fields.map(field => field.value), values); assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  assert.equal(f.controller.getPlan(plan.id).id, plan.id, 'read-only revealing does not consume or regenerate a write plan');
});

test('explicit isolated location centers an already visible target instead of returning before scrolling', async () => {
  const f = await fixture(120, 0, true), plan = await f.controller.preparePlan();
  const started = Date.now(), result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
  assert.equal(result.status, 'located'); assert.equal(f.isolatedCalls.length, 1);
  assert.match(f.isolatedCalls[0]!.code, /scrollIntoView\.call\(target,\{behavior:'instant',block:'center',inline:'nearest'\}\)/u);
  assert.equal(f.raw.fields[0]!.bounds.y, 200, 'the controlled DOM transport actually receives the centering request');
  assert(Date.now() - started >= 130); assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
});

test('visible compatibility location refuses a changed final hit after the stable interval without input', async () => {
  const f = await fixture(200), plan = await f.controller.preparePlan(); let hits = 0;
  f.targetRead(() => ({ exists: true, focused: false, uncovered: ++hits === 1, value: f.raw.fields[0]!.value, url: f.raw.url, valid: true }));
  const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
  assert.equal(result.status, 'blocked'); assert(hits >= 2, 'the old initial hit cannot stand in for a final independent hit check');
  assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
});

test('both scroll paths refuse to report located when the final read or hit shifts target geometry', async () => {
  for (const isolated of [false, true]) {
    const f = await fixture(1100, 0, isolated), plan = await f.controller.preparePlan();
    let hitAfterScroll = false, shifted = false;
    if (!isolated) f.pointerRead(() => ({ exists: true, url: f.raw.url, pointerIdentity: 'fictional-readonly-scroll-surface', x: 850, y: 350 }));
    f.targetRead(() => {
      const y = f.raw.fields[0]!.bounds.y;
      if (y >= 8 && y + 40 <= 692 && (isolated || f.events.some(event => event.type === 'mouseWheel'))) hitAfterScroll = true;
      return { exists: true, focused: false, uncovered: true, value: f.raw.fields[0]!.value, url: f.raw.url, valid: true };
    });
    f.observe(() => { if (hitAfterScroll && !shifted) { shifted = true; f.raw.fields[0]!.bounds.y += 80; } });
    const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
    assert(shifted, `the ${isolated ? 'isolated' : 'native'} path reached its last verification read`);
    assert.equal(result.status, 'blocked'); assert.equal(f.inserted.length, 0); assert.equal(f.raw.fields[0]!.value, '');
    assert.equal(f.events.some(event => ['mouseDown', 'mouseUp', 'keyDown', 'char', 'keyUp'].includes(event.type)), false);
    if (isolated) { assert.equal(f.events.length, 0); assert.equal(f.focusCalls(), 0); }
    else assert(f.events.some(event => event.type === 'mouseWheel'), 'the compatibility branch still uses its bounded native scroll');
  }
});

test('isolated reveal changed or blocked responses never fall back to native scroll, focus or clicks', async () => {
  for (const reason of ['changed', 'missing', 'blocked']) {
    const f = await fixture(1100, 0, true), plan = await f.controller.preparePlan();
    f.reveal(() => ({ url: f.raw.url, exists: reason === 'blocked', scrolled: false, reason }));
    const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
    assert.equal(result.status, reason === 'blocked' ? 'blocked' : 'stale', reason); assert.equal(f.isolatedCalls.length, 1);
    assert.equal(f.raw.fields[0]!.bounds.y, 1100); assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  }
});

test('isolated reveal rechecks later field values, layout and sticky blur before reporting a location', async () => {
  for (const mutation of ['value', 'layout', 'blur', 'profile'] as const) {
    const f = await fixture(1100, 0, true), plan = await f.controller.preparePlan();
    f.reveal(() => {
      f.raw.fields[0]!.bounds.y = 200;
      setTimeout(() => {
        if (mutation === 'value') f.raw.fields[0]!.value = '用户修改的虚构内容';
        else if (mutation === 'layout') f.raw.fields[0]!.bounds.width += 40;
        else if (mutation === 'profile') f.changeProfile();
        else { f.loseFocus(); f.restoreFocus(); }
      }, 20);
      return { url: f.raw.url, exists: true, scrolled: true, reason: 'requested' };
    });
    const result = await f.controller.locateApplicationField({ kind: 'ordinary', planId: plan.id, fieldId: 'field-0' });
    assert.equal(result.status, mutation === 'value' || mutation === 'profile' ? 'stale' : 'blocked', mutation);
    assert.equal(f.isolatedCalls.length, 1, mutation); assert.equal(f.focusCalls(), 0, mutation); assert.equal(f.events.length, 0, mutation); assert.equal(f.inserted.length, 0, mutation);
  }
});

/** Original XML-backed DOM plus the browser's form named-property behavior.
 * This is not a Chromium/enterprise sample. Ordinary DOM properties stay
 * nonenumerable; the attached React-style expando is deliberately cyclic. */
function pointerDom() {
  const xml = new DOMParser().parseFromString('<html><body><form id="application-form"><div id="scroll-surface"><input id="id" name="id" value="PRIVATE_INPUT_VALUE" /></div></form></body></html>', 'application/xhtml+xml');
  interface Node {
    tagName: string; id: string | Node; parentElement: Node | null; children: Node[];
    getAttribute(name: string): string | null; setAttribute(name: string, value: string): void;
  }
  const nodes: Node[] = [];
  const buildNode = (node: XmlElement, parentElement: Node | null): Node => {
    const element = {} as Node; const children: Node[] = [];
    Object.defineProperties(element, {
      tagName: { get: () => node.tagName.toUpperCase() }, parentElement: { value: parentElement }, children: { value: children },
      getAttribute: { value: (name: string) => node.getAttribute(name) },
      setAttribute: { value: (name: string, value: string) => node.setAttribute(name, value) },
      id: { get: () => node.tagName === 'form' ? nodes.find(candidate => candidate.tagName === 'INPUT' && candidate.getAttribute('name') === 'id')! : node.getAttribute('id') || '' },
      value: { get: () => { throw new Error('pointer identities must never read a field value'); } },
    });
    nodes.push(element);
    for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) children.push(buildNode(child as XmlElement, element));
    return element;
  };
  buildNode(xml.documentElement!, null);
  const input = nodes.find(node => node.tagName === 'INPUT')!;
  const form = nodes.find(node => node.tagName === 'FORM')!;
  const surface = nodes.find(node => node.tagName === 'DIV')!;
  Object.defineProperty(input, '__reactInternalInstance', { value: { stateNode: input }, enumerable: true });
  return { form, input, surface, snapshot: () => new XMLSerializer().serializeToString(xml),
    read: (script: string) => runInNewContext(script, { document: { elementFromPoint: () => surface }, location: { href: 'https://fixture.example.invalid/apply' } }) as { exists: boolean; pointerIdentity: string; url: string } };
}

test('DOM-backed pointer transport reads a form id attribute despite a cyclic named input overriding form.id', async () => {
  const dom = pointerDom(); assert.equal(dom.form.id, dom.input); const before = dom.snapshot();
  const f = await fixture(), plan = await f.controller.preparePlan(); let checkedOld = false;
  const identities: string[] = [];
  f.pointerRead(script => {
    if (!checkedOld) {
      const old = script.replace("const tagName = typeof node.tagName === 'string' ? node.tagName : '';\n        path.push([tagName, node.getAttribute('id') || '',", "path.push([node.tagName, node.id || '',");
      assert.notEqual(old, script, 'the historical template differs only in its tag/id read');
      assert.throws(() => dom.read(old), /circular/u, 'the old form.id serializes the React expando cycle'); checkedOld = true;
    }
    const observed = dom.read(script); identities.push(observed.pointerIdentity);
    assert.deepEqual(Object.keys(observed).sort(), ['exists', 'pointerIdentity', 'url']);
    const path = JSON.parse(observed.pointerIdentity) as unknown[][];
    assert.ok(path.every(entry => entry.length === 3 && typeof entry[0] === 'string' && typeof entry[1] === 'string' && typeof entry[2] === 'number'));
    assert.ok(path.some(entry => entry[0] === 'FORM' && entry[1] === 'application-form'));
    assert.doesNotMatch(observed.pointerIdentity, /PRIVATE|reactInternalInstance|stateNode/u);
    return observed;
  });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(result.unresolved.length, 0);
  assert.ok(checkedOld && identities.length >= 2); assert.equal(f.inserted.length, 1);
  assert.equal(dom.snapshot(), before, 'the production identity reader never modifies the DOM');
});

test('a real id attribute change in the DOM-backed pointer path still stops before wheel or value input', async () => {
  const dom = pointerDom(); const f = await fixture(), plan = await f.controller.preparePlan();
  f.pointerRead(script => dom.read(script)); f.move(() => dom.surface.setAttribute('id', 'changed-scroll-surface'));
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /命中的网页元素变化/u);
  assert.equal(f.inserted.length, 0); assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0);
  assert.equal(f.events.some(event => event.type === 'mouseDown'), false);
});

test('a rejected target read diagnoses only the enum and anonymous line, never retrying native input or leaking private errors', async () => {
  const f = await fixture(200), plan = await f.controller.preparePlan();
  const sources: string[] = [];
  f.targetRead(script => {
    sources.push(script);
    if (sources.length === 1) throw new Error('PRIVATE_ORIGINAL_EXECUTION_MESSAGE');
    assert.match(script, /offeragent-read-target-diagnostic/u);
    return runInNewContext(script, { document: { querySelectorAll() {
      const error = new TypeError('Illegal invocation PRIVATE_PAGE_MESSAGE');
      error.stack = 'TypeError: PRIVATE_STACK\n at page (https://PRIVATE_PATH.invalid/apply:77:5)\n at <anonymous>:42:9';
      throw error;
    } } });
  });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(sources.length, 2, 'one unchanged production read and exactly one diagnostic-only reread');
  assert.equal(sources[0], readTarget(0, 210, 220), 'the normal reader bytes are unchanged');
  assert.ok(sources[1]!.includes(sources[0]!), 'the diagnostic embeds that same reader verbatim');
  assert.equal(result.verified.length, 0);
  assert.match(result.unresolved[0]!.reason, /阶段：reveal-field；类型：TypeError；行号：42；代码：ILLEGAL_INVOCATION/u);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|77:5|STACK|PAGE_MESSAGE/u);
  assert.equal(f.inserted.length, 0); assert.equal(f.events.length, 0);
  assert.throws(() => f.controller.getPlan(plan.id), /失效/u);
});

test('a diagnostic reread cannot recover a failed authorization and raw Electron failures receive only a fixed fill stage', async () => {
  for (const mode of ['success', 'reject'] as const) {
    const f = await fixture(200), plan = await f.controller.preparePlan(); let reads = 0;
    f.targetRead(script => {
      reads++;
      if (reads === 1 || mode === 'reject') throw new Error('PRIVATE_DIAGNOSTIC_FAILURE');
      return runInNewContext(script, { document: { querySelectorAll: () => [], elementFromPoint: () => null },
        location: { href: 'https://PRIVATE_REREAD_URL.invalid/apply' } });
    });
    const result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(reads, 2); assert.equal(result.verified.length, 0);
    assert.match(result.unresolved[0]!.reason, mode === 'success' ? /类型：未复现；行号：未知/u : /类型：未知；行号：未知/u);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u);
    assert.equal(f.inserted.length, 0); assert.equal(f.events.length, 0);
  }
  const message = 'Script failed to execute, this normally means an error was thrown. Check the renderer console for the error.';
  for (const stage of ['read-field', 'insert-text'] as const) {
    const f = await fixture(200), plan = await f.controller.preparePlan();
    const fail = () => { throw f.error(message); };
    let reads = 0;
    if (stage === 'read-field') f.observe(() => { if (++reads === 2) fail(); }); else f.insert(fail);
    const result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(f.inserted.length, 0);
    assert.equal(result.unresolved[0]!.reason, `网页检查失败（${stage}）。`);
    assert.doesNotMatch(JSON.stringify(result), /Script failed|renderer console/u);
  }
});

test('approved offscreen fields are natively revealed and reread before the original fill path', async () => {
  for (const y of [1100, -650]) {
    const f = await fixture(y), plan = await f.controller.preparePlan();
    const result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 1); assert.equal(result.unresolved.length, 0);
    const wheels = f.events.filter(event => event.type === 'mouseWheel');
    assert.ok(wheels.length > 0 && wheels.length <= 8);
    assert.ok(wheels.every(event => event.hasPreciseScrollingDeltas && Math.abs(event.deltaY!) <= 400));
    assert.ok(wheels.every(event => y > 0 ? event.deltaY! < 0 : event.deltaY! > 0));
    assert.equal(f.inserted.join(''), '虚构候选人');
    assert.equal(f.events.some(event => event.type === 'mouseDown'), true);
    assert.throws(() => f.controller.getPlan(plan.id), /失效/u);
  }
});

test('wheel input with no target movement stops after one step without sending profile data', async () => {
  const f = await fixture(); f.block(); const plan = await f.controller.preparePlan();
  let reads = 0; f.observe(() => { reads++; });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.match(result.unresolved[0]!.reason, /没有使字段接近/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); assert.equal(f.inserted.length, 0);
  assert.ok(reads > 2 && reads <= 34, 'position and wheel waits have fixed sample budgets, with no repeated blocked wheel');
});

test('a delayed smooth wheel is allowed to begin and must settle before the first click or value', async () => {
  const f = await fixture(650); f.block(); f.cover(centerY => centerY > 500);
  const plan = await f.controller.preparePlan();
  const positions = [650, 650, 600, 500, 400, 330, 330, 330];
  let started = false, reads = 0;
  f.wheel(() => { started = true; });
  f.observe(() => { if (started) f.raw.fields[0]!.bounds.y = positions[Math.min(reads++, positions.length - 1)]!; });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(result.unresolved.length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1, 'no extra wheel is sent during the animation');
  assert.deepEqual(f.insertedY, [330], 'becoming uncovered mid-animation does not permit early typing');
  assert.ok(reads >= positions.length, 'delayed start and several moving frames are all observed');
});

test('a wheel whose target keeps moving stops within the settling deadline without a click or value', async () => {
  const f = await fixture(); f.block(); const plan = await f.controller.preparePlan();
  let started = false, reads = 0;
  f.wheel(() => { started = true; });
  f.observe(() => { if (started) { reads++; f.raw.fields[0]!.bounds.y = reads % 2 ? 1090 : 1100; } });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /仍未稳定/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); assert.equal(f.inserted.length, 0);
  assert.ok(reads > 2 && reads <= 22, 'continuous animation cannot extend the fixed deadline');
});

test('focus, page, profile and target changes during the settling wait stop before a click or value', async () => {
  const mutations = [
    (f: Awaited<ReturnType<typeof fixture>>) => f.loseFocus(),
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.url += '?changed-during-wait'; },
    (f: Awaited<ReturnType<typeof fixture>>) => f.changeProfile(),
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.fields[0]!.value = '已有用户内容'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.fields[0]!.bounds.width += 20; },
  ];
  for (const mutate of mutations) {
    const f = await fixture(); f.block(); const plan = await f.controller.preparePlan();
    let started = false, reads = 0;
    f.wheel(() => { started = true; });
    f.observe(() => { if (started && ++reads === 3) mutate(f); });
    const result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(result.unresolved.length, 1);
    assert.equal(reads, 3, 'a change in the wait is checked at the next sample');
    assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); assert.equal(f.inserted.length, 0);
  }
});

test('a distant field stops at eight native steps and keeps the one-use plan consumed', async () => {
  const f = await fixture(6000), plan = await f.controller.preparePlan();
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.match(result.unresolved[0]!.reason, /次数上限/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 8); assert.equal(f.inserted.length, 0);
  assert.throws(() => f.controller.getPlan(plan.id), /失效/u);
});

test('scrolling stops before any input when page, profile, value, structure, visibility or focus changes', async () => {
  const mutations = [
    (f: Awaited<ReturnType<typeof fixture>>) => f.changeProfile(),
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.url += '?changed'; },
    (f: Awaited<ReturnType<typeof fixture>>) => f.reload(),
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.fields[0]!.value = '已有用户内容'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.fields[0]!.identity = 'new-control'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.raw.fields[0]!.bounds.width += 20; },
    (f: Awaited<ReturnType<typeof fixture>>) => f.loseFocus(),
    (f: Awaited<ReturnType<typeof fixture>>) => f.controller.setVisible(false),
  ];
  for (const mutate of mutations) {
    const f = await fixture(), plan = await f.controller.preparePlan(); f.wheel(() => mutate(f));
    const result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(result.unresolved.length, 1);
    assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); assert.equal(f.inserted.length, 0);
  }
});

test('already visible controls do not receive unnecessary wheel events', async () => {
  const f = await fixture(200), plan = await f.controller.preparePlan();
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1);
  assert.equal(f.events.some(event => event.type === 'mouseWheel'), false);
});

test('an edge overlay is cleared with a precise native scroll toward the viewport middle before clicking', async () => {
  const f = await fixture(650); f.cover(centerY => centerY > 500);
  const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(result.unresolved.length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1);
  assert.equal(f.raw.fields[0]!.bounds.y + 20, 350);
  assert.equal(f.events[0]!.type, 'mouseMove', 'the native pointer is moved before the wheel');
});

test('a full-page overlay stays unresolved at the middle with no click or value sent', async () => {
  const f = await fixture(650); f.cover(() => true);
  const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /中间后仍被遮挡/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1);
  assert.equal(f.events.some(event => event.type === 'mouseDown'), false);
  assert.equal(f.inserted.length, 0);
});

test('the initial native focus handshake waits for delayed remote focus and never scrolls if it is refused', async () => {
  const f = await fixture(); f.delayViewFocus();
  const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(f.inserted.length, 1);
  assert.ok(f.events.some(event => event.type === 'mouseWheel'));
  const refused = await fixture(); refused.delayViewFocus(true);
  const refusedPlan = await refused.controller.preparePlan();
  const refusedResult = await refused.controller.fillApproved(refusedPlan.id, ['field-0']);
  assert.equal(refusedResult.verified.length, 0); assert.match(refusedResult.unresolved[0]!.reason, /焦点/u);
  assert.equal(refused.inserted.length, 0); assert.equal(refused.events.length, 0, 'a refused handshake sends neither pointer nor value input');
  assert.equal(refused.focusCalls(), 1, 'waiting never repeatedly requests focus');
});

test('a delayed target focus is polled after one native click without retrying pointer or keyboard input', async () => {
  const f = await fixture(200); f.delayTargetFocus(); const plan = await f.controller.preparePlan();
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.equal(f.inserted.length, 1);
  assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1);
  assert.equal(f.events.filter(event => event.type === 'mouseMove').length, 1);
});

test('an already visible field waits for native focus-scroll to settle before any pointer or value input', async () => {
  const f = await fixture(200), plan = await f.controller.preparePlan();
  const positions = [200, 260, 350, 340, 330, 330, 330, 330]; let reads = 0, firstFinalPositionAt: number | undefined;
  f.observe(() => {
    const at = Math.min(reads++, positions.length - 1);
    f.raw.fields[0]!.bounds.y = positions[at]!;
    if (f.raw.fields[0]!.bounds.y === 330) firstFinalPositionAt ??= Date.now();
    if (at < 5) assert.equal(f.events.length, 0, 'the native pointer stays still while the visible target is moving');
  });
  f.move(() => {
    assert.equal(f.raw.fields[0]!.bounds.y, 330, 'hover starts only at the final target position');
    assert.notEqual(firstFinalPositionAt, undefined, 'the final position was independently observed before moving the pointer');
    assert.ok(Date.now() - firstFinalPositionAt! >= 120, 'hover starts only after the final target position remained stable for at least 120 ms');
  });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 1); assert.deepEqual(f.insertedY, [330]);
  assert.equal(f.events.some(event => event.type === 'mouseWheel'), false, 'already visible focus-scroll needs no synthetic wheel');
  assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1);
});

test('blur, profile or horizontal-layout changes during pre-input settling stop with no pointer or value input', async () => {
  for (const mutation of ['blur', 'profile', 'layout'] as const) {
    const f = await fixture(200), plan = await f.controller.preparePlan(); let reads = 0;
    f.observe(() => {
      reads++;
      f.raw.fields[0]!.bounds.y += 10;
      if (reads === 6) {
        if (mutation === 'blur') { f.loseFocus(); f.restoreFocus(); }
        else if (mutation === 'profile') f.changeProfile();
        else f.raw.fields[0]!.bounds.x += 10;
      }
    });
    const result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
    assert.equal(reads, 6, 'the first changed observation interrupts settling');
  }
});

test('continuous pre-input focus-scroll cannot extend the fixed settling deadline', async () => {
  const f = await fixture(200), plan = await f.controller.preparePlan(); let reads = 0;
  f.observe(() => { reads++; f.raw.fields[0]!.bounds.y += 1; });
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /限定时间/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserted.length, 0);
  assert.ok(reads <= 37, 'startup observations plus at most 33 settling samples');
});

test('target focus that never arrives before the deadline remains unresolved without any value input', async () => {
  const f = await fixture(200); f.delayTargetFocus(900); const plan = await f.controller.preparePlan();
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /限定时间/u);
  assert.equal(f.inserted.length, 0); assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1);
});

test('hover that moves the target or changes the wheel surface stops before wheel or click input', async () => {
  for (const y of [200, 1100]) {
    const f = await fixture(y); f.move(() => { f.raw.fields[0]!.bounds.y += 20; });
    const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(f.inserted.length, 0);
    assert.equal(f.events.some(event => event.type === 'mouseDown' || event.type === 'mouseWheel'), false);
    if (y === 1100) assert.match(result.unresolved[0]!.reason, /待填字段位置或浏览器尺寸变化/u);
  }
  const f = await fixture(); f.move(() => f.changePointerSurface());
  const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.equal(f.events.some(event => event.type === 'mouseWheel'), false);
  assert.match(result.unresolved[0]!.reason, /滚动点命中的网页元素变化/u);
});

test('a window blur permanently interrupts this approval even if window focus returns before the next observation', async () => {
  for (const point of ['move', 'wheel', 'click'] as const) {
    const f = await fixture(point === 'wheel' ? 1100 : 200);
    const interrupt = () => { f.loseFocus(); f.restoreFocus(); };
    f[point](interrupt);
    const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /焦点/u);
    assert.equal(f.inserted.length, 0); assert.equal(f.focusCalls(), 1);
    assert.throws(() => f.controller.getPlan(plan.id), /失效/u);
  }
});

test('a blur followed by automatic focus recovery also stops every later field in the consumed approval', async () => {
  const f = await fixture(200);
  f.raw.fields.push({ ...structuredClone(f.raw.fields[0]!), index: 1, identity: 'second-name|name|||', bounds: { x: 100, y: 300, width: 220, height: 40 } });
  f.click(() => { f.loseFocus(); f.restoreFocus(); });
  const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0', 'field-1']);
  assert.equal(result.verified.length, 0); assert.equal(result.unresolved.length, 2);
  assert.ok(result.unresolved.every(item => /焦点/u.test(item.reason)));
  assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1);
  assert.equal(f.inserted.length, 0); assert.equal(f.focusCalls(), 1);
});

test('a moving target or changed profile during the post-click handshake never receives value input', async () => {
  for (const mutation of ['motion', 'profile'] as const) {
    const f = await fixture(200); let clicked = false, reads = 0;
    f.click(() => { clicked = true; });
    f.observe(() => {
      if (!clicked) return;
      reads++;
      if (mutation === 'motion') f.raw.fields[0]!.bounds.y += 1;
      else if (reads === 2) f.changeProfile();
    });
    const plan = await f.controller.preparePlan(), result = await f.controller.fillApproved(plan.id, ['field-0']);
    assert.equal(result.verified.length, 0); assert.equal(f.inserted.length, 0);
    assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1);
    assert.match(result.unresolved[0]!.reason, mutation === 'motion' ? /限定时间/u : /资料/u);
    assert.ok(reads <= 25, 'the focus handshake has a fixed observation budget');
  }
});

test('an unresponsive read after the native click cannot extend the focus-handshake deadline', async () => {
  const f = await fixture(200); let clicked = false;
  f.click(() => { clicked = true; });
  f.observe(() => clicked ? new Promise<void>(() => {}) : undefined);
  const plan = await f.controller.preparePlan(), started = Date.now();
  const result = await f.controller.fillApproved(plan.id, ['field-0']);
  assert.equal(result.verified.length, 0); assert.match(result.unresolved[0]!.reason, /限定时间/u);
  assert.equal(f.inserted.length, 0); assert.ok(Date.now() - started < 1200);
  assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1);
});
