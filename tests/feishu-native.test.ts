import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { FeishuCareerDriver, type FeishuCareerDriverOptions, type FeishuFieldActivity } from '../packages/browser/src/feishu-native.js';
import { buildCareerPlan, type CareerFillGroupStep, type CareerPlannedField } from '../packages/forms/src/career-plan.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';
import type { Profile } from '../packages/shared/src/contracts.js';

type Box = { x: number; y: number; width: number; height: number };
type Field = { fieldId: string; path: string; property: string; kind: 'education' | 'internship'; key: string; type: string; side?: 'start' | 'end'; value: string; identity: string; editable: boolean; bounds: Box; untilNow?: boolean; supportsUntilNow?: boolean };
interface NativeEvent { type: string; x?: number; y?: number; deltaY?: number; keyCode?: string; }

/** Simulated native transport only. DOM reader semantics and real enterprise acceptance are separate tests. */
function fixture(type: 'text' | 'degree' | 'month' | 'empty' = 'text') {
  const field: Field = { fieldId: type === 'month' ? 'education[1].period:start' : type === 'degree' ? 'education[1].degree' : 'education[1].school',
    path: type === 'month' ? 'education[1].period' : type === 'degree' ? 'education[1].degree' : 'education[1].school',
    property: type === 'month' ? 'period' : type === 'degree' ? 'degree' : 'school', kind: 'education', key: '1',
    type: type === 'month' ? 'feishu-month' : type === 'degree' ? 'feishu-single-select' : 'text',
    ...(type === 'month' ? { side: 'start' as const } : {}), value: '', identity: 'fixture-field-identity', editable: true,
    bounds: { x: 100, y: 180, width: 280, height: 40 } };
  const raw = { url: 'https://modelbest.jobs.feishu.cn/resume/fictional-test-only', supported: true, reason: '',
    groups: type === 'empty' ? [] : [{ id: 'education[1]', kind: field.kind, key: '1', identity: 'fixture-group', fields: [field] }],
    addControls: [{ id: 'education:add', kind: 'education' as const, identity: 'fixture-add', enabled: true, bounds: { x: 100, y: 100, width: 120, height: 36 } }],
    protectedControls: [{ identity: 'email', value: 'preserved@example.invalid', checked: false, disabled: false, readOnly: false, sensitive: false },
      { identity: 'consent', value: '', checked: false, disabled: false, readOnly: false, sensitive: false }],
  };
  const profile: Profile = { version: 3, updatedAt: '2026-10-18T00:00:00Z', fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '', degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '', career: {
    ...emptyCareerInput(), sources: [], educations: [{ ...newCareerRecord('educations', 'e-one'), confirmation: 'confirmed', revision: 1, confirmedRevision: 1, confirmedAt: '2026-10-18T00:00:00Z',
      school: '原创虚构大学', degree: '硕士', major: '人工智能', startDate: '2025-09', endDate: '2027-06' }], internships: [], projects: [], publications: [],
  } };
  const window = new EventEmitter() as EventEmitter & { isDestroyed(): boolean; isFocused(): boolean };
  let windowFocused = true, viewFocused = true, visible = true, generation = 5, focused = false, expanded = false, monthOpen = false;
  let openMonthSide: 'start' | 'end' = 'start', monthFieldOverride: Partial<Field> | undefined, triggerCovered = false;
  let covered = false, dateNoProgress = false, viewport = { x: 0, y: 0, width: 900, height: 700 }, focusCalls = 0;
  let onHover: (() => void) | undefined, onClick: (() => void) | undefined, onRead: (() => void) | undefined, onInsert: (() => void) | undefined;
  let onPopupRead: ((readCount: number) => void) | undefined, popupReads = 0;
  let onMonthRead: ((readCount: number) => void) | undefined, monthReads = 0;
  let onMonthHitRead: ((readCount: number) => void) | undefined, monthHitReads = 0;
  let addFooterTop = Infinity, addNoProgress = false, onAddHitRead: ((count: number) => void) | undefined, addHitReads = 0;
  let addHitMetaOverride: Record<string, unknown> | undefined;
  let onMonthWheel: ((kind: string) => void) | undefined;
  let monthHitMetaOverride: Record<string, unknown> | undefined;
  let monthTopCoverBottom = 0;
  let deferredInsert: { promise: Promise<void>; resolve(): void; reject(): void; } | undefined;
  const events: NativeEvent[] = [], inserts: string[] = [], choices: string[] = [];
  const degreeOptions = [
    { index: 0, id: 'bachelor', label: '本科', selected: false, identity: 'bachelor-option', bounds: { x: 100, y: 260, width: 280, height: 36 } },
    { index: 1, id: 'master', label: "Master's degree", selected: false, identity: 'master-option', bounds: { x: 100, y: 310, width: 280, height: 36 } },
  ];
  const monthColumns = [
    { kind: 'year', identity: 'year-column', bounds: { x: 100, y: 290, width: 120, height: 180 }, scrollTop: 0, scrollHeight: 1000, clientHeight: 180,
      scrollState: { scrollingX: false, scrollingY: false },
      options: [{ value: '2025', selected: false, identity: 'year-2025', bounds: { x: 100, y: 320, width: 120, height: 30 } }] },
    { kind: 'month', identity: 'month-column', bounds: { x: 240, y: 290, width: 120, height: 180 }, scrollTop: 0, scrollHeight: 360, clientHeight: 180,
      scrollState: { scrollingX: false, scrollingY: false },
      options: [{ value: '09', selected: false, identity: 'month-09', bounds: { x: 240, y: 320, width: 120, height: 30 } }] },
  ];
  const target = () => ({ url: raw.url, exists: true, field: structuredClone(field), focused, uncovered: !covered && !triggerCovered, valid: true });
  const select = () => ({ url: raw.url, owner: expanded ? { identity: field.identity, value: field.value, focused } : null,
    popup: expanded ? { identity: 'degree-popup', options: structuredClone(degreeOptions) } : null });
  const month = (side: 'start' | 'end') => ({ url: raw.url, popup: monthOpen && side === openMonthSide ? { identity: 'month-popup', field: { ...structuredClone(field), ...monthFieldOverride }, focused,
    columns: structuredClone(monthColumns) } : null });
  const inBox = (event: NativeEvent, box: Box) => event.x !== undefined && event.y !== undefined && event.x >= box.x && event.x <= box.x + box.width && event.y >= box.y && event.y <= box.y + box.height;
  const contents = {
    getURL: () => raw.url, isDestroyed: () => false, getZoomFactor: () => 1,
    isFocused: () => windowFocused && viewFocused,
    focus() { focusCalls++; viewFocused = true; },
    async executeJavaScript(source: string) {
      assert.doesNotMatch(source, /\.value\s*=(?!=)|\.scrollTop\s*=(?!=)|\.focus\(|\.click\(|dispatchEvent/u, 'all page scripts stay read-only');
      if (source.includes('/* offeragent-read-feishu-career */')) { onRead?.(); return structuredClone(raw); }
      if (source.includes('/* offeragent-read-feishu-career-target */')) return target();
      if (source.includes('/* offeragent-read-feishu-add-target */')) {
        addHitReads++; onAddHitRead?.(addHitReads);
        const point = /document\.elementFromPoint\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/u.exec(source); assert.ok(point);
        const uncovered = !covered && Number(point[2]) < addFooterTop;
        return { url: raw.url, supported: true, exists: true, control: structuredClone(raw.addControls[0]), uncovered, groupIds: raw.groups.map(group => group.id),
          hitMeta: addHitMetaOverride ?? { tag: 'div', classes: uncovered ? ['createFormSection-addBtn'] : [] } };
      }
      if (source.includes('/* offeragent-read-feishu-select-popup */')) { popupReads++; onPopupRead?.(popupReads); return select(); }
      if (source.includes('/* offeragent-read-feishu-select-option-target */')) {
        const option = degreeOptions.find(option => /master/iu.test(option.id));
        return { url: raw.url, exists: expanded, uncovered: !covered, focused, value: field.value, ownerIdentity: field.identity,
          popupIdentity: 'degree-popup', option: structuredClone(option) };
      }
      if (source.includes('/* offeragent-read-feishu-month-popup */')) {
        monthReads++; onMonthRead?.(monthReads);
        const side = /fsMonthPopup\("[^"]+",\s*"(start|end)"\)/u.exec(source); assert.ok(side);
        return month(side[1] as 'start' | 'end');
      }
      if (source.includes('/* offeragent-read-feishu-month-option-target */')) {
        monthHitReads++; onMonthHitRead?.(monthHitReads);
        const kind = source.includes('column.kind === "year"') ? 'year' : 'month';
        const column = monthColumns.find(column => column.kind === kind)!;
        const point = /document\.elementFromPoint\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/u.exec(source);
        assert.ok(point, 'production target uses numeric coordinates computed by the host');
        const event = { type: 'probe', x: Number(point[1]), y: Number(point[2]) };
        const option = column.options[0]!;
        const uncovered = !covered && event.y >= monthTopCoverBottom && inBox(event, column.bounds) && inBox(event, option.bounds);
        return { url: raw.url, exists: monthOpen, uncovered, focused, popupIdentity: 'month-popup', columnIdentity: column.identity,
          field: structuredClone(field), option: structuredClone(option), observation: structuredClone(raw), hitMeta: monthHitMetaOverride
            ?? { tag: uncovered ? 'div' : 'body', classes: uncovered ? ['atsx-date-picker-period-month-panel-list-item'] : [], ...(uncovered ? { numericDataCy: option.value } : {}) } };
      }
      if (source.includes('/* offeragent-read-feishu-month-column-target */')) {
        const kind = source.includes('column.kind === "year"') ? 'year' : 'month';
        const column = monthColumns.find(column => column.kind === kind)!;
        const point = /fsHit\(column\?\.element,\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/u.exec(source);
        assert.ok(point); const event = { type: 'probe', x: Number(point[1]), y: Number(point[2]) };
        return { url: raw.url, exists: monthOpen, uncovered: !covered && event.y >= monthTopCoverBottom && inBox(event, column.bounds), focused, popupIdentity: 'month-popup', columnIdentity: column.identity,
          field: structuredClone(field), column: structuredClone(column) };
      }
      if (source.includes('/* offeragent-read-feishu-page-wheel-target */')) return { url: raw.url, allowed: !covered, identity: 'page-surface' };
      throw new Error('unexpected production reader');
    },
    sendInputEvent(event: NativeEvent) {
      events.push(event);
      if (event.type === 'mouseMove') { onHover?.(); return; }
      if (event.type === 'mouseWheel') {
        if (monthOpen) {
          const column = monthColumns.find(column => inBox(event, column.bounds));
          if (column) {
            column.scrollState.scrollingY = true;
            if (!dateNoProgress) { column.scrollTop -= event.deltaY ?? 0; for (const option of column.options) option.bounds.y += event.deltaY ?? 0; }
            onMonthWheel?.(column.kind);
          }
        } else { field.bounds.y += event.deltaY ?? 0; if (!addNoProgress) raw.addControls[0]!.bounds.y += event.deltaY ?? 0; }
        return;
      }
      if (event.type !== 'mouseUp') return;
      onClick?.(); focused = true;
      if (expanded) {
        const option = degreeOptions.find(option => inBox(event, option.bounds));
        if (option) { choices.push(option.label); field.value = option.label; option.selected = true; expanded = false; }
      } else if (monthOpen) {
        const column = monthColumns.find(column => inBox(event, column.bounds) && column.options.some(option => inBox(event, option.bounds)));
        if (column) {
          column.options[0]!.selected = true;
          if (column.kind === 'year' && column.options[0]!.value === '至今') { field.value = '至今'; field.untilNow = true; monthOpen = false; }
          else if (column.kind === 'year') field.value = column.options[0]!.value + '-MM';
          else { field.value = field.value.slice(0, 4) + '-' + column.options[0]!.value; monthOpen = false; }
        }
      } else if (type === 'empty' && inBox(event, raw.addControls[0]!.bounds)) {
        raw.groups.push({ id: 'education[1]', kind: 'education', key: '1', identity: 'fixture-group', fields: [field] }); raw.addControls[0]!.identity = 'fixture-add-after';
      } else if (type === 'degree') expanded = true;
      else if (type === 'month') { monthOpen = true; openMonthSide = field.side ?? 'start'; }
    },
    async insertText(value: string) {
      inserts.push(value);
      if (deferredInsert) { driverOptions.deadline = performance.now() + 50; await deferredInsert.promise; }
      field.value = value; onInsert?.();
    },
  };
  window.isDestroyed = () => false; window.isFocused = () => windowFocused;
  const abort = new AbortController();
  const driverOptions: FeishuCareerDriverOptions = { window: window as never, view: { webContents: contents, getBounds: () => viewport } as never,
    getProfile: () => structuredClone(profile), getGeneration: () => generation, isVisible: () => visible, signal: abort.signal, deadline: performance.now() + 10_000 };
  const driver = new FeishuCareerDriver(driverOptions);
  return { driver, driverOptions, raw, field, profile, events, inserts, choices, degreeOptions, monthColumns, abort,
    focusCalls: () => focusCalls, hide() { visible = false; }, blur() { windowFocused = false; window.emit('blur'); },
    restore() { windowFocused = true; viewFocused = true; }, background() { windowFocused = false; viewFocused = false; },
    navigate() { raw.url += '-changed'; }, reload() { generation++; }, resize() { viewport = { ...viewport, width: 800 }; },
    cover() { covered = true; }, setNoDateProgress() { dateNoProgress = true; },
    deferInsert() {
      let resolve!: () => void, reject!: () => void;
      const promise = new Promise<void>((done, fail) => { resolve = done; reject = () => fail(new Error('fixture native refused')); });
      deferredInsert = { promise, resolve, reject }; return deferredInsert;
    },
    onHover(callback: () => void) { onHover = callback; }, onClick(callback: () => void) { onClick = callback; }, onRead(callback: () => void) { onRead = callback; }, onInsert(callback: () => void) { onInsert = callback; },
    onPopupRead(callback: (readCount: number) => void) { onPopupRead = callback; }, popupReads: () => popupReads,
    selectOpen: () => expanded,
    onMonthRead(callback: (readCount: number) => void) { onMonthRead = callback; }, monthReads: () => monthReads,
    monthOpen: () => monthOpen,
    setMonthHitMeta(value: Record<string, unknown>) { monthHitMetaOverride = value; },
    setMonthTopCover(bottom: number) { monthTopCoverBottom = bottom; },
    onMonthHitRead(callback: (readCount: number) => void) { onMonthHitRead = callback; }, monthHitReads: () => monthHitReads,
    openMonthPopup(side: 'start' | 'end', hasFocus = true) { monthOpen = true; openMonthSide = side; focused = hasFocus; },
    setMonthPopupField(value: Partial<Field>) { monthFieldOverride = value; }, coverTriggerOnly() { triggerCovered = true; },
    setAddFooter(top: number) { addFooterTop = top; }, setAddNoProgress() { addNoProgress = true; },
    onAddHitRead(callback: (count: number) => void) { onAddHitRead = callback; }, setAddHitMeta(value: Record<string, unknown>) { addHitMetaOverride = value; },
    onMonthWheel(callback: (kind: string) => void) { onMonthWheel = callback; },
  };
}

async function planFor(f: ReturnType<typeof fixture>) {
  const plan = buildCareerPlan(f.profile, await f.driver.read(), { selectedRecordIds: f.field.kind === 'internship'
    ? { educations: [], internships: ['i-one'], projects: [] } : { educations: ['e-one'], internships: [], projects: [] } });
  const step = plan.steps.find((step): step is CareerFillGroupStep => step.kind === 'fill-group');
  assert.ok(step); const item = step.items.find((item): item is CareerPlannedField => item.status === 'ready'); assert.ok(item);
  return { plan, step, item };
}

function ongoingFixture() {
  const f = fixture('month');
  Object.assign(f.field, { fieldId: 'internship[1].period:end', path: 'internship[1].period', kind: 'internship', side: 'end', supportsUntilNow: true, untilNow: false });
  f.raw.groups[0]!.id = 'internship[1]'; f.raw.groups[0]!.kind = 'internship';
  f.profile.career!.internships = [{ ...newCareerRecord('internships', 'i-one'), confirmation: 'confirmed', revision: 1,
    confirmedRevision: 1, confirmedAt: '2026-10-19T00:00:00Z', organization: '虚构进行中实习单位', startDate: '2026-06', endDate: '', current: true }];
  f.monthColumns[0]!.options[0]!.value = '至今'; f.monthColumns[0]!.options[0]!.identity = 'end-until-now';
  return f;
}

test('ongoing end uses the real year-column 至今 option once, with no month, keyboard proxy or fabricated date', async () => {
  const f = ongoingFixture(), approved = await planFor(f); assert.equal(approved.item.value, '至今');
  const initial = await f.driver.read(); await f.driver.start();
  const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, '至今'); assert.equal(f.field.untilNow, true);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2);
  assert.deepEqual(f.inserts, []); assert.deepEqual(f.events.filter(event => event.keyCode), []);
  assert.equal(f.monthColumns[1]!.options[0]!.selected, false);
  const after = await f.driver.read(); assert.equal(after.signature, initial.signature);
  assert.deepEqual(after.protectedFields, initial.protectedFields);
  assert.equal(after.groups[0]!.fields[0]!.value, '至今'); f.driver.dispose();
});

test('an offscreen until-now option reuses its own guarded year-column scrolling', async () => {
  const f = ongoingFixture(); f.monthColumns[0]!.options[0]!.bounds.y = 900;
  const approved = await planFor(f); await f.driver.start();
  await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.ok(f.events.some(event => event.type === 'mouseWheel')); assert.equal(f.field.value, '至今');
  assert.equal(f.monthColumns[1]!.scrollTop, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('missing or duplicate until-now options stop after opening, without selecting any fallback month', async () => {
  for (const duplicate of [false, true]) {
    const f = ongoingFixture();
    if (duplicate) f.monthColumns[0]!.options.push(structuredClone(f.monthColumns[0]!.options[0]!));
    else f.monthColumns[0]!.options[0]!.value = '2025';
    const approved = await planFor(f); await f.driver.start();
    await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /唯一真实选项/);
    assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
  }
});

test('until-now retains blur, layout, unrelated-field and hover-identity checks before its option click', async () => {
  for (const reason of ['blur', 'resize', 'unrelated', 'option-identity'] as const) {
    const f = ongoingFixture(), approved = await planFor(f); await f.driver.start();
    f.onMonthHitRead(() => {
      if (reason === 'blur') f.blur();
      if (reason === 'resize') f.resize();
      if (reason === 'unrelated') f.raw.protectedControls[0]!.value = 'unexpected@example.invalid';
      if (reason === 'option-identity') f.monthColumns[0]!.options[0]!.identity = 'unexpected-option';
    });
    await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan));
    assert.equal(f.field.value, '', reason); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1, reason); f.driver.dispose();
  }
});

test('a displayed 至今 string without the independently observed untilNow state is not verified', async () => {
  const f = ongoingFixture(), approved = await planFor(f); await f.driver.start();
  const activity: FeishuFieldActivity[] = []; f.driverOptions.onFieldActivity = value => { activity.push(value); };
  f.onRead(() => { if (f.field.value === '至今') f.field.untilNow = false; });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /没有独立确认/);
  assert.equal(f.field.value, '至今'); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2);
  assert.equal(activity.some(value => value.phase === 'verified'), false, 'a stable string cannot emit success before independent untilNow proof'); f.driver.dispose();
});

test('prepare can read in background but native start requires foreground and never activates a window', async () => {
  const f = fixture(); f.background(); await f.driver.read();
  await assert.rejects(f.driver.start(), /前台/u); assert.equal(f.focusCalls(), 0); assert.equal(f.events.length, 0);
  f.restore(); await f.driver.start(); assert.equal(f.focusCalls(), 1); f.driver.dispose();
});

test('normalization retains record field identity while coordinates and values stay outside structural signature', async () => {
  const f = fixture('month'), first = await f.driver.read();
  assert.equal(first.groups[0]!.fields[0]!.type, 'feishu-month'); assert.equal(first.groups[0]!.fields[0]!.datePrecision, 'month');
  f.field.bounds.y += 120; f.field.value = '2025-09'; const after = await f.driver.read();
  assert.equal(first.signature, after.signature); assert.equal(first.groups[0]!.signature, after.groups[0]!.signature);
  assert.notEqual(first.groups[0]!.fields[0]!.value, after.groups[0]!.fields[0]!.value);
  assert.equal(first.protectedFields!.length, 2); f.driver.dispose();
});

test('text uses one native click, insertText and Tab and independently retains the exact profile value', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start();
  const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, '原创虚构大学'); assert.deepEqual(f.inserts, ['原创虚构大学']);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1);
  assert.deepEqual(f.events.filter(event => event.keyCode).map(event => [event.type, event.keyCode]), [['keyDown', 'Tab'], ['keyUp', 'Tab']]);
  assert.equal(f.raw.protectedControls[0]!.value, 'preserved@example.invalid'); f.driver.dispose();
});

test('field activity reports only copied observed coordinates at guarded approach, insertion and final verification', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start();
  const observed: Array<{ target: FeishuFieldActivity; clicks: number; inputs: number; value: string }> = [];
  f.driverOptions.onFieldActivity = target => {
    observed.push({ target: structuredClone(target), clicks: f.events.filter(event => event.type === 'mouseUp').length, inputs: f.inserts.length, value: f.field.value });
    target.bounds.x = -500; target.bounds.y = 9000;
  };
  await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.deepEqual(observed.map(value => [value.target.phase, value.clicks, value.inputs]), [['approach', 0, 0], ['typing', 1, 0], ['verified', 1, 1]]);
  assert.equal(observed[2]!.value, approved.item.value);
  for (const value of observed) {
    assert.deepEqual(Object.keys(value.target).sort(), ['bounds', 'phase']);
    assert.deepEqual(value.target.bounds, { x: 100, y: 180, width: 280, height: 40 });
  }
  assert.deepEqual(f.field.bounds, { x: 100, y: 180, width: 280, height: 40 }); f.driver.dispose();
});

test('throwing, rejected or never-settled decorative activity callbacks cannot fail or delay native field completion', async () => {
  for (const failure of ['throw', 'reject', 'pending'] as const) {
    const f = fixture(), approved = await planFor(f); await f.driver.start();
    f.driverOptions.onFieldActivity = () => {
      if (failure === 'throw') throw new Error('optional decoration failed');
      return failure === 'reject' ? Promise.reject(new Error('optional async decoration failed')) : new Promise<void>(() => undefined);
    };
    const result = await f.driver.fill(approved.step, approved.item, approved.plan);
    assert.equal(result.expectedValue, approved.item.value); assert.equal(f.inserts.length, 1); f.driver.dispose();
  }
});

test('activity cannot precede an original refused field preparation or bypass a new blur before insertion', async () => {
  const blocked = fixture(), approved = await planFor(blocked); await blocked.driver.start();
  const activity: FeishuFieldActivity[] = []; blocked.driverOptions.onFieldActivity = target => { activity.push(target); };
  blocked.onHover(() => blocked.blur());
  await assert.rejects(blocked.driver.fill(approved.step, approved.item, approved.plan));
  assert.deepEqual(activity, []); assert.equal(blocked.inserts.length, 0); blocked.driver.dispose();
  const blur = fixture(), second = await planFor(blur); await blur.driver.start();
  blur.driverOptions.onFieldActivity = target => { if (target.phase === 'typing') blur.blur(); };
  await assert.rejects(blur.driver.fill(second.step, second.item, second.plan));
  assert.equal(blur.inserts.length, 0, 'the existing assertActive still runs after optional notification'); blur.driver.dispose();
});

test('a failed value verification emits no decorative verified event', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start();
  const activity: FeishuFieldActivity[] = []; f.driverOptions.onFieldActivity = value => { activity.push(value); };
  f.onInsert(() => { f.field.value = '网页意外改变的虚构值'; });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan));
  assert.deepEqual(activity.map(value => value.phase), ['approach', 'typing']); f.driver.dispose();
});

test('degree selects a unique real synonym with two native clicks and never types or presses Enter', async () => {
  const f = fixture('degree'), approved = await planFor(f); await f.driver.start();
  const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, "Master's degree"); assert.deepEqual(f.choices, ["Master's degree"]);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2); assert.equal(f.inserts.length, 0);
  assert.equal(f.events.some(event => event.keyCode), false); f.driver.dispose();
});

test('duplicate degree options stop after opening and never click an arbitrary occurrence', async () => {
  const f = fixture('degree'); f.degreeOptions.push({ ...f.degreeOptions[1]!, index: 2, id: 'second-master', identity: 'second-master', bounds: { x: 100, y: 360, width: 280, height: 36 } });
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /唯一/u);
  assert.equal(f.choices.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('month endpoint, year and month use three native clicks without editing the keyboard proxy', async () => {
  const f = fixture('month'), approved = await planFor(f); await f.driver.start();
  const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, '2025-09'); assert.equal(f.field.value, '2025-09');
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 3); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('an offscreen month option receives bounded native wheel events within its own column before selection', async () => {
  const f = fixture('month'); f.monthColumns[0]!.options[0]!.bounds.y = 900;
  const approved = await planFor(f); await f.driver.start();
  await f.driver.fill(approved.step, approved.item, approved.plan);
  const wheels = f.events.filter(event => event.type === 'mouseWheel');
  assert.ok(wheels.length > 0); assert.ok(wheels.every(event => Math.abs(event.deltaY!) <= 400 && event.x === 160));
  assert.equal(f.driver.getSummary().monthWheels, wheels.length); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('native add clicks the bound div once and leaves new-group verification to the serial runner', async () => {
  const f = fixture('empty'), plan = buildCareerPlan(f.profile, await f.driver.read(), { selectedRecordIds: { educations: ['e-one'], internships: [], projects: [] } });
  const step = plan.steps.find(step => step.kind === 'add-then-reobserve'); assert.ok(step?.kind === 'add-then-reobserve'); await f.driver.start();
  await f.driver.add(step, plan);
  assert.equal(f.raw.groups.length, 1); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('sticky window blur forbids all later native input even after the user restores foreground', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start(); f.blur(); f.restore();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /失焦/u);
  assert.equal(f.events.length, 0); assert.equal(f.focusCalls(), 1); f.driver.dispose();
});

test('profile, page generation, URL, layout, visibility and abort changes stop before the first native input', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.profile.version++, (f: ReturnType<typeof fixture>) => f.reload(),
    (f: ReturnType<typeof fixture>) => f.navigate(), (f: ReturnType<typeof fixture>) => f.resize(),
    (f: ReturnType<typeof fixture>) => f.hide(), (f: ReturnType<typeof fixture>) => f.abort.abort()]) {
    const f = fixture(), approved = await planFor(f); await f.driver.start(); mutate(f);
    await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan)); assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
  }
});

test('changing an unrelated checkbox during hover prevents the first native click and typed value', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start();
  f.onHover(() => { f.raw.protectedControls[1]!.checked = true; });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /非目标/u);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('a non-target mutation caused by insertText stops before Tab or a later field', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start(); f.onInsert(() => { f.raw.protectedControls[0]!.value = 'changed@example.invalid'; });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /非目标/u);
  assert.equal(f.inserts.length, 1); assert.equal(f.events.some(event => event.keyCode), false); f.driver.dispose();
});

test('degree option identity changing on hover stops before choosing it', async () => {
  const f = fixture('degree'), approved = await planFor(f); await f.driver.start();
  f.onHover(() => { if (f.events.filter(event => event.type === 'mouseUp').length) f.degreeOptions[1]!.identity = 'replacement'; });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /变化/u);
  assert.equal(f.choices.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('disposed driver cannot read, regain focus, click or resume a consumed run', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start(); f.driver.dispose();
  await assert.rejects(f.driver.read()); await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan));
  assert.equal(f.events.length, 0); assert.equal(f.focusCalls(), 1);
});

test('month wheel with no real column progress stops after its first attempt without an option click', async () => {
  const f = fixture('month'); f.monthColumns[0]!.options[0]!.bounds.y = 900; f.setNoDateProgress();
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /无进展/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('a blur caused during native trigger click is sticky and prevents the option click after focus returns', async () => {
  const f = fixture('degree'), approved = await planFor(f); await f.driver.start();
  f.onClick(() => { f.blur(); f.restore(); });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /失焦/u);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.choices.length, 0); assert.equal(f.focusCalls(), 1); f.driver.dispose();
});

test('deadline expiry is checked before any mouse or keyboard event', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start(); f.driverOptions.deadline = performance.now() - 1;
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /超时/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('a forged ready item with different value cannot use a previously built record binding', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, { ...approved.item, value: 'unapproved' }, approved.plan), /授权/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('a timed-out insert remains pending after disposal until its actual late settlement, with no Tab or retry', async () => {
  const f = fixture(), approved = await planFor(f), pending = f.deferInsert(); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /超时/u);
  assert.equal(f.driver.hasPendingMutation(), true); assert.equal(f.field.value, '');
  assert.equal(f.events.some(event => event.keyCode), false); assert.equal(f.inserts.length, 1);
  f.driver.dispose(); assert.equal(f.driver.hasPendingMutation(), true, 'disposing the driver never pretends to cancel native input');
  let settled = false; const settlement = f.driver.waitForPendingMutation().then(() => { settled = true; });
  await delay(20); assert.equal(settled, false);
  pending.resolve(); await settlement;
  assert.equal(f.field.value, approved.item.value, 'fixture deliberately demonstrates the late queued write');
  assert.equal(f.driver.hasPendingMutation(), false); assert.equal(f.inserts.length, 1);
  await assert.rejects(f.driver.read()); assert.equal(f.events.some(event => event.keyCode), false);
});

test('pending native rejection settles the host lock signal without exposing its raw error or clearing early', async () => {
  const f = fixture(), approved = await planFor(f), pending = f.deferInsert(); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /超时/u);
  assert.equal(f.driver.hasPendingMutation(), true);
  const settlement = f.driver.waitForPendingMutation(); pending.reject(); await settlement;
  assert.equal(f.driver.hasPendingMutation(), false); assert.equal(f.field.value, '');
  assert.equal(f.events.some(event => event.keyCode), false); f.driver.dispose();
});

test('degree popup positioning animation settles before a real option is frozen and clicked', async () => {
  const f = fixture('degree'), approved = await planFor(f); let movingReads = 0;
  f.onPopupRead(() => { if (f.selectOpen() && movingReads++ < 3) for (const option of f.degreeOptions) option.bounds.y += 8; });
  await f.driver.start(); const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, "Master's degree"); assert.deepEqual(f.choices, ["Master's degree"]);
  assert.ok(f.popupReads() >= 9, 'three geometry changes must be followed by several unchanged samples, not a fixed 80ms sleep');
  assert.ok(Object.values(f.driver.getSummary().lastSelectCheck!).every(value => value === true));
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('degree popup that keeps moving stops within the bounded wait without clicking an option', async () => {
  const f = fixture('degree'), approved = await planFor(f);
  f.onPopupRead(() => { if (f.selectOpen()) for (const option of f.degreeOptions) option.bounds.y += 1; });
  await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /未稳定/u);
  assert.ok(f.popupReads() >= 4); assert.ok(f.popupReads() <= 44);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.choices.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('degree hover selection-state change remains blocked and safe diagnostic names the exact failed comparison', async () => {
  const f = fixture('degree'), approved = await planFor(f);
  f.onHover(() => { if (f.selectOpen()) f.degreeOptions[0]!.selected = true; });
  await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /点击前变化/u);
  const summary = f.driver.getSummary(), check = summary.lastSelectCheck!;
  assert.equal(check.selectedStatesEqual, false);
  for (const [key, value] of Object.entries(check)) if (key !== 'selectedStatesEqual') assert.equal(value, true, key);
  assert.ok(Object.values(check).every(value => typeof value === 'boolean'));
  assert.doesNotMatch(JSON.stringify(summary), /example|feishu\.cn|Master|本科|硕士|fixture-field/iu, 'diagnostic never returns field values, labels, URLs or identities');
  check.hitExists = false; assert.equal(f.driver.getSummary().lastSelectCheck!.hitExists, true, 'callers cannot mutate retained diagnostic evidence');
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.choices.length, 0); f.driver.dispose();
});

test('degree hover geometry change remains blocked rather than reusing an old option coordinate', async () => {
  const f = fixture('degree'), approved = await planFor(f);
  f.onHover(() => { if (f.selectOpen()) f.degreeOptions[1]!.bounds.y += 12; });
  await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /点击前变化/u);
  assert.equal(f.driver.getSummary().lastSelectCheck!.optionsGeometryStable, false);
  assert.equal(f.driver.getSummary().lastSelectCheck!.selectedStatesEqual, true);
  assert.equal(f.choices.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('month popup animation must settle before choosing the first year and the following month', async () => {
  const f = fixture('month'), approved = await planFor(f); let movingReads = 0;
  f.onMonthRead(() => {
    if (f.monthOpen() && movingReads++ < 3) for (const column of f.monthColumns) {
      column.bounds.y += 6; for (const option of column.options) option.bounds.y += 6;
    }
  });
  await f.driver.start(); const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, '2025-09'); assert.equal(f.field.value, '2025-09');
  assert.ok(f.monthReads() >= 13, 'both year and month require several stable samples after the positioning animation');
  assert.ok(Object.values(f.driver.getSummary().lastMonthCheck!).every(value => value === true));
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 3); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('month popup that remains animated stops within the bounded wait without a year or month click', async () => {
  const f = fixture('month'), approved = await planFor(f);
  f.onMonthRead(() => { if (f.monthOpen()) for (const column of f.monthColumns) {
    column.bounds.y += 1; for (const option of column.options) option.bounds.y += 1;
  } });
  await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月弹层.*未稳定/u);
  assert.ok(f.monthReads() >= 4 && f.monthReads() <= 44);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('month option geometry changing after stable positioning is rejected on hover with boolean-only diagnostics', async () => {
  const f = fixture('month'), approved = await planFor(f);
  f.onHover(() => { if (f.monthOpen()) f.monthColumns[0]!.options[0]!.bounds.y += 12; });
  await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月选项被遮挡或变化/u);
  const summary = f.driver.getSummary(), check = summary.lastMonthCheck!;
  assert.equal(check.geometryStable, false);
  for (const [key, value] of Object.entries(check)) if (key !== 'geometryStable') assert.equal(value, true, key);
  assert.ok(Object.values(check).every(value => typeof value === 'boolean'));
  assert.doesNotMatch(JSON.stringify(summary.lastMonthCheck), /feishu\.cn|2025|2027|fictional|fixture-field/iu);
  assert.doesNotMatch(JSON.stringify(summary), /feishu\.cn|fictional|fixture-field/iu, 'geometry metadata may contain only reviewed numeric date data-cy');
  check.hitExists = false; assert.equal(f.driver.getSummary().lastMonthCheck!.hitExists, true);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
});

test('month option identity or selected-state changing on hover remains blocked before its native click', async () => {
  for (const change of ['identity', 'selected'] as const) {
    const f = fixture('month'), approved = await planFor(f);
    f.onHover(() => { if (f.monthOpen()) {
      if (change === 'identity') f.monthColumns[0]!.options[0]!.identity = 'replacement-year';
      else f.monthColumns[0]!.options[0]!.selected = true;
    } });
    await f.driver.start();
    await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月选项被遮挡或变化/u);
    assert.equal(f.driver.getSummary().lastMonthCheck![change === 'identity' ? 'optionIdentityEqual' : 'selectedStatesEqual'], false);
    assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
  }
});

test('a wide month option clipped by its column is clicked inside the visible intersection, never at its full-box center', async () => {
  const f = fixture('month'), approved = await planFor(f);
  for (const column of f.monthColumns) column.options[0]!.bounds.width = 400;
  await f.driver.start(); await f.driver.fill(approved.step, approved.item, approved.plan);
  const optionClicks = f.events.filter(event => event.type === 'mouseUp').slice(1);
  assert.deepEqual(optionClicks.map(event => event.x), [160, 300]);
  assert.equal(f.field.value, '2025-09');
  const summary = f.driver.getSummary();
  assert.equal(summary.lastMonthCheck!.hitUncovered, true);
  assert.equal(summary.lastMonthGeometry!.centerInsideColumn, false);
  assert.deepEqual(summary.lastMonthGeometry!.point, { x: 300, y: 335 });
  assert.deepEqual(summary.lastMonthGeometry!.hit, { tag: 'div', classes: ['atsx-date-picker-period-month-panel-list-item'], numericDataCy: '09' });
  summary.lastMonthGeometry!.point.x = 0; summary.lastMonthGeometry!.hit.classes.push('external-change');
  assert.equal(f.driver.getSummary().lastMonthGeometry!.point.x, 300);
  assert.equal(f.driver.getSummary().lastMonthGeometry!.hit.classes.length, 1); f.driver.dispose();
});

test('a real covering element still blocks a clipped option even though identities, geometry and focus remain valid', async () => {
  const f = fixture('month'), approved = await planFor(f);
  f.monthColumns[0]!.options[0]!.bounds.width = 400;
  f.onHover(() => { if (f.monthOpen()) f.cover(); });
  await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月选项持续被遮挡/u);
  const check = f.driver.getSummary().lastMonthCheck!;
  assert.equal(check.hitUncovered, false);
  for (const [key, value] of Object.entries(check)) if (key !== 'hitUncovered') assert.equal(value, true, key);
  assert.equal(f.driver.getSummary().lastMonthGeometry!.centerInsideColumn, false);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
});

test('month hit diagnostic projects only reviewed technical metadata, never arbitrary ids, text or field values', async () => {
  const f = fixture('month'), approved = await planFor(f);
  f.setMonthHitMeta({ tag: 'private-account-element', classes: ['private-user-value', 'atsx-date-picker-period-month-panel-list-item'],
    numericDataCy: 'private-nonnumeric-value', id: 'private-account-id', text: 'private-display-text', value: 'private-value', url: 'https://private.invalid/path' });
  await f.driver.start(); await f.driver.fill(approved.step, approved.item, approved.plan);
  const summary = f.driver.getSummary();
  assert.deepEqual(summary.lastMonthGeometry!.hit, { tag: 'other', classes: ['atsx-date-picker-period-month-panel-list-item'] });
  assert.doesNotMatch(JSON.stringify(summary), /private-/u); f.driver.dispose();
});

test('a top-covered date row moves toward the uncovered column center before its one safe native click', async () => {
  const f = fixture('month');
  Object.assign(f.monthColumns[0]!.bounds, { y: 0, height: 333 });
  Object.assign(f.monthColumns[0]!.options[0]!.bounds, { y: 46, height: 38 });
  f.monthColumns[0]!.scrollTop = 200; f.setMonthTopCover(120);
  let coveredProofObserved = false;
  f.onRead(() => { if (f.driver.getSummary().lastMonthCheck?.hitUncovered === false) coveredProofObserved = true; });
  const approved = await planFor(f); await f.driver.start(); await f.driver.fill(approved.step, approved.item, approved.plan);
  const wheels = f.events.filter(event => event.type === 'mouseWheel');
  assert.equal(wheels.length, 1); assert.equal(wheels[0]!.x, 160); assert.equal(wheels[0]!.y, 167);
  assert.equal(wheels[0]!.deltaY, 101.5, 'a safe upward column wheel moves this top row down to the center');
  const clicks = f.events.filter(event => event.type === 'mouseUp');
  assert.equal(clicks.length, 3); assert.equal(clicks[1]!.y, 167, 'the row was never clicked at its covered original y=65');
  assert.equal(coveredProofObserved, true); assert.equal(f.field.value, '2025-09');
  assert.ok(Object.values(f.driver.getSummary().lastMonthCheck!).every(value => value === true)); f.driver.dispose();
});

test('a date row still covered at the column center stops without a blind wheel or option click', async () => {
  const f = fixture('month'); f.monthColumns[0]!.options[0]!.bounds.y = 365;
  f.onHover(() => { if (f.monthOpen()) f.cover(); });
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月选项持续被遮挡/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
});

test('an uncovered column center with no progress stops after its first wheel while preserving the covered row', async () => {
  const f = fixture('month'); Object.assign(f.monthColumns[0]!.bounds, { y: 0, height: 333 });
  Object.assign(f.monthColumns[0]!.options[0]!.bounds, { y: 46, height: 38 });
  f.monthColumns[0]!.scrollTop = 200;
  f.setMonthTopCover(120); f.setNoDateProgress();
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /无进展/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
});

test('a temporary toast clears during guarded waiting, then the original real year is clicked without scrolling or dismissing it', async () => {
  const f = fixture('month'); Object.assign(f.monthColumns[0]!.bounds, { y: 0, height: 333 });
  Object.assign(f.monthColumns[0]!.options[0]!.bounds, { y: 46, height: 38 }); f.setMonthTopCover(120);
  f.onMonthHitRead(count => { if (count >= 4) f.setMonthTopCover(0); });
  const approved = await planFor(f); await f.driver.start(); await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(f.field.value, '2025-09'); assert.equal(f.driver.getSummary().occlusionWaits, 1);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0);
  const clicks = f.events.filter(event => event.type === 'mouseUp'); assert.equal(clicks.length, 3); assert.equal(clicks[1]!.y, 65);
  const moves = f.events.filter(event => event.type === 'mouseMove'); assert.ok(moves.some(event => event.x === 160 && event.y === 167), 'pointer leaves the toast only through a proven same-column point');
  assert.ok(f.monthHitReads() >= 5, 'moving back onto the option after the wait receives a fresh hover/read');
  assert.ok(Object.values(f.driver.getSummary().lastMonthCheck!).every(value => value === true)); f.driver.dispose();
});

test('persistent coverage at scrollTop zero stops after guarded waiting without an impossible upward wheel', async () => {
  const f = fixture('month'); Object.assign(f.monthColumns[0]!.bounds, { y: 0, height: 333 });
  Object.assign(f.monthColumns[0]!.options[0]!.bounds, { y: 46, height: 38 }); f.setMonthTopCover(120);
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月选项持续被遮挡/u);
  assert.equal(f.driver.getSummary().occlusionWaits, 1); assert.ok(f.monthHitReads() >= 5);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
});

test('cancellation while waiting on a toast prevents every later click or wheel', async () => {
  const f = fixture('month'); Object.assign(f.monthColumns[0]!.bounds, { y: 0, height: 333 });
  Object.assign(f.monthColumns[0]!.options[0]!.bounds, { y: 46, height: 38 }); f.setMonthTopCover(120);
  f.onMonthHitRead(count => { if (count === 3) f.abort.abort(); });
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /取消|超时/u);
  assert.equal(f.driver.getSummary().occlusionWaits, 1); assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, ''); f.driver.dispose();
});

test('a changed date value during occlusion waiting is protected instead of being overwritten after the toast disappears', async () => {
  const f = fixture('month'); Object.assign(f.monthColumns[0]!.bounds, { y: 0, height: 333 });
  Object.assign(f.monthColumns[0]!.options[0]!.bounds, { y: 46, height: 38 }); f.setMonthTopCover(120);
  f.onMonthHitRead(count => { if (count === 3) f.field.value = 'external-existing-value'; });
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月选项被遮挡或变化|原值|授权/u);
  assert.equal(f.driver.getSummary().occlusionWaits, 1); assert.equal(f.driver.getSummary().lastMonthCheck!.valueAuthorized, false);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 1); assert.equal(f.field.value, 'external-existing-value'); f.driver.dispose();
});

test('a strictly bound end popup opened automatically after the start date is filled directly without clicking its covered trigger', async () => {
  const f = fixture('month'); f.field.fieldId = 'education[1].period:end'; f.field.side = 'end';
  f.monthColumns[0]!.options[0]!.value = '2027'; f.monthColumns[0]!.options[0]!.identity = 'year-2027';
  f.monthColumns[1]!.options[0]!.value = '06'; f.monthColumns[1]!.options[0]!.identity = 'month-06';
  f.openMonthPopup('end'); f.coverTriggerOnly();
  const approved = await planFor(f); await f.driver.start();
  const result = await f.driver.fill(approved.step, approved.item, approved.plan);
  assert.equal(result.expectedValue, '2027-06'); assert.equal(f.field.value, '2027-06');
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2, 'only the real year and month are clicked, never the open popup trigger');
  assert.equal(f.inserts.length, 0); assert.ok(Object.values(f.driver.getSummary().lastMonthCheck!).every(value => value === true)); f.driver.dispose();
});

test('an already open popup for the other side stops before trying to toggle or type into the requested side', async () => {
  const f = fixture('month'); f.field.fieldId = 'education[1].period:end'; f.field.side = 'end'; f.openMonthPopup('start');
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /当前端点不符/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('an already open popup without its real element focus stops even while the window stays foreground', async () => {
  const f = fixture('month'); f.openMonthPopup('start', false);
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /当前端点不符/u);
  assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('an already open popup must preserve the authorized field identity and its original empty value', async () => {
  for (const override of [{ fieldId: 'education[2].period:start' }, { identity: 'replacement-date' }, { value: 'previously-entered' }]) {
    const f = fixture('month'); f.openMonthPopup('start'); f.setMonthPopupField(override);
    const approved = await planFor(f); await f.driver.start();
    await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /当前端点不符/u);
    assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
  }
});

async function addPlanFor(f: ReturnType<typeof fixture>) {
  const plan = buildCareerPlan(f.profile, await f.driver.read(), { selectedRecordIds: { educations: ['e-one'], internships: [], projects: [] } });
  const step = plan.steps.find(step => step.kind === 'add-then-reobserve'); assert.ok(step?.kind === 'add-then-reobserve');
  return { plan, step };
}

test('an add button visible behind a fixed footer scrolls to the viewport center before one verified click', async () => {
  const f = fixture('empty'); f.raw.addControls[0]!.bounds.y = 620; f.setAddFooter(580);
  const approved = await addPlanFor(f); await f.driver.start(); await f.driver.add(approved.step, approved.plan);
  const wheels = f.events.filter(event => event.type === 'mouseWheel'), clicks = f.events.filter(event => event.type === 'mouseUp');
  assert.equal(wheels.length, 1); assert.equal(wheels[0]!.deltaY, -288);
  assert.equal(clicks.length, 1); assert.equal(clicks[0]!.y, 350);
  assert.equal(f.raw.groups.length, 1); assert.equal(f.driver.getSummary().occlusionWaits, 1);
  assert.deepEqual(f.driver.getSummary().lastAddCheck, { exists: true, uncovered: true, identityEqual: true, geometryStable: true, kind: 'education' });
  assert.deepEqual(f.driver.getSummary().lastAddGeometry!.point, { x: 160, y: 350 }); f.driver.dispose();
});

test('an add button still covered in the viewport center stops after bounded read-only waiting without a blind wheel', async () => {
  const f = fixture('empty'); f.raw.addControls[0]!.bounds.y = 332; f.setAddFooter(300);
  const approved = await addPlanFor(f); await f.driver.start();
  await assert.rejects(f.driver.add(approved.step, approved.plan), /新增入口在中部仍被遮挡/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 0);
  assert.equal(f.raw.groups.length, 0); assert.equal(f.driver.getSummary().lastAddCheck!.uncovered, false); f.driver.dispose();
});

test('an add footer recovery with no actual page progress stops after its first wheel and never adds a group', async () => {
  const f = fixture('empty'); f.raw.addControls[0]!.bounds.y = 620; f.setAddFooter(580); f.setAddNoProgress();
  const approved = await addPlanFor(f); await f.driver.start();
  await assert.rejects(f.driver.add(approved.step, approved.plan), /新增入口滚动无进展/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 0);
  assert.equal(f.raw.groups.length, 0); f.driver.dispose();
});

test('an add button identity or hover geometry change stops immediately rather than entering occlusion recovery', async () => {
  for (const change of ['identity', 'geometry'] as const) {
    const f = fixture('empty'), approved = await addPlanFor(f); await f.driver.start();
    f.onHover(() => { if (change === 'identity') f.raw.addControls[0]!.identity = 'replacement-add'; else f.raw.addControls[0]!.bounds.x += 12; });
    await assert.rejects(f.driver.add(approved.step, approved.plan), /变化|非目标/u);
    assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 0); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 0);
    assert.equal(f.driver.getSummary().occlusionWaits, 0); f.driver.dispose();
  }
});

test('add diagnostics preserve reviewed popup/add classes and discard arbitrary hit content or identifiers', async () => {
  const f = fixture('empty'), approved = await addPlanFor(f);
  f.setAddHitMeta({ tag: 'div', classes: ['formOperate-addBtn', 'atsx-date-picker-period-month-panel-list-item', 'private-person-class'],
    numericDataCy: 'private-data', id: 'private-id', text: 'private-name', url: 'https://private.invalid/' });
  await f.driver.start(); await f.driver.add(approved.step, approved.plan);
  const summary = f.driver.getSummary();
  assert.deepEqual(summary.lastAddGeometry!.hit, { tag: 'div', classes: ['formOperate-addBtn', 'atsx-date-picker-period-month-panel-list-item'] });
  assert.doesNotMatch(JSON.stringify(summary), /private/u);
  summary.lastAddGeometry!.hit.classes.push('external'); assert.equal(f.driver.getSummary().lastAddGeometry!.hit.classes.length, 2); f.driver.dispose();
});

test('a month-column wheel exposes transient scroll-state diagnostics while preserving the bound popup and actual progress', async () => {
  const f = fixture('month'); f.monthColumns[1]!.options[0]!.bounds.y = 600; f.monthColumns[1]!.scrollHeight = 1000;
  const approved = await planFor(f); await f.driver.start(); await f.driver.fill(approved.step, approved.item, approved.plan);
  const check = f.driver.getSummary().lastMonthScrollCheck!;
  assert.equal(check.popupIdentityEqual, true); assert.equal(check.columnIdentityEqual, true); assert.equal(check.geometryStable, true); assert.equal(check.focused, true);
  assert.equal(check.beforeScrollTop, 0); assert.ok(check.afterScrollTop! > check.beforeScrollTop);
  assert.deepEqual(check.beforeState, { scrollingX: false, scrollingY: false }); assert.deepEqual(check.afterState, { scrollingX: false, scrollingY: true });
  assert.equal(f.field.value, '2025-09'); assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); f.driver.dispose();
});

test('a changed date value during the month wheel is rejected before any later month click', async () => {
  const f = fixture('month'); f.monthColumns[1]!.options[0]!.bounds.y = 600; f.monthColumns[1]!.scrollHeight = 1000;
  f.onMonthWheel(kind => { if (kind === 'month') f.field.value = 'external-date-change'; });
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /原值|授权/u);
  assert.equal(f.events.filter(event => event.type === 'mouseWheel').length, 1); assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2);
  assert.equal(f.field.value, 'external-date-change'); assert.equal(f.inserts.length, 0); f.driver.dispose();
});

test('a replaced popup or column during the month wheel is never mistaken for a transient scrollbar state', async () => {
  const f = fixture('month'); f.monthColumns[1]!.options[0]!.bounds.y = 600; f.monthColumns[1]!.scrollHeight = 1000;
  f.onMonthWheel(kind => { if (kind === 'month') f.monthColumns[1]!.identity = 'different-month-column'; });
  const approved = await planFor(f); await f.driver.start();
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), /年月滚动期间弹层已变化/u);
  assert.equal(f.driver.getSummary().lastMonthScrollCheck!.columnIdentityEqual, false);
  assert.equal(f.events.filter(event => event.type === 'mouseUp').length, 2); assert.equal(f.field.value, '2025-MM'); f.driver.dispose();
});

test('trusted native guard diagnostics preserve their fixed reason for add and fill without changing the refusal', async () => {
  for (const operation of ['add', 'fill'] as const) {
    const f = fixture(operation === 'add' ? 'empty' : 'text');
    const fill = operation === 'fill' ? await planFor(f) : undefined;
    const add = operation === 'add' ? await addPlanFor(f) : undefined;
    await f.driver.start(); f.hide();
    const execute = () => operation === 'add' ? f.driver.add(add!.step, add!.plan) : f.driver.fill(fill!.step, fill!.item, fill!.plan);
    await assert.rejects(execute(), /飞书浏览器失焦或隐藏，本次填写已停止/u);
    assert.deepEqual(f.driver.getSummary().lastFailure, { operation, reason: '飞书浏览器失焦或隐藏，本次填写已停止。' });
    const callerCopy = f.driver.getSummary(); callerCopy.lastFailure!.reason = 'caller-replacement';
    assert.equal(f.driver.getSummary().lastFailure!.reason, '飞书浏览器失焦或隐藏，本次填写已停止。');
    assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
  }
});

test('external page and store failures become only unclassified in both returned errors and retained summaries', async () => {
  const secret = 'never-return-external-provider-secret';
  for (const operation of ['add', 'fill'] as const) for (const source of ['page', 'store'] as const) {
    const f = fixture(operation === 'add' ? 'empty' : 'text');
    const fill = operation === 'fill' ? await planFor(f) : undefined;
    const add = operation === 'add' ? await addPlanFor(f) : undefined; await f.driver.start();
    const failure = new Error(secret + ' https://private.invalid/account');
    Object.assign(failure, { cause: { secret }, rawBody: secret });
    if (source === 'page') f.onRead(() => { throw failure; });
    else f.driverOptions.getProfile = () => { throw failure; };
    const execute = () => operation === 'add' ? f.driver.add(add!.step, add!.plan) : f.driver.fill(fill!.step, fill!.item, fill!.plan);
    await assert.rejects(execute(), error => {
      assert.ok(error instanceof Error); assert.equal(error.message, 'unclassified');
      assert.equal((error as Error & { cause?: unknown }).cause, undefined);
      assert.doesNotMatch(error.stack || '', /never-return|private\.invalid/u);
      assert.doesNotMatch(JSON.stringify(error), /never-return|private\.invalid/u); return true;
    });
    assert.deepEqual(f.driver.getSummary().lastFailure, { operation, reason: 'unclassified' });
    assert.doesNotMatch(JSON.stringify(f.driver.getSummary()), /never-return|private\.invalid/u);
    assert.equal(f.events.length, 0); assert.equal(f.inserts.length, 0); f.driver.dispose();
  }
});

test('an external error cannot impersonate a trusted native guard by setting its name or copying a familiar message', async () => {
  const f = fixture(), approved = await planFor(f); await f.driver.start();
  const failure = new Error('飞书浏览器失焦或隐藏，本次填写已停止。 injected-private-secret'); failure.name = 'TrustedFeishuNativeError';
  f.onRead(() => { throw failure; });
  await assert.rejects(f.driver.fill(approved.step, approved.item, approved.plan), error => error instanceof Error && error.message === 'unclassified');
  assert.deepEqual(f.driver.getSummary().lastFailure, { operation: 'fill', reason: 'unclassified' });
  assert.doesNotMatch(JSON.stringify(f.driver.getSummary()), /injected-private-secret/u); assert.equal(f.events.length, 0); f.driver.dispose();
});
