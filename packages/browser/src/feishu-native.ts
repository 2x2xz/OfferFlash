import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow, WebContentsView, MouseInputEvent, MouseWheelInputEvent, KeyboardInputEvent } from 'electron';
import type { BrowserBounds, Profile } from '../../shared/src/contracts.js';
import { matchSelectOption } from '../../forms/src/index.js';
import { RetryableFieldPreparationError } from '../../forms/src/fill-retry.js';
import { careerGroupSignature, validateCareerAddStep, validateCareerGroupFill,
  type CareerAddGroupStep, type CareerFieldKey, type CareerFillGroupStep, type CareerFillPlan,
  type CareerFormCollection, type CareerFormObservation, type CareerPlannedField } from '../../forms/src/career-plan.js';
import * as scripts from './feishu-scripts.js';

/** Only errors constructed in this host module can contribute a diagnostic reason. */
class TrustedFeishuNativeError extends Error {}

type ScriptSet = ReturnType<typeof scripts.createFeishuFixtureScripts>;
type Point = { x: number; y: number };
interface RawField {
  fieldId: string; path: string; property: string; kind: scripts.FeishuCareerKind; key: string;
  type: string; side?: scripts.FeishuDateSide; value: string; identity: string; editable: boolean;
  bounds: BrowserBounds; required?: boolean; year?: string; month?: string; untilNow?: boolean; supportsUntilNow?: boolean;
}
interface RawGroup { id: string; kind: scripts.FeishuCareerKind; key: string; identity: string; fields: RawField[]; }
interface RawAdd { id: string; kind: scripts.FeishuCareerKind; identity: string; enabled: boolean; bounds: BrowserBounds; }
interface RawPage { url: string; supported: boolean; reason: string; groups: RawGroup[]; addControls: RawAdd[]; protectedControls: Array<Record<string, unknown>>; }
interface Option { index: number; id: string; label: string; selected: boolean; identity: string; bounds: BrowserBounds; }
interface SelectRead { owner: { identity: string; value: string; focused: boolean } | null;
  popup: { identity: string; options: Option[] } | null; }
interface MonthOption { value: string; selected: boolean; identity: string; bounds: BrowserBounds; }
interface MonthScrollState { scrollingX: boolean; scrollingY: boolean; }
interface MonthColumn { kind: 'year' | 'month'; identity: string; bounds: BrowserBounds; scrollTop: number; scrollHeight: number; clientHeight: number; options: MonthOption[]; scrollState?: MonthScrollState; }
interface MonthRead { popup: { identity: string; field: RawField; focused: boolean; columns: MonthColumn[] } | null; }

export interface FeishuSelectCheck {
  popupIdentityEqual: boolean; optionsIdentitiesEqual: boolean; optionsGeometryStable: boolean; selectedStatesEqual: boolean;
  ownerIdentityEqual: boolean; hitExists: boolean; hitUncovered: boolean; hitFocused: boolean; ownerBindingEqual: boolean; valueUnchanged: boolean;
}
export interface FeishuMonthCheck {
  popupIdentityEqual: boolean; columnIdentityEqual: boolean; optionIdentityEqual: boolean; geometryStable: boolean;
  selectedStatesEqual: boolean; hitExists: boolean; hitUncovered: boolean; hitFocused: boolean; fieldBindingEqual: boolean; valueAuthorized: boolean;
}
export interface FeishuMonthHitMeta { tag: string; classes: string[]; numericDataCy?: string; }
export interface FeishuMonthGeometry {
  optionBounds: BrowserBounds; columnBounds: BrowserBounds; viewport: { width: number; height: number }; point: Point;
  centerInsideColumn: boolean; hit: FeishuMonthHitMeta;
}
export interface FeishuAddCheck { exists: boolean; uncovered: boolean; identityEqual: boolean; geometryStable: boolean; kind: scripts.FeishuCareerKind | 'unknown'; }
export interface FeishuAddGeometry { bounds: BrowserBounds; viewport: { width: number; height: number }; point: Point; hit: FeishuMonthHitMeta; }
export interface FeishuMonthScrollCheck { popupIdentityEqual: boolean; columnIdentityEqual: boolean; geometryStable: boolean; focused: boolean;
  beforeScrollTop: number; afterScrollTop?: number; beforeState?: MonthScrollState; afterState?: MonthScrollState; }
export interface FeishuNativeSummary { clicks: number; textInputs: number; pageWheels: number; monthWheels: number; occlusionWaits: number; started: boolean; interrupted: boolean; lastSelectCheck?: FeishuSelectCheck; lastMonthCheck?: FeishuMonthCheck; lastMonthGeometry?: FeishuMonthGeometry; lastMonthScrollCheck?: FeishuMonthScrollCheck; lastAddCheck?: FeishuAddCheck; lastAddGeometry?: FeishuAddGeometry; lastFailure?: { operation: 'add' | 'fill'; reason: string }; }
export interface FeishuFieldActivity { phase: 'approach' | 'typing' | 'verified'; bounds: BrowserBounds; }
export interface FeishuCareerDriverOptions {
  window: BrowserWindow; view: WebContentsView; getProfile(): Profile | Promise<Profile>;
  getGeneration(): number; isVisible(): boolean; signal?: AbortSignal;
  /** Absolute performance.now() deadline, shared with the caller's authorization. */
  deadline: number;
  /** Only produced by the --smoke-test-gated factory. Never accepted over IPC. */
  fixtureScripts?: ScriptSet;
  /** Host-only optional decoration. Never carries a field identifier, value or input capability. */
  onFieldActivity?(target: FeishuFieldActivity): void;
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const collection: Record<scripts.FeishuCareerKind, CareerFormCollection> = { education: 'educations', internship: 'internships', project: 'projects' };
const kindFor: Record<CareerFormCollection, scripts.FeishuCareerKind> = { educations: 'education', internships: 'internship', projects: 'project' };
const fieldKeys: Record<string, CareerFieldKey> = { school: 'school', degree: 'degree', fieldOfStudy: 'major', company: 'organization', title: 'role', desc: 'description', name: 'name', role: 'role', link: 'url' };
const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrustedFeishuNativeError('飞书网页观察无效。');
  return value as Record<string, any>;
};
const bounds = (value: BrowserBounds): BrowserBounds => {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) throw new TrustedFeishuNativeError('飞书控件位置无效。');
  return value;
};
const near = (a: BrowserBounds, b: BrowserBounds) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key as keyof BrowserBounds] - b[key as keyof BrowserBounds]) <= 0.5);

/** Native-only execution for the reviewed Feishu legacy form. It never submits, retries, deletes or steals the foreground. */
export class FeishuCareerDriver {
  readonly signal?: AbortSignal;
  private readonly code: ScriptSet;
  private readonly url: string;
  private readonly generation: number;
  private profileSnapshot?: Profile;
  private started = false;
  private disposed = false;
  private interrupted = false;
  private poisoned = false;
  private pendingMutation?: Promise<void>;
  private viewport?: { width: number; height: number };
  private summary: FeishuNativeSummary = { clicks: 0, textInputs: 0, pageWheels: 0, monthWheels: 0, occlusionWaits: 0, started: false, interrupted: false };
  private readonly onBlur = () => { if (this.started) { this.interrupted = true; this.summary.interrupted = true; } };

  constructor(private readonly options: FeishuCareerDriverOptions) {
    if (!Number.isFinite(options.deadline)) throw new TrustedFeishuNativeError('飞书执行截止时间无效。');
    this.signal = options.signal;
    this.code = options.fixtureScripts ?? scripts;
    this.url = options.view.webContents.getURL(); this.generation = options.getGeneration();
    this.base();
  }

  getSummary(): FeishuNativeSummary { return structuredClone(this.summary); }
  private fieldActivity(phase: FeishuFieldActivity['phase'], fieldBounds: BrowserBounds): void {
    try {
      const { x, y, width, height } = fieldBounds;
      // Do not await optional UI work or let a thrown callback/rejected thenable affect the native path.
      void Promise.resolve(this.options.onFieldActivity?.({ phase, bounds: { x, y, width, height } })).catch(() => undefined);
    } catch { /* Decoration has no authority over the fill result. */ }
  }
  /** A timed-out insertText is not cancelled by Promise.race. Keep the host's write lock until this settles or the old view is destroyed. */
  hasPendingMutation(): boolean { return Boolean(this.pendingMutation); }
  waitForPendingMutation(): Promise<void> { return this.pendingMutation?.then(() => undefined, () => undefined) ?? Promise.resolve(); }
  dispose(): void { this.disposed = true; this.options.window.removeListener('blur', this.onBlur); }
  private base(): void {
    if (this.disposed || this.poisoned) throw new TrustedFeishuNativeError('本次飞书执行已停止，不能继续或自动重试。');
    if (this.signal?.aborted || performance.now() >= this.options.deadline) throw new TrustedFeishuNativeError('本次飞书操作已取消或超时。');
    if (this.options.view.webContents.isDestroyed() || this.options.window.isDestroyed()
      || this.options.view.webContents.getURL() !== this.url || this.options.getGeneration() !== this.generation) throw new TrustedFeishuNativeError('飞书网页或页面代次已变化。');
  }
  assertActive(): void {
    this.base();
    if (!this.started || this.interrupted || !this.options.isVisible() || !this.options.window.isFocused()
      || !this.options.view.webContents.isFocused()) throw new TrustedFeishuNativeError('飞书浏览器失焦或隐藏，本次填写已停止。');
    if (this.options.view.webContents.getZoomFactor() !== 1) throw new TrustedFeishuNativeError('网页缩放已变化，请重新观察。');
    const size = this.options.view.getBounds();
    if (this.viewport && (this.viewport.width !== size.width || this.viewport.height !== size.height)) throw new TrustedFeishuNativeError('网页可用区域已变化，请重新观察。');
  }
  async start(): Promise<void> {
    this.base();
    if (this.started || !this.options.isVisible() || !this.options.window.isFocused()) throw new TrustedFeishuNativeError('请先把飞书测试窗口保持在前台，再开始填写。');
    await this.getProfile();
    this.base();
    if (!this.options.isVisible() || !this.options.window.isFocused()) throw new TrustedFeishuNativeError('开始期间窗口失去前台，未获取网页焦点。');
    this.started = true; this.summary.started = true;
    this.options.window.on('blur', this.onBlur);
    const size = this.options.view.getBounds();
    if (size.width < 100 || size.height < 100) throw new TrustedFeishuNativeError('飞书网页区域不可用。');
    this.viewport = { width: size.width, height: size.height };
    // The caller already owns the foreground. This only transfers focus from
    // its own renderer to its own web view, once; it never activates a window.
    this.options.view.webContents.focus();
    const until = Math.min(this.options.deadline, performance.now() + 600);
    while (!this.options.view.webContents.isFocused()) {
      this.base();
      if (this.interrupted || !this.options.window.isFocused() || !this.options.isVisible() || performance.now() >= until) throw new TrustedFeishuNativeError('网页未取得稳定输入焦点。');
      await delay(25);
    }
    this.assertActive();
  }
  private async bounded<T>(operation: Promise<T>, maxMs = 1500): Promise<T> {
    this.base(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { this.poisoned = true; reject(new TrustedFeishuNativeError('飞书页面单步读取超时，停止后续动作。')); }, Math.max(1, Math.min(maxMs, this.options.deadline - performance.now())));
      })]);
      this.base(); return result;
    } finally { if (timer) clearTimeout(timer); }
  }
  private async js<T = Record<string, any>>(source: string): Promise<T> {
    this.base(); const result = await this.bounded(this.options.view.webContents.executeJavaScript(source));
    if (this.started) this.assertActive();
    const data = record(result);
    if (data.url !== this.url) throw new TrustedFeishuNativeError('读取期间飞书网页地址已变化。');
    return data as T;
  }
  async getProfile(): Promise<Profile> {
    this.base(); const profile = await this.bounded(Promise.resolve(this.options.getProfile()));
    if (this.profileSnapshot && !equal(profile, this.profileSnapshot)) throw new TrustedFeishuNativeError('个人资料或确认修订已变化。');
    this.profileSnapshot ??= structuredClone(profile); return profile;
  }
  private async raw(): Promise<RawPage> {
    if (this.started) this.assertActive();
    await this.getProfile();
    const page = await this.js<RawPage>(this.code.READ_FEISHU_CAREER);
    if (page.supported !== true || !Array.isArray(page.groups) || !Array.isArray(page.addControls) || !Array.isArray(page.protectedControls)
      || page.groups.length > 90 || page.addControls.length > 3 || page.protectedControls.length > 500) throw new TrustedFeishuNativeError('当前飞书表单结构尚未核实，停止原生操作。');
    return page;
  }
  private normalize(page: RawPage): CareerFormObservation {
    const groups = page.groups.map(group => {
      if (!collection[group.kind] || !group.id || !group.identity || !Array.isArray(group.fields) || group.fields.length > 30) throw new TrustedFeishuNativeError('飞书经历组身份无效。');
      const fields = group.fields.map(field => {
        const key = field.property === 'period' ? field.side === 'start' ? 'startDate' : field.side === 'end' ? 'endDate' : undefined : fieldKeys[field.property];
        if (!key || !field.identity || typeof field.value !== 'string' || field.value.length > 20000 || typeof field.editable !== 'boolean') throw new TrustedFeishuNativeError('飞书经历字段身份无效。');
        const type = field.type === 'feishu-single-select' ? 'combobox' : field.type;
        return { id: field.fieldId, key, type, value: field.value, editable: field.editable,
          signature: hash([field.fieldId, field.identity, type, field.editable, field.required]),
          ...(field.required === undefined ? {} : { required: field.required }),
          ...(type === 'feishu-month' ? { datePrecision: 'month' as const } : {}),
          ...(type === 'feishu-month' && field.side === 'end' && field.supportsUntilNow === true
            && ['internship', 'project'].includes(field.kind) ? { supportsUntilNow: true } : {}),
          ...(type === 'combobox' ? { customSelectSupported: true } : {}) };
      });
      const data = { id: group.id, collection: collection[group.kind], fields };
      return { ...data, signature: careerGroupSignature(data) };
    });
    const addControls = page.addControls.map(control => ({ id: control.id, collection: collection[control.kind],
      signature: hash(control.identity), enabled: control.enabled === true }));
    const protectedFields = page.protectedControls.map((control, index) => ({ id: `protected-${index}`,
      signature: hash([control.identity, control.disabled, control.readOnly, control.sensitive]),
      value: typeof control.value === 'string' ? control.value + (control.files || control.selectedLabels || control.ariaValueText !== undefined
        ? '|metadata:' + hash([control.files, control.selectedLabels, control.ariaValueText]) : '') : '',
      checked: control.checked === true }));
    return { id: randomUUID(), url: page.url, generation: this.generation, signature: hash([groups.map(group => group.signature), addControls, protectedFields.map(field => field.signature)]),
      groups, addControls, protectedFields };
  }
  async read(): Promise<CareerFormObservation> { return this.normalize(await this.raw()); }
  private async checkpoint(plan: CareerFillPlan, fieldId?: string, allowed: readonly string[] = []): Promise<RawPage> {
    this.assertActive();
    return this.validateCheckpoint(plan, await this.raw(), fieldId, allowed);
  }
  private validateCheckpoint(plan: CareerFillPlan, raw: RawPage, fieldId?: string, allowed: readonly string[] = []): RawPage {
    this.assertActive();
    if (raw.url !== this.url || raw.supported !== true || !Array.isArray(raw.groups) || !Array.isArray(raw.addControls) || !Array.isArray(raw.protectedControls)
      || raw.groups.length > 90 || raw.addControls.length > 3 || raw.protectedControls.length > 500) throw new TrustedFeishuNativeError('当前飞书表单结构尚未核实，停止原生操作。');
    const normalized = this.normalize(raw), baseline = plan.original;
    if (plan.profileVersion !== this.profileSnapshot?.version || plan.url !== this.url || plan.generation !== this.generation
      || normalized.signature !== baseline.signature || !equal(normalized.addControls, baseline.addControls)
      || !equal(normalized.protectedFields, baseline.protectedFields) || normalized.groups.length !== baseline.groups.length) throw new TrustedFeishuNativeError('页面、资料或非目标控件已变化。');
    const projected = structuredClone(normalized.groups);
    if (fieldId) {
      const before = baseline.groups.flatMap(group => group.fields).find(field => field.id === fieldId);
      const current = projected.flatMap(group => group.fields).find(field => field.id === fieldId);
      if (!before || !current || !allowed.includes(current.value)) throw new TrustedFeishuNativeError('目标字段原值或中间结果与授权不符。');
      current.value = before.value;
    }
    if (!equal(projected, baseline.groups)) throw new TrustedFeishuNativeError('其他经历或字段已变化，停止填写。');
    this.assertActive(); return raw;
  }
  private field(page: RawPage, fieldId: string): RawField {
    const fields = page.groups.flatMap(group => group.fields).filter(field => field.fieldId === fieldId);
    if (fields.length !== 1) throw new TrustedFeishuNativeError('飞书目标字段不唯一。');
    bounds(fields[0]!.bounds); return fields[0]!;
  }
  private async pause(ms: number): Promise<void> { this.assertActive(); await delay(ms); this.assertActive(); }
  private input(event: MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent): void { this.assertActive(); this.options.view.webContents.sendInputEvent(event); this.assertActive(); }
  private click(point: Point): void {
    this.input({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    this.input({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); this.summary.clicks++;
  }
  private center(rect: BrowserBounds): Point {
    bounds(rect); const size = this.options.view.getBounds();
    const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
    if (x < 2 || x >= size.width - 2 || y < 2 || y >= size.height - 2) throw new TrustedFeishuNativeError('控件中心尚未进入网页可见区域。');
    return { x, y };
  }
  private inViewport(rect: BrowserBounds): boolean {
    // Match the actual integer input point; a fractional center can round onto the excluded margin.
    const size = this.options.view.getBounds(), x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
    return x >= 2 && x < size.width - 2 && y >= 2 && y < size.height - 2;
  }
  private monthPoint(option: BrowserBounds, column: BrowserBounds): Point | undefined {
    bounds(option); bounds(column); const size = this.options.view.getBounds();
    const left = Math.max(option.x, column.x, 0) + 2, right = Math.min(option.x + option.width, column.x + column.width, size.width) - 2;
    const top = Math.max(option.y, column.y, 0) + 2, bottom = Math.min(option.y + option.height, column.y + column.height, size.height) - 2;
    if (right - left < 4 || bottom - top < 4) return undefined;
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  }
  private monthHitMeta(value: unknown): FeishuMonthHitMeta {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const tags = new Set(['div', 'span', 'ul', 'li', 'input', 'button', 'body', 'html', 'svg', 'path', 'section', 'main', 'p', 'label']);
    const known = new Set(['atsx-date-picker-period-month-panel', 'atsx-date-picker-period-month-panel-list',
      'atsx-date-picker-period-month-panel-list-item', 'atsx-date-picker-period-month-panel-list-item-selected',
      'atsx-date-picker-period-month-panel-list-item-focused', 'atsx-date-picker-period-month-label',
      'atsx-date-picker-period-month-label-year', 'atsx-date-picker-period-month-label-month', 'atsx-date-picker-dropdown',
      'ps', 'ps--active-x', 'ps--active-y', 'ps__rail-y', 'ps__rail-x', 'ps__thumb-y', 'ps__thumb-x',
      'addMore-add', 'addMore-plus', 'addMore__d36c7e', 'createFormSection-addBtn', 'createFormSection__740cd1',
      'createFormSection-container', 'createFormSection-container-empty', 'formOperate-addBtn', 'formOperate-addBtn-container',
      'formOperate-removeBtn', 'formOperate-removeBtn-container', 'formOperate-remove', 'formOperate-hidden']);
    const classes = Array.isArray(raw.classes) ? raw.classes.filter((entry): entry is string => typeof entry === 'string' && known.has(entry)).slice(0, 12) : [];
    return { tag: typeof raw.tag === 'string' && tags.has(raw.tag) ? raw.tag : 'other', classes,
      ...(classes.some(value => value.startsWith('atsx-date-picker-period-month-panel-list-item')) && typeof raw.numericDataCy === 'string'
        && /^(?:0[1-9]|1[0-2]|\d{4})$/.test(raw.numericDataCy) ? { numericDataCy: raw.numericDataCy } : {}) };
  }
  private async pageWheel(plan: CareerFillPlan, pixels: number, fieldId?: string, allowed: readonly string[] = []): Promise<void> {
    const size = this.options.view.getBounds();
    for (const x of [Math.max(4, size.width - 12), 12, Math.round(size.width / 2)]) {
      const point = { x, y: Math.round(size.height / 2) };
      const first = await this.js(this.code.readFeishuPageWheelTarget(point.x, point.y));
      if (!first.allowed || !first.identity) continue;
      this.input({ type: 'mouseMove', ...point }); await this.pause(20);
      await this.checkpoint(plan, fieldId, allowed);
      const next = await this.js(this.code.readFeishuPageWheelTarget(point.x, point.y));
      if (!next.allowed || first.identity !== next.identity) throw new TrustedFeishuNativeError('滚动区域被遮挡或变化。');
      this.input({ type: 'mouseWheel', ...point, deltaX: 0, deltaY: -Math.max(-400, Math.min(400, pixels)), hasPreciseScrollingDeltas: true });
      this.summary.pageWheels++; return;
    }
    throw new TrustedFeishuNativeError('没有可核实的网页滚动区域。');
  }
  private async stableField(plan: CareerFillPlan, fieldId: string, allowed: readonly string[]): Promise<RawField> {
    const until = Math.min(this.options.deadline, performance.now() + 1600); let last: RawField | undefined, since = performance.now();
    for (let sample = 0; sample < 34; sample++) {
      const field = this.field(await this.checkpoint(plan, fieldId, allowed), fieldId);
      if (!last || !near(field.bounds, last.bounds)) { last = field; since = performance.now(); }
      else if (performance.now() - since >= 120) return field;
      if (performance.now() >= until) break;
      await this.pause(40);
    }
    throw new TrustedFeishuNativeError('字段位置持续变化，停止点击。');
  }
  private async fieldPoint(plan: CareerFillPlan, fieldId: string, allowed: readonly string[]): Promise<Point> {
    for (let step = 0; step <= 8; step++) {
      const field = await this.stableField(plan, fieldId, allowed);
      if (this.inViewport(field.bounds)) {
        const point = this.center(field.bounds);
        this.input({ type: 'mouseMove', ...point }); await this.pause(20);
        const hovered = this.field(await this.checkpoint(plan, fieldId, allowed), fieldId);
        const hit = await this.js(this.code.readFeishuCareerTarget(fieldId, point.x, point.y));
        if (near(field.bounds, hovered.bounds) && hit.exists && hit.uncovered && hit.field?.identity === field.identity && allowed.includes(hit.field?.value)) return point;
        if (!near(field.bounds, hovered.bounds)) throw new TrustedFeishuNativeError('移动鼠标后字段位置变化。');
      }
      if (step === 8) break;
      const size = this.options.view.getBounds();
      const pixels = Math.max(-400, Math.min(400, field.bounds.y + field.bounds.height / 2 - size.height / 2));
      if (Math.abs(pixels) < 20) throw new TrustedFeishuNativeError('字段仍被遮挡，不点击浮层。');
      await this.pageWheel(plan, pixels, fieldId, allowed);
      const until = Math.min(this.options.deadline, performance.now() + 2000); let moved = false, lastY = field.bounds.y, stableSince = performance.now();
      for (let sample = 0; sample < 40; sample++) {
        await this.pause(50); const next = this.field(await this.checkpoint(plan, fieldId, allowed), fieldId);
        moved ||= Math.abs(next.bounds.y - field.bounds.y) > 0.5;
        if (Math.abs(next.bounds.y - lastY) > 0.5) stableSince = performance.now();
        lastY = next.bounds.y;
        if (moved && performance.now() - stableSince >= 200) break;
        if (performance.now() >= until || sample === 39) throw new TrustedFeishuNativeError('原生滚动无进展或没有稳定。');
      }
    }
    throw new TrustedFeishuNativeError('字段尚未滚到可核实区域。');
  }
  private async clickField(plan: CareerFillPlan, fieldId: string, allowed: readonly string[]): Promise<void> {
    const point = await this.fieldPoint(plan, fieldId, allowed);
    const field = this.field(await this.checkpoint(plan, fieldId, allowed), fieldId);
    const hit = await this.js(this.code.readFeishuCareerTarget(fieldId, point.x, point.y));
    if (!hit.exists || !hit.uncovered || hit.field?.identity !== field.identity || !allowed.includes(hit.field?.value)) throw new TrustedFeishuNativeError('点击前字段命中或原值发生变化。');
    this.fieldActivity('approach', field.bounds);
    this.click(point);
  }
  private async verifyStable(plan: CareerFillPlan, fieldId: string, expected: string, intermediate: readonly string[] = ['']): Promise<RawField> {
    const until = Math.min(this.options.deadline, performance.now() + 900); let since: number | undefined, seenExpected = false;
    for (let sample = 0; sample < 24; sample++) {
      const field = this.field(await this.checkpoint(plan, fieldId, [...intermediate, expected]), fieldId);
      if (seenExpected && field.value !== expected) throw new TrustedFeishuNativeError('网页曾显示结果后又回退，停止核实。');
      if (field.value === expected) seenExpected = true;
      const hit = await this.js(this.code.readFeishuCareerTarget(fieldId, field.bounds.x + field.bounds.width / 2, field.bounds.y + field.bounds.height / 2));
      if (hit.exists && hit.valid === true && hit.field?.value === expected) {
        since ??= performance.now(); if (performance.now() - since >= 120) return field;
      } else since = undefined;
      if (performance.now() >= until) break;
      await this.pause(40);
    }
    throw new TrustedFeishuNativeError('网页没有稳定保留预期结果。');
  }
  async add(step: CareerAddGroupStep, plan: CareerFillPlan): Promise<void> {
    return this.observed('add', () => this.addNative(step, plan));
  }
  private async observed<T>(operation: 'add' | 'fill', work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      const trusted = error instanceof TrustedFeishuNativeError;
      this.summary.lastFailure = { operation, reason: trusted ? error.message : 'unclassified' };
      // Provider/page/store errors can include private values or URLs. Neither
      // their message, stack, cause nor arbitrary properties leave this method.
      if (trusted) throw error;
      throw new TrustedFeishuNativeError('unclassified');
    }
  }
  private async addNative(step: CareerAddGroupStep, plan: CareerFillPlan): Promise<void> {
    const initial = await this.read(); validateCareerAddStep(plan, step, initial, await this.getProfile());
    const kind = kindFor[step.collection];
    for (let wheel = 0; wheel <= 8; wheel++) {
      let raw = await this.checkpoint(plan), adds = raw.addControls.filter(control => control.id === step.controlId && control.kind === kind);
      if (adds.length !== 1 || !adds[0]!.enabled || hash(adds[0]!.identity) !== step.controlSignature) throw new TrustedFeishuNativeError('新增入口与本次绑定不符。');
      let add = adds[0]!, stableSince = performance.now(); const until = Math.min(this.options.deadline, performance.now() + 1600);
      for (let sample = 0; ; sample++) {
        await this.pause(40); raw = await this.checkpoint(plan); adds = raw.addControls.filter(control => control.id === step.controlId && control.kind === kind);
        if (adds.length !== 1 || !adds[0]!.enabled || hash(adds[0]!.identity) !== step.controlSignature) throw new TrustedFeishuNativeError('新增入口身份变化。');
        if (!near(add.bounds, adds[0]!.bounds)) stableSince = performance.now();
        add = adds[0]!;
        if (performance.now() - stableSince >= 120) break;
        if (sample >= 33 || performance.now() >= until) throw new TrustedFeishuNativeError('新增入口位置持续变化。');
      }
      let targetCovered = false;
      if (this.inViewport(add.bounds)) {
        const point = this.center(add.bounds); this.input({ type: 'mouseMove', ...point }); await this.pause(20);
        const inspect = async () => {
          await this.checkpoint(plan);
          const hit = await this.js(this.code.readFeishuAddTarget(kind, point.x, point.y));
          const observedKind = ['education', 'internship', 'project'].includes(hit.control?.kind) ? hit.control.kind as scripts.FeishuCareerKind : 'unknown';
          const check: FeishuAddCheck = { exists: hit.exists === true && hit.supported === true, uncovered: hit.uncovered === true,
            identityEqual: hit.control?.identity === add.identity && observedKind === kind,
            geometryStable: Boolean(hit.control?.bounds && near(hit.control.bounds, add.bounds)), kind: observedKind };
          this.summary.lastAddCheck = check;
          const size = this.options.view.getBounds();
          this.summary.lastAddGeometry = { bounds: { x: add.bounds.x, y: add.bounds.y, width: add.bounds.width, height: add.bounds.height },
            viewport: { width: size.width, height: size.height }, point: { x: point.x, y: point.y }, hit: this.monthHitMeta(hit.hitMeta) };
          return { check, hit };
        };
        const bound = (check: FeishuAddCheck) => check.exists && check.identityEqual && check.geometryStable && check.kind === kind;
        let probe = await inspect();
        if (!bound(probe.check)) throw new TrustedFeishuNativeError('新增入口被遮挡或变化。');
        if (!probe.check.uncovered && probe.hit.uncovered === false) {
          this.summary.occlusionWaits++;
          const until = Math.min(this.options.deadline, performance.now() + 3000);
          for (let sample = 0; sample < 38 && performance.now() < until; sample++) {
            await this.pause(Math.max(1, Math.min(80, until - performance.now()))); probe = await inspect();
            if (!bound(probe.check)) throw new TrustedFeishuNativeError('新增入口被遮挡或变化。');
            if (probe.check.uncovered) break;
          }
        }
        if (probe.check.uncovered) { this.click(point); await this.pause(120); await this.raw(); return; }
        if (probe.hit.uncovered !== false) throw new TrustedFeishuNativeError('新增入口被遮挡或变化。');
        targetCovered = true;
      }
      if (wheel === 8) break;
      const size = this.options.view.getBounds(), pixels = add.bounds.y + add.bounds.height / 2 - size.height / 2;
      if (targetCovered && Math.abs(pixels) <= 20) throw new TrustedFeishuNativeError('新增入口在中部仍被遮挡。');
      if (Math.abs(pixels) < 1) throw new TrustedFeishuNativeError('新增入口没有可核实的滚动方向。');
      await this.pageWheel(plan, pixels);
      let moved = false, lastY = add.bounds.y, stableAt = performance.now(); const scrollUntil = Math.min(this.options.deadline, performance.now() + 2000);
      for (let sample = 0; sample < 40; sample++) {
        await this.pause(50);
        const next = (await this.checkpoint(plan)).addControls.find(control => control.id === step.controlId && control.kind === kind);
        if (!next || next.identity !== add.identity) throw new TrustedFeishuNativeError('滚动期间新增入口身份变化。');
        moved ||= Math.abs(next.bounds.y - add.bounds.y) > 0.5;
        if (Math.abs(next.bounds.y - lastY) > 0.5) stableAt = performance.now();
        lastY = next.bounds.y;
        if (moved && performance.now() - stableAt >= 200) break;
        if (performance.now() >= scrollUntil || sample === 39) throw new TrustedFeishuNativeError('新增入口滚动无进展或不稳定。');
      }
    }
    throw new TrustedFeishuNativeError('新增入口未进入可核实区域。');
  }
  async fill(step: CareerFillGroupStep, item: CareerPlannedField, plan: CareerFillPlan): Promise<{ expectedValue: string }> {
    const inputsBefore = this.summary.textInputs;
    try { return await this.observed('fill', () => this.fillNative(step, item, plan)); }
    catch (error) {
      const field = plan.original.groups.flatMap(group => group.fields).find(field => field.id === item.fieldId);
      if (error instanceof TrustedFeishuNativeError && ['text', 'textarea', 'url'].includes(field?.type ?? '')
        && ['字段没有取得真实输入焦点。', '字段位置持续变化，停止点击。', '移动鼠标后字段位置变化。', '字段仍被遮挡，不点击浮层。', '原生滚动无进展或没有稳定。'].includes(error.message)
        && this.summary.textInputs === inputsBefore && !this.pendingMutation && !this.poisoned && !this.interrupted) {
        await this.checkpoint(plan, item.fieldId, [item.currentValue]);
        throw new RetryableFieldPreparationError(error.message);
      }
      throw error;
    }
  }
  private async fillNative(step: CareerFillGroupStep, item: CareerPlannedField, plan: CareerFillPlan): Promise<{ expectedValue: string }> {
    validateCareerGroupFill(plan, step, await this.read(), await this.getProfile());
    if (!step.items.some(candidate => equal(candidate, item)) || item.status !== 'ready' || !item.value.trim() || item.currentValue.trim()) throw new TrustedFeishuNativeError('字段不属于当前空白填写授权。');
    const raw = await this.checkpoint(plan, item.fieldId, [item.currentValue]), field = this.field(raw, item.fieldId);
    if (!field.editable) throw new TrustedFeishuNativeError('当前字段不可编辑。');
    if (field.type === 'feishu-single-select') return this.fillSelect(item, plan);
    if (field.type === 'feishu-month') return this.fillMonth(item, field, plan);
    if (!['text', 'textarea', 'url'].includes(field.type)) throw new TrustedFeishuNativeError('字段类型未核实。');
    await this.clickField(plan, item.fieldId, [item.currentValue]);
    const until = Math.min(this.options.deadline, performance.now() + 600); let focused = false;
    for (let sample = 0; sample < 25; sample++) {
      const current = this.field(await this.checkpoint(plan, item.fieldId, [item.currentValue]), item.fieldId);
      const target = await this.js(this.code.readFeishuCareerTarget(item.fieldId, current.bounds.x + current.bounds.width / 2, current.bounds.y + current.bounds.height / 2));
      if (target.focused && target.uncovered && target.field?.identity === field.identity) { focused = true; break; }
      if (performance.now() >= until) break; await this.pause(25);
    }
    if (!focused) throw new TrustedFeishuNativeError('字段没有取得真实输入焦点。');
    const beforeInsert = this.field(await this.checkpoint(plan, item.fieldId, [item.currentValue]), item.fieldId);
    const insertHit = await this.js(this.code.readFeishuCareerTarget(item.fieldId, beforeInsert.bounds.x + beforeInsert.bounds.width / 2, beforeInsert.bounds.y + beforeInsert.bounds.height / 2));
    if (!insertHit.focused || !insertHit.uncovered || insertHit.field?.identity !== field.identity || insertHit.field?.value !== item.currentValue) throw new TrustedFeishuNativeError('发送文字前字段焦点或原值变化。');
    this.fieldActivity('typing', beforeInsert.bounds);
    this.assertActive();
    const mutation = Promise.resolve(this.options.view.webContents.insertText(item.value));
    this.pendingMutation = mutation;
    // Disposal/timeout never clears a queued native mutation. Only its actual
    // settlement can release this signal; rejection carries no raw error out.
    void mutation.then(() => { if (this.pendingMutation === mutation) this.pendingMutation = undefined; },
      () => { if (this.pendingMutation === mutation) this.pendingMutation = undefined; });
    await this.bounded(mutation); this.summary.textInputs++; this.assertActive();
    const afterInsert = this.field(await this.checkpoint(plan, item.fieldId, [item.value]), item.fieldId);
    const tabHit = await this.js(this.code.readFeishuCareerTarget(item.fieldId, afterInsert.bounds.x + afterInsert.bounds.width / 2, afterInsert.bounds.y + afterInsert.bounds.height / 2));
    if (!tabHit.focused || tabHit.field?.identity !== field.identity || tabHit.field?.value !== item.value) throw new TrustedFeishuNativeError('离开字段前焦点或真实值变化，不发送后续按键。');
    this.input({ type: 'keyDown', keyCode: 'Tab' }); this.input({ type: 'keyUp', keyCode: 'Tab' });
    const verified = await this.verifyStable(plan, item.fieldId, item.value);
    this.fieldActivity('verified', verified.bounds); return { expectedValue: item.value };
  }
  private async fillSelect(item: CareerPlannedField, plan: CareerFillPlan): Promise<{ expectedValue: string }> {
    const before = this.field(await this.checkpoint(plan, item.fieldId, [item.currentValue]), item.fieldId);
    let popup = await this.js<SelectRead>(this.code.readFeishuSelectPopup(before.path));
    if (!popup.popup) await this.clickField(plan, item.fieldId, [item.currentValue]);
    // rc-select positions/animates its popup after the trigger click. Freeze a
    // real snapshot only after its complete geometry/options/selection have
    // stayed unchanged for 160ms, with every read retaining all page guards.
    const until = Math.min(this.options.deadline, performance.now() + 1600);
    let previous: SelectRead | undefined, stableSince = performance.now(), stable = false;
    for (let sample = 0; sample < 42; sample++) {
      await this.checkpoint(plan, item.fieldId, [item.currentValue]);
      const current = await this.js<SelectRead>(this.code.readFeishuSelectPopup(before.path));
      if (current.popup && current.owner?.focused && current.owner.identity === before.identity && current.owner.value === item.currentValue) {
        if (!previous || !equal(previous.popup, current.popup) || !equal(previous.owner, current.owner)) stableSince = performance.now();
        else if (performance.now() - stableSince >= 160) { popup = current; stable = true; break; }
        previous = current;
      } else { previous = undefined; stableSince = performance.now(); }
      if (performance.now() >= until) break;
      await this.pause(40);
    }
    if (!stable) throw new TrustedFeishuNativeError('学历弹层位置或选项未稳定。');
    if (!popup.popup || !popup.owner?.focused || popup.owner.identity !== before.identity || popup.owner.value !== item.currentValue) throw new TrustedFeishuNativeError('未观察到严格关联的学历选项。');
    const matching = matchSelectOption(item.value, popup.popup.options.map(option => ({ label: option.label, value: option.label })), 'degree');
    const found = popup.popup.options.filter(option => option.label === matching?.value);
    if (!matching || found.length !== 1) throw new TrustedFeishuNativeError('没有唯一的真实学历选项。');
    const option = found[0]!, point = this.center(option.bounds);
    this.input({ type: 'mouseMove', ...point }); await this.pause(20); await this.checkpoint(plan, item.fieldId, [item.currentValue]);
    const fresh = await this.js<SelectRead>(this.code.readFeishuSelectPopup(before.path));
    const hit = await this.js(this.code.readFeishuSelectOptionTarget(before.path, option.index, point.x, point.y));
    const check: FeishuSelectCheck = {
      popupIdentityEqual: Boolean(fresh.popup && fresh.popup.identity === popup.popup.identity),
      optionsIdentitiesEqual: Boolean(fresh.popup && equal(fresh.popup.options.map(entry => [entry.index, entry.id, entry.label, entry.identity]), popup.popup.options.map(entry => [entry.index, entry.id, entry.label, entry.identity]))),
      optionsGeometryStable: Boolean(fresh.popup && equal(fresh.popup.options.map(entry => entry.bounds), popup.popup.options.map(entry => entry.bounds))
        && hit.option?.bounds && near(hit.option.bounds, option.bounds)),
      selectedStatesEqual: Boolean(fresh.popup && equal(fresh.popup.options.map(entry => entry.selected), popup.popup.options.map(entry => entry.selected))),
      ownerIdentityEqual: fresh.owner?.identity === popup.owner.identity,
      hitExists: hit.exists === true, hitUncovered: hit.uncovered === true, hitFocused: hit.focused === true,
      ownerBindingEqual: hit.ownerIdentity === before.identity && hit.popupIdentity === popup.popup.identity && hit.option?.identity === option.identity,
      valueUnchanged: fresh.owner?.value === item.currentValue && hit.value === item.currentValue,
    };
    this.summary.lastSelectCheck = check;
    if (!Object.values(check).every(value => value === true) || !equal(fresh.popup, popup.popup)) throw new TrustedFeishuNativeError('学历选项在点击前变化。');
    this.click(point); const verified = await this.verifyStable(plan, item.fieldId, option.label);
    const afterPopup = await this.js<SelectRead>(this.code.readFeishuSelectPopup(before.path));
    if (afterPopup.popup && (afterPopup.popup.options.filter(entry => entry.selected).length !== 1
      || afterPopup.popup.options.find(entry => entry.selected)?.label !== option.label)) throw new TrustedFeishuNativeError('学历弹层没有唯一确认选中项。');
    this.fieldActivity('verified', verified.bounds);
    return { expectedValue: option.label };
  }
  private async fillMonth(item: CareerPlannedField, field: RawField, plan: CareerFillPlan): Promise<{ expectedValue: string }> {
    const present = item.value === '至今';
    const desired = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(item.value);
    if (!field.side || present && (field.side !== 'end' || item.key !== 'endDate' || field.supportsUntilNow !== true
      || !['internship', 'project'].includes(field.kind)) || !present && !desired) throw new TrustedFeishuNativeError('年月资料或控件端点未核实。');
    const side = field.side;
    const allowed = present ? [item.currentValue, '至今'] : [item.currentValue, desired![1]! + '-MM', item.value];
    await this.checkpoint(plan, item.fieldId, [item.currentValue]);
    const opened = (await this.js<MonthRead>(this.code.readFeishuMonthPopup(field.path, side))).popup;
    const other = (await this.js<MonthRead>(this.code.readFeishuMonthPopup(field.path, side === 'start' ? 'end' : 'start'))).popup;
    if (other || opened && (!opened.focused || opened.field.fieldId !== item.fieldId || opened.field.identity !== field.identity
      || opened.field.value !== item.currentValue)) throw new TrustedFeishuNativeError('已打开的年月弹层与当前端点不符。');
    await this.checkpoint(plan, item.fieldId, [item.currentValue]);
    // Completing a start date can automatically open this same record's end
    // popup. Its own panel may cover the trigger; never toggle it needlessly.
    if (!opened) { await this.clickField(plan, item.fieldId, [item.currentValue]); await this.pause(60); }
    await this.chooseMonthPart(plan, item, field.path, side, 'year', present ? '至今' : desired![1]!, allowed);
    if (!present) await this.chooseMonthPart(plan, item, field.path, side, 'month', desired![2]!, allowed);
    const verified = await this.verifyStable(plan, item.fieldId, item.value, allowed);
    if (present) {
      const selected = this.field(await this.checkpoint(plan, item.fieldId, ['至今']), item.fieldId);
      if (selected.side !== 'end' || selected.untilNow !== true || selected.value !== '至今') throw new TrustedFeishuNativeError('结束控件没有独立确认“至今”状态。');
    }
    this.fieldActivity('verified', verified.bounds);
    return { expectedValue: item.value };
  }
  private async chooseMonthPart(plan: CareerFillPlan, item: CareerPlannedField, path: string, side: scripts.FeishuDateSide,
    columnKind: 'year' | 'month', value: string, allowed: readonly string[]): Promise<void> {
    for (let wheel = 0; wheel <= 12; wheel++) {
      const popup = await this.stableMonthPopup(plan, item, path, side, allowed);
      const columns = popup.columns.filter(column => column.kind === columnKind);
      if (!popup || !popup.focused || columns.length !== 1 || popup.field.fieldId !== item.fieldId) throw new TrustedFeishuNativeError('未观察到绑定的年月弹层。');
      const column = columns[0]!, found = column.options.filter(option => option.value === value);
      if (found.length !== 1) throw new TrustedFeishuNativeError('年月列没有唯一真实选项。');
      const option = found[0]!, centerY = option.bounds.y + option.bounds.height / 2;
      const point = this.monthPoint(option.bounds, column.bounds);
      let targetCovered = false;
      if (point) {
        this.input({ type: 'mouseMove', ...point }); await this.pause(20);
        const inspect = async () => {
          await this.checkpoint(plan, item.fieldId, allowed);
          const latest = await this.js<MonthRead>(this.code.readFeishuMonthPopup(path, side));
          const hit = await this.js(this.code.readFeishuMonthOptionTarget(path, side, columnKind, value, point.x, point.y));
          // The end-only special option carries a synchronous full-page snapshot
          // from the same read as its hit proof, so late non-target changes cannot
          // hide between the earlier checkpoint and this option click.
          if (value === '至今') this.validateCheckpoint(plan, record(hit.observation) as unknown as RawPage, item.fieldId, allowed);
          const latestColumn = latest.popup?.columns.find(entry => entry.kind === columnKind);
          const actual = latestColumn?.options.find(entry => entry.value === value);
          const check: FeishuMonthCheck = {
          popupIdentityEqual: latest.popup?.identity === popup.identity && hit.popupIdentity === popup.identity,
          columnIdentityEqual: latestColumn?.identity === column.identity && hit.columnIdentity === column.identity,
          optionIdentityEqual: actual?.identity === option.identity && hit.option?.identity === option.identity,
          geometryStable: Boolean(actual && latestColumn && near(actual.bounds, option.bounds) && near(latestColumn.bounds, column.bounds)
            && hit.option?.bounds && near(hit.option.bounds, option.bounds)),
          selectedStatesEqual: actual?.selected === option.selected && hit.option?.selected === option.selected,
          hitExists: hit.exists === true, hitUncovered: hit.uncovered === true, hitFocused: hit.focused === true,
          fieldBindingEqual: latest.popup?.field.fieldId === item.fieldId && hit.field?.fieldId === item.fieldId
            && latest.popup?.field.identity === popup.field.identity && hit.field?.identity === popup.field.identity,
          valueAuthorized: Boolean(latest.popup && allowed.includes(latest.popup.field.value) && allowed.includes(hit.field?.value)),
          };
          this.summary.lastMonthCheck = check;
          const size = this.options.view.getBounds(), copyBounds = (rect: BrowserBounds) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          const centerX = option.bounds.x + option.bounds.width / 2;
          this.summary.lastMonthGeometry = { optionBounds: copyBounds(option.bounds), columnBounds: copyBounds(column.bounds),
            viewport: { width: size.width, height: size.height }, point: { x: point.x, y: point.y },
            centerInsideColumn: centerX >= column.bounds.x && centerX < column.bounds.x + column.bounds.width
              && centerY >= column.bounds.y && centerY < column.bounds.y + column.bounds.height,
            hit: this.monthHitMeta(hit.hitMeta) };
          return { check, hit };
        };
        const verified = (check: FeishuMonthCheck) => Object.values(check).every(value => value === true);
        const onlyCovered = (probe: Awaited<ReturnType<typeof inspect>>) => probe.hit.uncovered === false
          && Object.entries(probe.check).every(([key, result]) => key === 'hitUncovered' || result === true);
        let probe = await inspect();
        let pointerMovedDuringWait = false;
        if (onlyCovered(probe)) {
          this.summary.occlusionWaits++;
          // A toast may pause its own hide timer while hovered. Leave it only
          // through a separately proven, visible point in this same column.
          if (this.inViewport(column.bounds)) {
            const restingPoint = this.center(column.bounds);
            await this.checkpoint(plan, item.fieldId, allowed);
            const resting = await this.js(this.code.readFeishuMonthColumnTarget(path, side, columnKind, restingPoint.x, restingPoint.y));
            const boundColumn = (observed: Record<string, any>) => observed.exists === true && observed.focused === true
              && observed.columnIdentity === column.identity && observed.popupIdentity === popup.identity
              && observed.field?.identity === popup.field.identity && observed.field?.fieldId === item.fieldId && allowed.includes(observed.field?.value)
              && observed.column?.bounds && near(observed.column.bounds, column.bounds) && observed.column.scrollTop === column.scrollTop;
            if (boundColumn(resting) && resting.uncovered === true) {
              this.input({ type: 'mouseMove', ...restingPoint }); pointerMovedDuringWait = true; await this.pause(20);
              await this.checkpoint(plan, item.fieldId, allowed);
              const rested = await this.js(this.code.readFeishuMonthColumnTarget(path, side, columnKind, restingPoint.x, restingPoint.y));
              if (!boundColumn(rested)) throw new TrustedFeishuNativeError('年月滚动列被遮挡或变化。');
            }
            probe = await inspect();
            if (!verified(probe.check) && !onlyCovered(probe)) throw new TrustedFeishuNativeError('年月选项被遮挡或变化。');
          }
          const until = Math.min(this.options.deadline, performance.now() + 5000);
          for (let sample = 0; !verified(probe.check) && sample < 64 && performance.now() < until; sample++) {
            await this.pause(Math.max(1, Math.min(80, until - performance.now())));
            probe = await inspect();
            if (verified(probe.check)) break;
            if (!onlyCovered(probe)) throw new TrustedFeishuNativeError('年月选项被遮挡或变化。');
          }
        }
        if (verified(probe.check)) {
          if (pointerMovedDuringWait) {
            this.input({ type: 'mouseMove', ...point }); await this.pause(20); probe = await inspect();
            if (!verified(probe.check)) throw new TrustedFeishuNativeError('年月选项被遮挡或变化。');
          }
          this.click(point); await this.pause(80); await this.checkpoint(plan, item.fieldId, allowed); return;
        }
        // A fixed header can cover an otherwise correctly bound visible row.
        // Do not click it or change the match. Move this same row toward its
        // own column's center through the fully guarded native wheel below.
        if (!onlyCovered(probe)) throw new TrustedFeishuNativeError('年月选项被遮挡或变化。');
        targetCovered = true;
      }
      if (wheel === 12) break;
      const wheelPoint = this.center(column.bounds), pixels = Math.max(-400, Math.min(400, centerY - (column.bounds.y + column.bounds.height / 2)));
      const maxScroll = Math.max(0, column.scrollHeight - column.clientHeight);
      const scrollRoom = pixels > 0 ? column.scrollTop < maxScroll - 0.5 : column.scrollTop > 0.5;
      if (targetCovered && (Math.abs(pixels) < 20 || !scrollRoom)) throw new TrustedFeishuNativeError('年月选项持续被遮挡。');
      if (Math.abs(pixels) < 1) throw new TrustedFeishuNativeError('年月列没有可核实的滚动方向。');
      this.input({ type: 'mouseMove', ...wheelPoint }); await this.pause(20); await this.checkpoint(plan, item.fieldId, allowed);
      const hit = await this.js(this.code.readFeishuMonthColumnTarget(path, side, columnKind, wheelPoint.x, wheelPoint.y));
      if (!hit.exists || !hit.uncovered || !hit.focused || hit.columnIdentity !== column.identity || hit.popupIdentity !== popup.identity
        || !near(hit.column.bounds, column.bounds) || hit.column.scrollTop !== column.scrollTop) throw new TrustedFeishuNativeError('年月滚动列被遮挡或变化。');
      this.input({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -pixels, hasPreciseScrollingDeltas: true }); this.summary.monthWheels++;
      let moved = false, previous = column.scrollTop, stableAt = performance.now(); const until = Math.min(this.options.deadline, performance.now() + 2000);
      for (let sample = 0; sample < 40; sample++) {
        await this.pause(50); await this.checkpoint(plan, item.fieldId, allowed);
        const current = (await this.js<MonthRead>(this.code.readFeishuMonthPopup(path, side))).popup;
        const next = current?.columns.find(entry => entry.kind === columnKind);
        const state = (value: MonthScrollState | undefined) => value && typeof value.scrollingX === 'boolean' && typeof value.scrollingY === 'boolean'
          ? { scrollingX: value.scrollingX, scrollingY: value.scrollingY } : undefined;
        const check: FeishuMonthScrollCheck = { popupIdentityEqual: current?.identity === popup.identity,
          columnIdentityEqual: next?.identity === column.identity, geometryStable: Boolean(next && near(next.bounds, column.bounds)),
          focused: current?.focused === true, beforeScrollTop: column.scrollTop,
          ...(next && Number.isFinite(next.scrollTop) ? { afterScrollTop: next.scrollTop } : {}),
          ...(state(column.scrollState) ? { beforeState: state(column.scrollState) } : {}),
          ...(state(next?.scrollState) ? { afterState: state(next?.scrollState) } : {}) };
        this.summary.lastMonthScrollCheck = check;
        if (!current || !next || !check.popupIdentityEqual || !check.columnIdentityEqual || !check.geometryStable || !check.focused
          || !Number.isFinite(next.scrollTop)) throw new TrustedFeishuNativeError('年月滚动期间弹层已变化。');
        moved ||= Math.abs(next.scrollTop - column.scrollTop) > 0.5;
        if (Math.abs(next.scrollTop - previous) > 0.5) stableAt = performance.now();
        previous = next.scrollTop;
        if (moved && performance.now() - stableAt >= 120) break;
        if (performance.now() >= until || sample === 39) throw new TrustedFeishuNativeError('年月列滚动无进展或不稳定。');
      }
    }
    throw new TrustedFeishuNativeError('年月选项没有进入可核实区域。');
  }
  private async stableMonthPopup(plan: CareerFillPlan, item: CareerPlannedField, path: string, side: scripts.FeishuDateSide,
    allowed: readonly string[]): Promise<NonNullable<MonthRead['popup']>> {
    const until = Math.min(this.options.deadline, performance.now() + 1600);
    let previous: MonthRead['popup'] = null, stableSince = performance.now();
    for (let sample = 0; sample < 42; sample++) {
      await this.checkpoint(plan, item.fieldId, allowed);
      const current = (await this.js<MonthRead>(this.code.readFeishuMonthPopup(path, side))).popup;
      if (current && current.focused && current.field.fieldId === item.fieldId && allowed.includes(current.field.value)) {
        if (!previous || !equal(previous, current)) stableSince = performance.now();
        else if (performance.now() - stableSince >= 160) return current;
        previous = current;
      } else { previous = null; stableSince = performance.now(); }
      if (performance.now() >= until) break;
      await this.pause(40);
    }
    throw new TrustedFeishuNativeError('年月弹层位置或选项未稳定。');
  }
}
