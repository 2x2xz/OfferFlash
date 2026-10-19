import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { READ_FORM } from '../packages/browser/src/read-scripts.js';
import type { BrowserController } from '../packages/browser/src/controller.js';
import type { BrowserBounds, Profile } from '../packages/shared/src/contracts.js';

const controllerCode = build({
  entryPoints: [resolve('packages/browser/src/controller.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'combobox-native-transport-fixture', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export class WebContentsView { constructor() { return globalThis.makeFixtureView(); } }', loader: 'js',
    }));
  } }],
}).then(result => result.outputFiles[0]!.text);

interface FixtureOption {
  index: number; id: string; label: string; disabled: boolean; selected: boolean;
  hidden?: boolean; bounds: BrowserBounds; identity: string;
}
interface FixtureField {
  index: number; label: string; type: string; value: string; editable: boolean; required: boolean;
  checked?: boolean;
  section: string; identity: string; bounds: BrowserBounds; options: Array<{ label: string; value: string }>;
  customSelect?: { kind: 'aria-single-select'; relationship: 'controls' | 'owns'; popupId: string;
    valueSource: 'input-value' | 'aria-valuetext' };
}
interface NativeEvent { type: string; x?: number; y?: number; keyCode?: string; deltaY?: number; }
function option(label: string, index = 1, changes: Partial<FixtureOption> = {}): FixtureOption {
  return { index, id: `degree-option-${index}`, label, disabled: false, selected: false,
    bounds: { x: 100, y: 300 + index * 40, width: 220, height: 36 }, identity: `degree-option-${index}|${label}|enabled`, ...changes };
}

/** Tests the production controller against a simulated native event transport.
 * Reader DOM semantics and real enterprise interaction need separate acceptance. */
async function fixture() {
  const raw = {
    url: 'https://fixture.example.invalid/application', title: '虚构自定义学历', viewport: { width: 900, height: 700 },
    fields: [
      { index: 0, label: '学历', type: 'combobox', value: '', editable: true, required: true, section: '',
        identity: 'degree-trigger|degree-options|controls|input-value', bounds: { x: 100, y: 200, width: 220, height: 40 }, options: [],
        customSelect: { kind: 'aria-single-select', relationship: 'controls', popupId: 'degree-options', valueSource: 'input-value' } },
      { index: 1, label: '邮箱', type: 'email', value: 'preserved@example.invalid', editable: true, required: true, section: '',
        identity: 'email|email', bounds: { x: 100, y: 80, width: 220, height: 40 }, options: [] },
    ] as FixtureField[],
  };
  let profile: Profile = {
    version: 4, updatedAt: '2026-10-18T00:00:00.000Z', fullName: '虚构候选人', fullNameEn: '',
    email: 'fixture@example.invalid', phone: '', school: '虚构大学', schoolEn: '', degree: '硕士',
    major: '计算机', majorEn: '', graduationMonth: '2027-06', skills: [], cities: [], targetRoles: [], resumeText: '',
  };
  const popup = { id: 'degree-options', multi: false, identity: 'degree-listbox|single|degree-trigger',
    options: [option('本科', 0), option('硕士', 1)] };
  let expanded = false, visible = false, windowFocused = true, viewFocused = true, targetFocused = false;
  let ownerExists = true, ownerDisabled = false, ownerIdentity = 'degree-trigger|degree-options|controls|input-value';
  let popupAvailable = true, covered = false, commitChoice = true, closeAfterChoice = true;
  let onOpen: (() => void) | undefined, onOptionHover: (() => void) | undefined, onChoose: (() => void) | undefined;
  let onPopupRead: (() => void) | undefined;
  const events: NativeEvent[] = [], inserted: string[] = [], choices: string[] = [];
  const contentsListeners = new Map<string, (...args: unknown[]) => void>();
  const windowListeners = new Map<string, () => void>();
  const masterOption = () => popup.options.find(item => !item.hidden && !item.disabled && /硕士|master/iu.test(item.label));
  const owner = () => ({ exists: ownerExists, expanded, popupId: raw.fields[0]!.customSelect?.popupId ?? '',
    value: raw.fields[0]!.value, disabled: ownerDisabled, identity: ownerIdentity, focused: targetFocused });
  let zoomFactor = 1;
  const contents = {
    id: 1, session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, on() {} },
    setZoomMode(mode: string) { assert.equal(mode, 'isolated'); },
    setZoomFactor(value: number) { zoomFactor = value; }, getZoomFactor: () => zoomFactor,
    setVisualZoomLevelLimits: async () => {}, setWindowOpenHandler() {},
    on(name: string, callback: (...args: unknown[]) => void) { contentsListeners.set(name, callback); },
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }, isDestroyed: () => false,
    getURL: () => raw.url, getTitle: () => raw.title,
    focus() { viewFocused = true; }, isFocused: () => windowFocused && viewFocused,
    async executeJavaScript(script: string) {
      assert.doesNotMatch(script, /scrollIntoView|\.scroll(?:Top|Left)\s*=|\.focus\(|\.value\s*=/u,
        'controller readers must not write DOM state or synthesize a page click');
      if (script === READ_FORM) return structuredClone(raw);
      if (script.includes('offeragent-read-combobox-popup')) {
        onPopupRead?.();
        return structuredClone({ url: raw.url, owner: owner(),
          popup: expanded && popupAvailable ? { ...popup, options: popup.options.filter(item => !item.hidden) } : null });
      }
      if (script.includes('offeragent-read-combobox-option-target')) {
        const item = masterOption();
        return structuredClone({ url: raw.url, exists: !!item && expanded && popupAvailable,
          uncovered: !!item && visible && !covered && expanded, focused: targetFocused,
          value: raw.fields[0]!.value, valid: true, selected: item?.selected ?? false,
          identity: item?.identity ?? '', ownerIdentity, popupIdentity: popup.identity,
          label: item?.label ?? '', id: item?.id ?? '', popupId: popup.id, expanded });
      }
      assert.match(script, /document\.elementFromPoint/u);
      if (script.includes('pointerIdentity')) return { exists: true, pointerIdentity: 'fixture-form-surface', url: raw.url };
      return { exists: ownerExists, focused: targetFocused, uncovered: visible && !covered,
        value: raw.fields[0]!.value, url: raw.url, valid: true };
    },
    sendInputEvent(event: NativeEvent) {
      events.push(event);
      const inOption = expanded && popup.options.some(item => !item.hidden && event.x !== undefined && event.y !== undefined
        && event.x >= item.bounds.x && event.x <= item.bounds.x + item.bounds.width
        && event.y >= item.bounds.y && event.y <= item.bounds.y + item.bounds.height);
      if (event.type === 'mouseMove' && inOption) onOptionHover?.();
      if (event.type === 'mouseUp') {
        targetFocused = true;
        if (!expanded) { expanded = true; onOpen?.(); }
        else if (inOption) {
          const item = popup.options.find(candidate => !candidate.hidden && event.y! >= candidate.bounds.y
            && event.y! <= candidate.bounds.y + candidate.bounds.height)!;
          choices.push(item.label);
          if (commitChoice) { raw.fields[0]!.value = item.label; item.selected = true; }
          if (closeAfterChoice) expanded = false;
          onChoose?.();
        }
      }
      if (event.type === 'mouseWheel') {
        raw.fields[0]!.bounds.y += event.deltaY ?? 0;
        for (const item of popup.options) item.bounds.y += event.deltaY ?? 0;
      }
    },
    async insertText(value: string) { inserted.push(value); },
  };
  const module = { exports: {} as { BrowserController: typeof BrowserController } };
  runInNewContext(await controllerCode, { module, exports: module.exports, require: createRequire(import.meta.url),
    structuredClone, URL, AbortController, DOMException, Buffer, setTimeout, clearTimeout,
    makeFixtureView: () => ({ webContents: contents, setVisible(value: boolean) { visible = value; }, setBounds() {} }),
  });
  const controller = new module.exports.BrowserController({
    window: { contentView: { addChildView() {} }, focus() { windowFocused = true; }, isFocused: () => windowFocused,
      on(name: string, callback: () => void) { windowListeners.set(name, callback); },
      removeListener(name: string, callback: () => void) { if (windowListeners.get(name) === callback) windowListeners.delete(name); },
    } as never,
    onState() {}, getProfile: async () => structuredClone(profile),
  });
  controller.setVisible(true);
  return { controller, raw, popup, events, choices, inserted,
    onOpen(callback: () => void) { onOpen = callback; }, onOptionHover(callback: () => void) { onOptionHover = callback; },
    onChoose(callback: () => void) { onChoose = callback; }, onPopupRead(callback: () => void) { onPopupRead = callback; },
    loseFocus() { windowFocused = false; windowListeners.get('blur')?.(); }, restoreFocus() { windowFocused = true; viewFocused = true; },
    changeProfile() { profile = { ...profile, version: profile.version + 1 }; },
    setDegree(value: string) { profile = { ...profile, degree: value }; },
    reload() { contentsListeners.get('did-start-navigation')?.({}, raw.url, false, true); },
    cover() { covered = true; }, keepOpen() { closeAfterChoice = false; }, doNotCommit() { commitChoice = false; },
    openInitially() { expanded = true; },
    removePopup() { popupAvailable = false; }, disableOwner() { ownerDisabled = true; },
    replaceOwner() {
      ownerIdentity += '-replacement';
      // READ_FORM includes the same owner identity in the field identity. A
      // replaced trigger cannot change only one of the two observation paths.
      raw.fields[0]!.identity = ownerIdentity;
    }, removeOwner() { ownerExists = false; },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function run(f: Fixture) {
  const plan = await f.controller.preparePlan();
  assert.equal(plan.items[0]!.status, 'ready', 'only an observed supported ARIA combobox can receive approval');
  return { plan, result: await f.controller.fillApproved(plan.id, ['field-0']) };
}
function assertNoArbitraryInput(f: Fixture) {
  assert.equal(f.inserted.length, 0, 'custom choices are not inserted as arbitrary text');
  assert.equal(f.events.some(event => event.type === 'char' || /Enter|Return/u.test(event.keyCode ?? '')), false);
}
function assertStopped(f: Fixture, result: { verified: unknown[]; unresolved: unknown[] }) {
  assert.equal(result.verified.length, 0); assert.equal(result.unresolved.length, 1); assertNoArbitraryInput(f);
}

test('an approved ARIA combobox opens and selects one real option through native clicks', async () => {
  const f = await fixture(), { plan, result } = await run(f);
  assert.equal(result.verified.length, 1); assert.equal(result.unresolved.length, 0);
  assert.deepEqual(f.choices, ['硕士']); assert.equal(f.raw.fields[0]!.value, '硕士');
  assert.equal(f.raw.fields[1]!.value, 'preserved@example.invalid');
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2);
  assertNoArbitraryInput(f); assert.throws(() => f.controller.getPlan(plan.id), /失效/u);
});

test('the committed real label can be an unambiguous degree synonym rather than the profile spelling', async () => {
  const f = await fixture(); f.popup.options[1]!.label = "Master's degree"; f.popup.options[1]!.identity = 'masters-option';
  const { result } = await run(f);
  assert.equal(result.verified.length, 1); assert.deepEqual(f.choices, ["Master's degree"]);
  assert.equal(f.raw.fields[0]!.value, "Master's degree"); assertNoArbitraryInput(f);
});

test('an already open approved menu is selected without toggling its trigger closed first', async () => {
  const f = await fixture(); f.openInitially();
  const { result } = await run(f);
  assert.equal(result.verified.length, 1); assert.deepEqual(f.choices, ['硕士']);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1, 'only the real option is clicked');
  assertNoArbitraryInput(f);
});

test('duplicate real matching options stop without choosing either occurrence', async () => {
  const f = await fixture(); f.popup.options.push(option('硕士', 2));
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a numeric profile spelling can never match an invented option index', async () => {
  const f = await fixture(); f.setDegree('2');
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a menu opening that toggles another checkbox invalidates the approved page before selection', async () => {
  const f = await fixture();
  Object.assign(f.raw.fields[1]!, { type: 'checkbox', label: '同意条款', value: 'on', checked: false });
  f.onOpen(() => { f.raw.fields[1]!.checked = true; });
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a temporary label that rolls back during the confirmation window is not verified', async () => {
  const f = await fixture(); f.keepOpen();
  let selectedReads = 0;
  f.onPopupRead(() => { if (f.choices.length && ++selectedReads === 2) f.raw.fields[0]!.value = ''; });
  const { result } = await run(f); assertStopped(f, result); assert.deepEqual(f.choices, ['硕士']);
});

test('disabled matching options cannot receive a native option click', async () => {
  const f = await fixture(); f.popup.options[1]!.disabled = true;
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a hidden choice absent from the observed popup cannot be invented by the controller', async () => {
  const f = await fixture(); f.popup.options[1]!.hidden = true;
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('no matching option stays unresolved rather than clicking the first visible degree', async () => {
  const f = await fixture(); f.popup.options[1]!.label = '博士';
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a multiselect listbox is rejected even when one label matches the profile', async () => {
  const f = await fixture(); f.popup.multi = true;
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('opening a dropdown that inserts a search input invalidates the old whole-page plan', async () => {
  const f = await fixture(); f.onOpen(() => { f.raw.fields.push({ index: 2, label: '搜索', type: 'search', value: '', editable: true,
    required: false, section: '', identity: 'new-dropdown-search', bounds: { x: 100, y: 260, width: 220, height: 30 }, options: [] }); });
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('another existing field changing while the dropdown opens stops before selection', async () => {
  const f = await fixture(); f.onOpen(() => { f.raw.fields[1]!.value = 'changed@example.invalid'; });
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('window blur remains an interruption even if focus returns before the next popup read', async () => {
  const f = await fixture(); f.onOpen(() => { f.loseFocus(); f.restoreFocus(); });
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('navigation URL, generation and profile changes after opening cannot authorize an option click', async () => {
  const changes: Array<(f: Fixture) => void> = [
    f => { f.raw.url += '?changed'; }, f => f.reload(), f => f.changeProfile(),
  ];
  for (const change of changes) {
    const f = await fixture(); f.onOpen(() => change(f));
    const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
  }
});

test('an obscured popup option is never clicked through an overlay', async () => {
  const f = await fixture(); f.onOpen(() => f.cover());
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a trigger covered during the final popup read receives no native click', async () => {
  const f = await fixture();
  f.onPopupRead(() => f.cover());
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 0,
    'stopping only after opening would already have clicked the covering element');
});

test('an option outside the visible popup bounds stays manual instead of receiving an offscreen click', async () => {
  const f = await fixture(); f.popup.options[1]!.bounds.y = 950;
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1, 'only the visible trigger is clicked');
});

test('moving the chosen option on hover stops the old coordinates before mouse down', async () => {
  const f = await fixture(); f.onOptionHover(() => { f.popup.options[1]!.bounds.x += 30; });
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseDown').length, 1, 'only the original trigger was clicked');
});

test('changing popup contents after hover prevents selection using a stale label or identity', async () => {
  const f = await fixture(); f.onOptionHover(() => { f.popup.options[1]!.label = '博士'; f.popup.options[1]!.identity = 'replaced-option'; });
  const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
});

test('a disappeared, disabled or replaced trigger cannot retain authorization after opening', async () => {
  for (const change of [(f: Fixture) => f.removeOwner(), (f: Fixture) => f.disableOwner(), (f: Fixture) => f.replaceOwner(), (f: Fixture) => f.removePopup()]) {
    const f = await fixture(); f.onOpen(() => change(f));
    const { result } = await run(f); assertStopped(f, result); assert.equal(f.choices.length, 0);
  }
});

test('an option click whose value was not committed is not reported as verified', async () => {
  const f = await fixture(); f.doNotCommit();
  const { result } = await run(f); assertStopped(f, result); assert.deepEqual(f.choices, ['硕士']);
  assert.equal(f.raw.fields[0]!.value, '');
});

test('active or highlighted options without a committed owner value remain unresolved', async () => {
  const f = await fixture(); f.doNotCommit(); f.keepOpen();
  f.onChoose(() => { f.popup.options[1]!.selected = true; });
  const { result } = await run(f); assertStopped(f, result); assert.deepEqual(f.choices, ['硕士']);
  assert.equal(f.raw.fields[0]!.value, '', 'aria-selected/highlight alone is not a committed field value');
});

test('an owner displaying a label without a confirmed selected open-menu option remains unresolved', async () => {
  const f = await fixture(); f.keepOpen(); f.onChoose(() => { f.popup.options[1]!.selected = false; });
  const { result } = await run(f); assertStopped(f, result); assert.deepEqual(f.choices, ['硕士']);
  assert.equal(f.raw.fields[0]!.value, '硕士', 'matching text alone cannot prove an open listbox selection');
});

test('blur, navigation and profile changes after the option click prevent a verified claim', async () => {
  for (const change of [(f: Fixture) => f.loseFocus(), (f: Fixture) => f.reload(), (f: Fixture) => f.changeProfile()]) {
    const f = await fixture(); f.onChoose(() => change(f));
    const { result } = await run(f); assertStopped(f, result); assert.deepEqual(f.choices, ['硕士']);
  }
});

test('a selection that changes another existing value cannot be counted as a clean verified operation', async () => {
  const f = await fixture(); f.onChoose(() => { f.raw.fields[1]!.value = 'unexpected@example.invalid'; });
  const { result } = await run(f); assertStopped(f, result); assert.deepEqual(f.choices, ['硕士']);
});

test('a single approved combobox cannot be reused to select a second value after a partial outcome', async () => {
  const f = await fixture(); f.doNotCommit(); const { plan, result } = await run(f);
  assertStopped(f, result); const previousClicks = f.events.filter(event => event.type === 'mouseUp').length;
  await assert.rejects(f.controller.fillApproved(plan.id, ['field-0']), /过期|失效/u);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, previousClicks);
});

test('an unresolved custom popup stops later approved fields instead of typing behind the menu', async () => {
  const f = await fixture(); f.popup.options[1]!.label = '博士'; f.raw.fields[1]!.value = '';
  const plan = await f.controller.preparePlan();
  assert.equal(plan.items.filter(item => item.status === 'ready').length, 2);
  const result = await f.controller.fillApproved(plan.id, ['field-0', 'field-1']);
  assert.equal(result.verified.length, 0); assert.equal(result.unresolved.length, 2);
  assert.equal(f.raw.fields[1]!.value, ''); assert.equal(f.choices.length, 0); assertNoArbitraryInput(f);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1, 'later email field is never clicked');
});
