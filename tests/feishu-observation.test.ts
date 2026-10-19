import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import {
  FEISHU_READ_HELPERS, READ_FEISHU_CAREER, createFeishuFixtureScripts, readFeishuAddTarget, readFeishuCareerTarget, readFeishuMonthColumnTarget, readFeishuMonthOptionTarget,
  readFeishuMonthPopup, readFeishuSelectOptionTarget, readFeishuSelectPopup,
  readFeishuPageWheelTarget,
  revealFeishuCareerField,
} from '../packages/browser/src/feishu-scripts.js';
import { locationObservationSnapshot } from '../packages/browser/src/read-scripts.js';

/** Original, minimum HTML based on public implementation shapes, never a real user's DOM. */
function observe(html: string, script = READ_FEISHU_CAREER, options: { url?: string; hit?: string; focused?: string; scrolls?: Array<{id:string;options:unknown}> } = {}): any {
  const xml = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'application/xhtml+xml');
  const before = new XMLSerializer().serializeToString(xml);
  class Element {
    readonly children: Element[];
    constructor(readonly node: XmlElement, readonly parentElement: Element | null) {
      this.children = [];
      for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) this.children.push(new Element(child as XmlElement, this));
    }
    get tagName() { return this.node.tagName.toUpperCase(); }
    get id() { return this.getAttribute('id') || ''; }
    get name() { return this.getAttribute('name') || ''; }
    get type() { return this.getAttribute('type') || 'text'; }
    get value() {
      if (this.getAttribute('data-assert-no-value-read') === 'true') throw new Error('fixture counter value must never be read');
      return this.getAttribute('value') || '';
    }
    get files() { return this.type === 'file' && this.hasAttribute('value') ? [{ name: this.getAttribute('value'), size: 20, type: 'text/plain', lastModified: 1 }] : []; }
    get hidden() { return this.hasAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); }
    get readOnly() { return this.hasAttribute('readonly'); }
    get checked() { return this.hasAttribute('checked'); }
    get textContent() { return this.node.textContent || ''; }
    get maxLength() { return Number(this.getAttribute('maxlength') || -1); }
    get scrollTop() { return Number(this.getAttribute('data-scroll-top') || 0); }
    get scrollHeight() { return Number(this.getAttribute('data-scroll-height') || 400); }
    get clientHeight() { return Number(this.getAttribute('data-client-height') || 160); }
    get validity() { return { valid: this.getAttribute('data-invalid') !== 'true' }; }
    getAttribute(name: string) { return this.node.getAttribute(name); }
    hasAttribute(name: string) { return this.node.hasAttribute(name); }
    matches(selector: string): boolean {
      return selector.split(',').some(part => {
        const value = part.trim();
        if (value.startsWith('.')) return (this.getAttribute('class') || '').split(/\s+/).includes(value.slice(1));
        const attr = /^([\w-]+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
        if (attr) return (!attr[1] || this.tagName.toLowerCase() === attr[1].toLowerCase())
          && (attr[3] === undefined ? this.hasAttribute(attr[2]!) : this.getAttribute(attr[2]!) === attr[3]);
        return this.tagName.toLowerCase() === value.toLowerCase();
      });
    }
    closest(selector: string): Element | null { for (let node: Element | null = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    contains(other: Element | null): boolean { for (let node = other; node; node = node.parentElement) if (node === this) return true; return false; }
    querySelectorAll(selector: string): Element[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    getBoundingClientRect() { return { x: Number(this.getAttribute('data-x') || 20), y: Number(this.getAttribute('data-y') || 40), width: 240, height: 32 }; }
    scrollIntoView(settings: unknown) { options.scrolls?.push({ id: this.id, options: JSON.parse(JSON.stringify(settings)) }); }
  }
  const root = new Element(xml.documentElement!, null);
  const byId = (id: string) => root.querySelectorAll('[id]').find(node => node.id === id) || null;
  const result = runInNewContext(script, {
    Element,
    document: { querySelectorAll: (selector: string) => root.querySelectorAll(selector), activeElement: byId(options.focused || ''), elementFromPoint: () => byId(options.hit || '') },
    location: new URL(options.url || 'https://modelbest.jobs.feishu.cn/resume/test-fixture'),
    getComputedStyle: (node: Element) => ({ display: node.hidden || /display\s*:\s*none/.test(node.getAttribute('style') || '') ? 'none' : 'block',
      visibility: /visibility\s*:\s*hidden/.test(node.getAttribute('style') || '') ? 'hidden' : 'visible' }),
  });
  assert.equal(new XMLSerializer().serializeToString(xml), before, 'all Feishu readers are read-only');
  return JSON.parse(JSON.stringify(result));
}

const section = (kind: string, content: string) => `<div class="createFormSection-container"><div class="createFormSection__740cd1 resumeEditForm-${kind}">${content}</div></div>`;
const add = (empty = false) => `<div id="add" class="${empty ? 'createFormSection-addBtn' : 'formOperate-addBtn'} addMore__d36c7e"><span class="addMore-add">添加</span></div>`;
const textField = (path: string, value = '') => `<div data-cy="${path}"><input id="${path}" data-cy="${path}Input" value="${value}"/></div>`;
const degree = (value = '', extra = '') => `<div data-cy="education[1].degree"><div class="atsx-select ${extra}"><div id="degree-owner" data-cy="education[1].degreeInput" class="atsx-select-selection atsx-select-selection--single" role="combobox" aria-controls="degree-popup" aria-expanded="true" aria-haspopup="true"><input id="degree-search" type="search" value=""/>${value ? `<div data-cy="selectedValue">${value}</div>` : ''}</div></div></div>`;
const period = (path: string, start = ['YYYY', 'MM'], end = ['YYYY', 'MM']) => `<div data-cy="${path}"><div data-cy="${path}Input" class="atsx-date-picker-period-month">
  <div id="start" data-cy="${path}InputBegin"><span data-cy="year">${start[0]}</span><span data-cy="month">${start[1]}</span></div>
  <div id="end" data-cy="${path}InputEnd"><span data-cy="year">${end[0]}</span><span data-cy="month">${end[1]}</span></div><input class="atsx-date-picker-period-hidden-input"/></div></div>`;
const group = (kind: string, fields: string) => `<div class="resumeEditForm-item resumeEditForm-${kind}">${fields}</div>`;
const degreePage = (value = '') => section('education', group('education', textField('education[1].school') + degree(value) + add()));
const selectPopup = `<div id="degree-popup"><ul role="listbox"><li id="master" role="option" aria-selected="false">硕士</li><li id="bachelor" role="option" aria-selected="true">本科</li></ul></div>`;
const presentOption = '<div id="present-option" data-cy="-" class="atsx-date-picker-period-month-panel-list-item">至今</div>';
const monthPopup = (path = 'education[1].period', side = 'Begin', present = false) => `<div data-cy="${path}Input${side}Dropdown" class="atsx-date-picker-period-month-panel">
  <div id="year-column" class="atsx-date-picker-period-month-panel-list" data-scroll-top="80">${present ? presentOption : ''}<div id="year2025" data-cy="2025" class="atsx-date-picker-period-month-panel-list-item">2025</div><div data-cy="2024">2024</div></div>
  <div class="atsx-date-picker-period-month-panel-list">${Array.from({ length: 12 }, (_, index) => `<div id="month${index + 1}" class="atsx-date-picker-period-month-panel-list-item${index === 8 ? '-selected' : ''}" data-cy="${String(index + 1).padStart(2, '0')}">${String(index + 1).padStart(2, '0')}</div>`).join('')}</div></div>`;

test('precise Feishu locator scrolls only the bound endpoint after a complete unchanged observation', () => {
  const page = section('education', group('education', textField('education[1].school') + period('education[1].period')));
  const expected = locationObservationSnapshot(observe(page)), scrolls: Array<{id:string;options:unknown}> = [];
  const result = observe(page, revealFeishuCareerField('education[1].period:end', expected), { scrolls });
  assert.equal(result.scrolled, true); assert.deepEqual(scrolls, [{ id: 'end', options: { behavior: 'instant', block: 'center', inline: 'nearest' } }]);
  assert.equal(observe(page, revealFeishuCareerField('education[9].period:end', expected)).reason, 'missing');
});

test('precise Feishu locator refuses another tenant, altered record facts or protected control changes', () => {
  const page = section('education', group('education', textField('education[1].school') + period('education[1].period')))
    + '<input id="preserved" type="checkbox" checked="checked"/>';
  const expected = locationObservationSnapshot(observe(page));
  for (const changed of [page.replace('value=""', 'value="别的学校"'), page.replace('checked="checked"', ''), page.replaceAll('education[1]', 'education[2]')]) {
    const scrolls: Array<{id:string;options:unknown}> = [];
    const result = observe(changed, revealFeishuCareerField('education[1].period:end', expected), { scrolls });
    assert.equal(result.scrolled, false); assert.equal(result.reason, 'changed'); assert.deepEqual(scrolls, []);
  }
  assert.equal(observe(page, revealFeishuCareerField('education[1].period:end', expected), {url:'https://other.jobs.feishu.cn/resume/test'}).reason, 'unsupported');
  assert.throws(() => revealFeishuCareerField('education[1].period:other', expected)); assert.throws(() => revealFeishuCareerField('education[1].school', ''));
  assert.doesNotMatch(revealFeishuCareerField('education[1].period:end', expected), /\.click\s*\(|\.focus\s*\(|dispatchEvent\s*\(|\.value\s*=/);
});

test('Feishu adapter scopes to reviewed tenant and fails closed for other origins or branches', () => {
  for (const url of ['https://other.jobs.feishu.cn/resume/fixture', 'http://modelbest.jobs.feishu.cn/resume/fixture', 'https://modelbest.jobs.feishu.cn.evil.invalid/resume', 'https://modelbest.jobs.feishu.cn:444/resume']) {
    assert.equal(observe(degreePage(), READ_FEISHU_CAREER, { url }).reason, 'unsupported-origin');
  }
  assert.equal(observe('<div data-field="education_list"><input/></div>').reason, 'legacy-form-not-observed');
  assert.equal(observe(degreePage()).supported, true);
});

test('legacy records retain stable nonzero and nonconsecutive form keys rather than guessed array positions', () => {
  const html = section('education', group('education', textField('education[1].school', '原创大学')) + group('education', textField('education[7].school') + add()))
    + section('internship', group('internship', textField('internship[3].company') + textField('internship[3].title') + add()))
    + section('project', add(true));
  const read = observe(html);
  assert.equal(read.supported, true);
  assert.deepEqual(read.groups.map((entry: any) => entry.id), ['education[1]', 'education[7]', 'internship[3]']);
  assert.deepEqual(read.addControls.map((entry: any) => entry.kind), ['education', 'internship', 'project']);
  assert.equal(read.groups[0].fields[0].value, '原创大学');
});

test('ambiguous duplicate sections, group keys, paths or cross-record wrappers are rejected', () => {
  for (const html of [degreePage() + degreePage(),
    section('education', group('education', textField('education[1].school')) + group('education', textField('education[1].school'))),
    section('education', group('education', textField('education[1].school') + textField('education[1].school'))),
    section('education', group('education', textField('education[1].school') + textField('education[2].fieldOfStudy'))),
    section('education', group('education', textField('internship[1].company'))),
  ]) assert.equal(observe(html).supported, false);
});

test('only explicitly related last-record or empty-section add div can be a native add target', () => {
  const ready = observe(degreePage(), readFeishuAddTarget('education', 30, 50), { hit: 'add' });
  assert.equal(ready.exists, true); assert.equal(ready.uncovered, true);
  assert.deepEqual(ready.hitMeta, { tag: 'div', classes: ['formOperate-addBtn', 'addMore__d36c7e'] });
  assert.deepEqual(ready.groupIds, ['education[1]']);
  assert.equal(observe(degreePage(), readFeishuAddTarget('education', 30, 50), { hit: 'master' }).uncovered, false);
  for (const badAdd of [add().replace('添加', '提交'), add().replace('<span', '<button type="submit"').replace('</span>', '</button>'),
    `<a href="/submit">${add()}</a>`, `<label>${add()}</label>`, add() + add()]) {
    assert.equal(observe(section('education', group('education', textField('education[1].school') + badAdd))).addControls.length, 0);
  }
  const wrongRecord = section('education', group('education', textField('education[1].school') + add()) + group('education', textField('education[2].school')));
  assert.equal(observe(wrongRecord).addControls.length, 0);
});

test('select observes selected label independently of search input and supports one controls wrapper listbox', () => {
  const html = degreePage('本科') + selectPopup;
  const result = observe(html);
  assert.equal(result.groups[0].fields[1].value, '本科');
  assert.equal(result.groups[0].fields[1].type, 'feishu-single-select');
  const popup = observe(html, readFeishuSelectPopup('education[1].degree'), { focused: 'degree-search' });
  assert.equal(popup.owner.focused, true);
  assert.deepEqual(popup.popup.options.map((entry: any) => [entry.label, entry.selected]), [['硕士', false], ['本科', true]]);
  const target = observe(html, readFeishuSelectOptionTarget('education[1].degree', 0, 30, 50), { hit: 'master', focused: 'degree-search' });
  assert.equal(target.exists, true); assert.equal(target.uncovered, true); assert.equal(target.focused, true);
});

test('select search text never becomes an empty or selected degree, and multi/tag mode is unsupported', () => {
  const searching = degreePage().replace('type="search" value=""', 'type="search" value="硕士"');
  assert.equal(observe(searching).supported, false);
  for (const mode of ['atsx-select-multiple', 'atsx-select-tags', 'atsx-select-combobox']) {
    assert.equal(observe(section('education', group('education', degree('', mode)))).supported, false);
  }
  assert.equal(observe(degreePage().replace('aria-controls="degree-popup"', 'aria-controls="a b"')).supported, false);
});

test('select popup rejects competing owners, duplicate ids, additional search fields and activation wrappers', () => {
  for (const popup of [selectPopup + '<div id="degree-popup"/>', selectPopup.replace('</ul>', '<ul role="listbox"/></ul>'),
    selectPopup.replace('</ul>', '<input/></ul>'), `<button type="submit">${selectPopup}</button>`,
    selectPopup.replace('role="listbox"', 'role="listbox" aria-multiselectable="true"'),
    selectPopup + '<div role="combobox" aria-expanded="true" aria-controls="degree-popup"/>',
  ]) assert.equal(observe(degreePage() + popup, readFeishuSelectPopup('education[1].degree')).popup, null);
  const nestedSubmit = selectPopup.replace('<li id="master" role="option" aria-selected="false">硕士</li>', '<li role="option"><button type="submit">硕士</button></li>');
  const read = observe(degreePage() + nestedSubmit, readFeishuSelectPopup('education[1].degree'));
  assert.equal(read.popup, null, 'an unexpected activating descendant invalidates this whole popup');
});

test('month endpoints read actual year/month display and exclude hidden keyboard proxy from fill fields', () => {
  const html = section('education', group('education', textField('education[1].school') + period('education[1].period', ['2025', '09'], ['2027', '06'])));
  const read = observe(html);
  assert.equal(read.supported, true);
  assert.deepEqual(read.groups[0].fields.map((entry: any) => [entry.fieldId, entry.type, entry.value]), [
    ['education[1].school', 'text', ''], ['education[1].period:start', 'feishu-month', '2025-09'], ['education[1].period:end', 'feishu-month', '2027-06'],
  ]);
  const target = observe(html, readFeishuCareerTarget('education[1].period:start', 30, 50), { hit: 'start' });
  assert.equal(target.exists, true); assert.equal(target.uncovered, true);
  const blank = observe(section('education', group('education', period('education[1].period'))));
  assert.deepEqual(blank.groups[0].fields.map((entry: any) => entry.value), ['', '']);
  const partial = observe(section('education', group('education', period('education[1].period', ['2025', 'MM']))));
  assert.equal(partial.groups[0].fields[0].value, '2025-MM', 'partial date stays nonempty and protected');
  const withClear = html.replace('<span data-cy="year">2025</span>', '<span data-cy="year">2025</span><span id="clear" data-cy="clear"/>');
  assert.equal(observe(withClear, readFeishuCareerTarget('education[1].period:start', 30, 50), { hit: 'clear' }).uncovered, false);
});

test('until-now action capability is stable for reviewed internship/project ends, independently of popup or selected state', () => {
  for (const kind of ['internship', 'project']) {
    const path = `${kind}[1].period`;
    const page = section(kind, group(kind, period(path, ['2025', '06'])));
    const closed = observe(page), opened = observe(page + monthPopup(path, 'End', true));
    const selectedPage = page.replace(`<div id="end" data-cy="${path}InputEnd"><span data-cy="year">YYYY</span><span data-cy="month">MM</span></div>`,
      `<div id="end" data-cy="${path}InputEnd"><span class="atsx-date-picker-period-month-label-toToday">至今</span></div>`);
    const selected = observe(selectedPage);
    for (const read of [closed, opened, selected]) {
      assert.equal(read.supported, true); const fields = read.groups[0].fields;
      assert.equal(fields[0].supportsUntilNow, false); assert.equal(fields[1].supportsUntilNow, true);
      assert.equal(fields[1].identity, closed.groups[0].fields[1].identity);
    }
    assert.equal(closed.groups[0].fields[1].untilNow, false); assert.equal(closed.groups[0].fields[1].value, '');
    assert.equal(selected.groups[0].fields[1].untilNow, true); assert.equal(selected.groups[0].fields[1].value, '至今');
    for (const changed of [selectedPage.replace('label-toToday">至今', 'label-toToday" hidden="hidden">至今'),
      selectedPage.replace('label-toToday">至今', 'label-toToday">今天'), selectedPage.replace('atsx-date-picker-period-month-label-toToday', 'unreviewed-toToday')]) {
      assert.equal(observe(changed).supported, false, 'selected state needs the visible reviewed label, not arbitrary text');
    }
  }
  assert.equal(observe(section('education', group('education', period('education[1].period')))).groups[0].fields[1].supportsUntilNow, false);
});

test('the real end-year sentinel is a uniquely bound 至今 option and never an arbitrary page label', () => {
  const path = 'internship[1].period', page = section('internship', group('internship', period(path)));
  const popup = monthPopup(path, 'End', true);
  const read = observe(page + popup, readFeishuMonthPopup(path, 'end'));
  assert.deepEqual(read.popup.columns[0].options.map((option: any) => option.value), ['至今', '2025', '2024']);
  const target = observe(page + popup, readFeishuMonthOptionTarget(path, 'end', 'year', '至今', 30, 50), { hit: 'present-option', focused: 'end' });
  assert.equal(target.exists, true); assert.equal(target.uncovered, true); assert.equal(target.focused, true);
  assert.equal(target.option.value, '至今'); assert.equal(target.field.fieldId, `${path}:end`);
  const unrelated = observe(page + '<div id="other-today">至今</div>' + monthPopup(path, 'End'), readFeishuMonthOptionTarget(path, 'end', 'year', '至今', 30, 50), { hit: 'other-today', focused: 'end' });
  assert.equal(unrelated.exists, false); assert.equal(unrelated.uncovered, false);
  assert.throws(() => readFeishuMonthOptionTarget(path, 'start', 'year', '至今', 30, 50));
  assert.throws(() => readFeishuMonthOptionTarget(path, 'end', 'month', '至今', 30, 50));
});

test('duplicate, hidden, mislabeled, disabled or activating until-now sentinels cannot be clicked', () => {
  const path = 'internship[1].period', page = section('internship', group('internship', period(path)));
  const popup = monthPopup(path, 'End', true);
  for (const option of [presentOption + presentOption, presentOption.replace('>至今<', '>今天<'),
    presentOption.replace('id="present-option"', 'id="present-option" hidden="hidden"'),
    presentOption.replace('id="present-option"', 'id="present-option" aria-disabled="true"'),
    presentOption.replace('>至今<', '><button type="submit">至今</button><'),
    presentOption.replace('<div ', '<button ').replace('</div>', '</button>'),
    `<label>${presentOption}</label>`,
  ]) {
    const bad = popup.replace(presentOption, option);
    assert.equal(observe(page + bad, readFeishuMonthPopup(path, 'end')).popup, null);
  }
  const startPopup = monthPopup(path, 'Begin', true);
  assert.equal(observe(page + startPopup, readFeishuMonthPopup(path, 'start')).popup, null);
  const wrongMonth = monthPopup(path, 'End').replace('id="month1"', 'id="month1"').replace('data-cy="01"', 'data-cy="-"').replace('>01<', '>至今<');
  assert.equal(observe(page + wrongMonth, readFeishuMonthPopup(path, 'end')).popup, null);
});

test('month picker binds separate year/month columns and exposes scroll state without scrolling or clicking', () => {
  const html = section('education', group('education', period('education[1].period'))) + monthPopup();
  const read = observe(html, readFeishuMonthPopup('education[1].period', 'start'));
  assert.ok(read.popup); assert.deepEqual(read.popup.columns.map((entry: any) => entry.kind), ['year', 'month']);
  assert.equal(read.popup.columns[0].scrollTop, 80); assert.equal(read.popup.columns[1].options.length, 12);
  assert.equal(read.popup.columns[1].options[8].selected, true);
  const target = observe(html, readFeishuMonthOptionTarget('education[1].period', 'start', 'year', '2025', 30, 50), { hit: 'year2025' });
  assert.equal(target.exists, true); assert.equal(target.uncovered, true); assert.equal(target.option.value, '2025');
  assert.deepEqual(target.hitMeta, { tag: 'div', classes: ['atsx-date-picker-period-month-panel-list-item'], numericDataCy: '2025' });
  assert.equal(observe(html, readFeishuMonthPopup('education[1].period', 'end')).popup, null);
  const column = observe(html, readFeishuMonthColumnTarget('education[1].period', 'start', 'year', 30, 50), { hit: 'year2025' });
  assert.equal(column.exists, true); assert.equal(column.uncovered, true); assert.equal(column.column.scrollTop, 80);
  assert.equal(observe(html, readFeishuMonthColumnTarget('education[1].period', 'start', 'year', 30, 50), { hit: 'start' }).uncovered, false);
});

test('ambiguous month panels, missing months, duplicate values and active descendants are rejected', () => {
  const page = section('education', group('education', period('education[1].period')));
  for (const popup of [monthPopup() + monthPopup(), monthPopup().replace('data-cy="12"', 'data-cy="13"'),
    monthPopup().replace('data-cy="2024"', 'data-cy="2025"'), `<a href="/submit">${monthPopup()}</a>`,
    monthPopup().replace('>2025</div>', '><button type="submit">2025</button></div>'),
    monthPopup().replace('id="month1" class="atsx-date-picker-period-month-panel-list-item"', 'id="month1" class="atsx-date-picker-period-month-panel-list-item-selected"'),
  ]) assert.equal(observe(page + popup, readFeishuMonthPopup('education[1].period', 'start')).popup, null);
});

test('readonly/disabled inputs, hidden sections and missing explicit field marker remain protected', () => {
  assert.equal(observe(section('education', group('education', textField('education[1].school').replace('<input ', '<input readonly="readonly" ')))).groups[0].fields[0].editable, false);
  assert.equal(observe(section('education', group('education', textField('education[1].school').replace('<input ', '<input disabled="disabled" ')))).groups[0].fields[0].editable, false);
  assert.equal(observe(degreePage().replace('createFormSection__740cd1', 'createFormSection__740cd1" hidden="hidden')).supported, false);
  assert.equal(observe(degreePage().replace('data-cy="education[1].schoolInput"', '')).supported, false);
  const longValue = '原创经历'.repeat(900);
  assert.equal(observe(section('project', group('project', textField('project[1].desc', longValue)))).groups[0].fields[0].value, longValue, 'description readback does not truncate a valid long value');
  assert.equal(observe(section('project', group('project', textField('project[1].desc', 'x'.repeat(20001))))).supported, false);
});

test('reader arguments cannot inject selectors, code, extra indices or cross-field month operations', () => {
  for (const value of ['education[-1].school', 'education[01].school', 'education[1000000].school', 'education[1].school\");alert(1);//', 'education[1].school:end;']) {
    assert.throws(() => readFeishuCareerTarget(value, 1, 1));
  }
  assert.throws(() => readFeishuCareerTarget('education[1].school', NaN, 1));
  assert.throws(() => readFeishuMonthPopup('education[1].school', 'start'));
  assert.throws(() => readFeishuMonthOptionTarget('education[1].period', 'start', 'month', '2025', 1, 1));
  assert.throws(() => readFeishuSelectOptionTarget('education[1].degree', 500, 1, 1));
});

test('protected snapshot keeps ordinary values, checks and attachment presence but sensitive fields expose only presence', () => {
  const ordinary = '<input id="contact" value="fixture@example.invalid"/><input id="agreement" type="checkbox" checked="checked"/><input id="upload" type="file" value="fixture.txt"/>'
    + '<input id="csrf" type="hidden" value="fixture-token"/><input id="password" type="password" value="never-record-this"/>'
    + '<label for="code">验证码</label><input id="code" value="never-record-code"/>';
  const read = observe(degreePage() + ordinary);
  assert.deepEqual(read.protectedControls.map((entry: any) => [entry.id, entry.value, entry.checked]), [
    ['contact', 'fixture@example.invalid', false], ['agreement', '', true], ['upload', '[已有附件]', false],
    ['csrf', '[已有值]', false], ['password', '[已有值]', false], ['code', '[已有值]', false],
  ]);
  assert.ok(!JSON.stringify(read).includes('never-record'));
  const withDate = observe(degreePage().replace(add(), period('education[1].period') + add()) + ordinary);
  assert.deepEqual(withDate.protectedControls, read.protectedControls, 'career hidden proxy and new career fields never shift protected control indices');
  assert.ok(!JSON.stringify(read.protectedControls).includes('fixture-token'));
  assert.ok(!JSON.stringify(read.protectedControls).includes('fixture.txt'), 'file names and path text are not observed');
});

test('hidden credentials, OTP, identity and payment values never enter the protected snapshot or select metadata', () => {
  const secret = 'never-observe-this-secret';
  const fields = [
    `<input type="hidden" name="ordinary-name" value="${secret}"/>`,
    `<input id="apiKey" value="${secret}"/>`, `<input name="authorization" value="${secret}"/>`,
    `<input autocomplete="one-time-code" value="${secret}"/>`, `<input placeholder="请输入身份证号码" value="${secret}"/>`,
    `<input aria-label="银行卡号" value="${secret}"/>`, `<input autocomplete="cc-number" value="${secret}"/>`,
    `<input name="sessionId" value="${secret}"/>`, `<input name="credential" value="${secret}"/>`,
    `<input id="otpCode" value="${secret}"/>`, `<input name="sms_code" value="${secret}"/>`,
    `<input id="creditCardNumber" value="${secret}"/>`, `<input id="idNumber" value="${secret}"/>`,
    `<div role="combobox" id="auth-method" aria-valuetext="${secret}"><span data-cy="selectedValue">${secret}</span></div>`,
  ];
  const result = observe(degreePage() + fields.join(''));
  assert.equal(result.supported, true); assert.equal(result.protectedControls.length, fields.length);
  assert.ok(result.protectedControls.every((field: any) => field.sensitive === true));
  assert.ok(result.protectedControls.every((field: any) => !('selectedLabels' in field) && !('ariaValueText' in field)));
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(result.protectedControls.map((field: any) => field.value), Array(fields.length).fill('[已有值]'));
  const empty = observe(degreePage() + '<input type="hidden" name="csrfToken" value=""/>');
  assert.equal(empty.protectedControls[0].value, '');
});

test('reviewed expansion and hover classes do not change static field or option identity', () => {
  const base = degreePage('本科');
  const expanded = base.replace('class="atsx-select ', 'class="atsx-select atsx-select-open atsx-select-focused ');
  assert.equal(observe(base).groups[0].identity, observe(expanded).groups[0].identity);
  const withoutSearch = base.replace('<input id="degree-search" type="search" value=""/>', '');
  assert.equal(observe(base).groups[0].identity, observe(withoutSearch).groups[0].identity, 'reviewed zero-to-one search input transition is not static owner identity');
  assert.equal(observe(base.replace('<input id="degree-search" type="search" value=""/>', '<input type="search"/><input type="search"/>')).supported, false, 'two dynamic search inputs remain ambiguous');
  const page = section('education', group('education', period('education[1].period')));
  const focused = page.replace('class="atsx-date-picker-period-month"', 'class="atsx-date-picker-period-month atsx-date-picker-focus"');
  assert.equal(observe(page).groups[0].identity, observe(focused).groups[0].identity);
  const initial = observe(page + monthPopup(), readFeishuMonthPopup('education[1].period', 'start'));
  const hover = observe(page + monthPopup().replace('id="year2025" data-cy="2025" class="atsx-date-picker-period-month-panel-list-item"',
    'id="year2025" data-cy="2025" class="atsx-date-picker-period-month-panel-list-item atsx-date-picker-period-month-panel-list-item-focused"'), readFeishuMonthPopup('education[1].period', 'start'));
  assert.equal(initial.popup.columns[0].options[0].identity, hover.popup.columns[0].options[0].identity);
});

test('fixture origin factory requires explicit smoke mode and exact loopback origin; production scope stays fixed', () => {
  assert.throws(() => createFeishuFixtureScripts('http://127.0.0.1:43123'));
  process.argv.push('--smoke-test');
  try {
    for (const origin of ['https://127.0.0.1:43123', 'http://localhost:43123', 'http://127.0.0.1:43123/path', 'http://127.0.0.1:43123/', 'http://user@127.0.0.1:43123']) {
      assert.throws(() => createFeishuFixtureScripts(origin));
    }
    const scripts = createFeishuFixtureScripts('http://127.0.0.1:43123');
    assert.equal(observe(degreePage(), scripts.READ_FEISHU_CAREER, { url: 'http://127.0.0.1:43123/form' }).supported, true);
    assert.equal(observe(degreePage(), scripts.READ_FEISHU_CAREER, { url: 'http://127.0.0.1:43124/form' }).supported, false);
    assert.equal(observe(degreePage(), READ_FEISHU_CAREER, { url: 'http://127.0.0.1:43123/form' }).supported, false);
    assert.equal(observe(degreePage(), scripts.readFeishuCareerTarget('education[1].school', 30, 50), { url: 'http://127.0.0.1:43123/form', hit: 'education[1].school' }).uncovered, true);
  } finally { process.argv.pop(); }
});

test('page-wheel hit binding excludes editable and activating surfaces and remains scoped to reviewed origin', () => {
  const html = `<div id="surface">${degreePage()}</div><button id="submit" type="submit"><span id="inside-submit">提交</span></button>`;
  assert.equal(observe(html, readFeishuPageWheelTarget(30, 50), { hit: 'surface' }).allowed, true);
  for (const hit of ['education[1].school', 'degree-search', 'submit', 'inside-submit']) {
    assert.equal(observe(html, readFeishuPageWheelTarget(30, 50), { hit }).allowed, false);
  }
  assert.equal(observe(html, readFeishuPageWheelTarget(30, 50), { hit: 'surface', url: 'https://other.example.invalid/' }).allowed, false);
});

test('month target hit metadata exposes only reviewed classes and numeric date data-cy, not covering content or arbitrary ids', () => {
  const page = section('education', group('education', period('education[1].period'))) + monthPopup();
  const cover = '<div id="private-cover-id" data-cy="private-value" class="private-css atsx-date-picker-period-month-panel-list-item">private-display-text</div>';
  const read = observe(page + cover, readFeishuMonthOptionTarget('education[1].period', 'start', 'year', '2025', 30, 50), { hit: 'private-cover-id' });
  assert.equal(read.exists, true); assert.equal(read.uncovered, false);
  assert.deepEqual(read.hitMeta, { tag: 'div', classes: ['atsx-date-picker-period-month-panel-list-item'] });
  assert.doesNotMatch(JSON.stringify(read.hitMeta), /private/u);
  const oldDatePopup = observe(degreePage() + monthPopup(), readFeishuAddTarget('education', 30, 50), { hit: 'year2025' });
  assert.equal(oldDatePopup.uncovered, false);
  assert.deepEqual(oldDatePopup.hitMeta, { tag: 'div', classes: ['atsx-date-picker-period-month-panel-list-item'], numericDataCy: '2025' });
});

const hiddenCounterInput = (value: string, attributes = 'id="formControlChangeFlag"') => `<input ${attributes} type="text" value="${value}"/>`;
const hiddenCounterPage = (input: string, extra = '', hiddenRootAttributes = 'style="display:none"') =>
  `<form id="fictional-career-form">${degreePage()}<div class="resumeEditForm-hiddenField" ${hiddenRootAttributes}>${input}</div>${extra}</form>`;

test('only the exact unique computed-hidden legacy counter is normalized, including its initial empty-to-nonempty transition', () => {
  for (const attributes of ['id="formControlChangeFlag"', 'name="formControlChangeFlag"', 'id="formControlChangeFlag" name="formControlChangeFlag"']) {
    const before = observe(hiddenCounterPage(hiddenCounterInput('', attributes)));
    const after = observe(hiddenCounterPage(hiddenCounterInput('fictional-counter-next', attributes)));
    assert.equal(before.supported, true); assert.equal(before.protectedControls.length, 1);
    assert.equal(before.protectedControls[0].value, '[结构计数器]');
    assert.deepEqual(before.protectedControls, after.protectedControls);
    const another = observe(hiddenCounterPage(hiddenCounterInput('different-nonempty-counter', attributes)));
    assert.deepEqual(after.protectedControls, another.protectedControls);
  }
  const trapped = observe(hiddenCounterPage(hiddenCounterInput('must-never-be-read', 'id="formControlChangeFlag" data-assert-no-value-read="true"')));
  assert.equal(trapped.protectedControls[0].value, '[结构计数器]', 'the exact technical counter does not even read value presence');
});

test('visible same-name counters and counters outside the reviewed container keep ordinary exact-value protection', () => {
  const visibleBefore = observe(hiddenCounterPage(hiddenCounterInput('before'), '', 'style="display:block"'));
  const visibleAfter = observe(hiddenCounterPage(hiddenCounterInput('after'), '', 'style="display:block"'));
  assert.equal(visibleBefore.protectedControls[0].value, 'before');
  assert.notDeepEqual(visibleBefore.protectedControls, visibleAfter.protectedControls);
  const elsewhere = `<form>${degreePage()}<div class="resumeEditForm-hiddenField" style="display:none"/>${hiddenCounterInput('keep-visible')}</form>`;
  assert.equal(observe(elsewhere).protectedControls[0].value, 'keep-visible');
});

test('a same-name hidden control outside the reviewed container remains presence-only rather than receiving a fixed sentinel', () => {
  const page = (value: string) => `<form>${degreePage()}<div style="display:none">${hiddenCounterInput(value)}</div></form>`;
  const before = observe(page('')), after = observe(page('private-hidden-content'));
  assert.equal(before.protectedControls[0].value, ''); assert.equal(after.protectedControls[0].value, '[已有值]');
  assert.notDeepEqual(before.protectedControls, after.protectedControls);
  assert.doesNotMatch(JSON.stringify(after), /private-hidden-content/u);
});

test('counter duplicates, conflicting id/name, non-text types and ambiguous hidden containers never receive the sentinel', () => {
  const cases = [
    hiddenCounterPage(hiddenCounterInput(''), '<div id="formControlChangeFlag"/>'),
    hiddenCounterPage(hiddenCounterInput(''), hiddenCounterInput('duplicate')),
    hiddenCounterPage(hiddenCounterInput('', 'id="formControlChangeFlag" name="different-field"')),
    hiddenCounterPage(hiddenCounterInput('', 'name="formControlChangeFlag" id="different-field"')),
    hiddenCounterPage(hiddenCounterInput('').replace('type="text"', 'type="hidden"')),
    hiddenCounterPage(`<textarea id="formControlChangeFlag">opaque text</textarea>`),
    hiddenCounterPage(hiddenCounterInput(''), '<div class="resumeEditForm-hiddenField" style="display:none"/>'),
    hiddenCounterPage(hiddenCounterInput(''), '<span class="resumeEditForm-hiddenField" style="display:none"/>'),
  ];
  for (const html of cases) assert.ok(observe(html).protectedControls.every((field: any) => field.value !== '[结构计数器]'));
});

test('counter normalization requires one shared form and actual computed hiding, not aria-hidden alone', () => {
  const multipleForms = hiddenCounterPage(hiddenCounterInput('')) + '<form id="unrelated-form"/>';
  const foreignForm = `<form>${degreePage()}</form><form><div class="resumeEditForm-hiddenField" style="display:none">${hiddenCounterInput('')}</div></form>`;
  const noForm = degreePage() + `<div class="resumeEditForm-hiddenField" style="display:none">${hiddenCounterInput('')}</div>`;
  const ariaOnly = hiddenCounterPage(hiddenCounterInput('some-value'), '', 'aria-hidden="true"');
  for (const html of [multipleForms, foreignForm, noForm, ariaOnly]) {
    assert.ok(observe(html).protectedControls.every((field: any) => field.value !== '[结构计数器]'));
  }
});

test('counter normalization still preserves identity, type, disabled, readonly and node existence for exact comparisons', () => {
  const before = observe(hiddenCounterPage(hiddenCounterInput('')));
  for (const input of [hiddenCounterInput('').replace('<input ', '<input disabled="disabled" '),
    hiddenCounterInput('').replace('<input ', '<input readonly="readonly" '),
    hiddenCounterInput('', 'name="formControlChangeFlag"'),
  ]) {
    const changed = observe(hiddenCounterPage(input));
    assert.equal(changed.protectedControls[0].value, '[结构计数器]');
    assert.notDeepEqual(before.protectedControls, changed.protectedControls);
  }
  assert.notDeepEqual(before.protectedControls, observe(hiddenCounterPage('')).protectedControls);
});

test('ResumeId and other CSS-hidden controls expose only presence and never inherit the structural counter exception', () => {
  const hidden = '<input id="id" type="text" value="private-resume-id"/><input id="other-internal" type="text" value="private-internal-text"/>';
  const result = observe(hiddenCounterPage(hiddenCounterInput('') + hidden));
  assert.deepEqual(result.protectedControls.map((field: any) => field.value), ['[结构计数器]', '[已有值]', '[已有值]']);
  assert.doesNotMatch(JSON.stringify(result), /private-resume-id|private-internal-text/u);
  const opaqueExtra = '<div role="combobox" aria-valuetext="private-hidden-choice"><span data-cy="selectedValue">private-hidden-label</span></div>'
    + '<input type="file" value="private-hidden-file.txt"/>';
  const more = observe(hiddenCounterPage(hiddenCounterInput('') + opaqueExtra));
  assert.deepEqual(more.protectedControls.map((field: any) => field.value), ['[结构计数器]', '[已有值]', '[已有值]']);
  assert.ok(more.protectedControls.every((field: any) => !('selectedLabels' in field) && !('files' in field) && !('ariaValueText' in field)));
  assert.doesNotMatch(JSON.stringify(more), /private-hidden/u);
});

test('an activating wrapper cannot disguise the technical counter even when its class and computed hiding match', () => {
  for (const input of [`<button type="button">${hiddenCounterInput('')}</button>`, `<label>${hiddenCounterInput('')}</label>`]) {
    assert.ok(observe(hiddenCounterPage(input)).protectedControls.every((field: any) => field.value !== '[结构计数器]'));
  }
  const roleContainer = hiddenCounterPage(hiddenCounterInput(''), '', 'style="display:none" role="button"');
  assert.ok(observe(roleContainer).protectedControls.every((field: any) => field.value !== '[结构计数器]'));
});

test('only exact PerfectScrollbar scrolling flags on a proven ps date column are excluded from static popup identities', () => {
  const page = section('education', group('education', period('education[1].period')));
  const base = monthPopup().replaceAll('class="atsx-date-picker-period-month-panel-list"', 'class="atsx-date-picker-period-month-panel-list ps"');
  const before = observe(page + base, readFeishuMonthPopup('education[1].period', 'start'));
  for (const flags of ['ps--scrolling-x', 'ps--scrolling-y', 'ps--scrolling-x ps--scrolling-y']) {
    const moving = base.replace('class="atsx-date-picker-period-month-panel-list ps"', `class="atsx-date-picker-period-month-panel-list ps ${flags}"`);
    const after = observe(page + moving, readFeishuMonthPopup('education[1].period', 'start'));
    assert.equal(after.popup.identity, before.popup.identity);
    assert.equal(after.popup.columns[0].identity, before.popup.columns[0].identity);
    assert.deepEqual(after.popup.columns[0].scrollState, { scrollingX: flags.includes('ps--scrolling-x'), scrollingY: flags.includes('ps--scrolling-y') });
    const targetBefore = observe(page + base, readFeishuMonthOptionTarget('education[1].period', 'start', 'year', '2025', 30, 50), { hit: 'year2025' });
    const targetAfter = observe(page + moving, readFeishuMonthOptionTarget('education[1].period', 'start', 'year', '2025', 30, 50), { hit: 'year2025' });
    assert.equal(targetAfter.option.identity, targetBefore.option.identity);
  }
  for (const preserved of ['ps--active-x', 'ps--active-y', 'ps--scrolling-z', 'unknown-scroll-layout']) {
    const changed = base.replace('class="atsx-date-picker-period-month-panel-list ps"', `class="atsx-date-picker-period-month-panel-list ps ${preserved}"`);
    assert.notEqual(observe(page + changed, readFeishuMonthPopup('education[1].period', 'start')).popup.identity, before.popup.identity);
  }
  const changedFieldId = page.replace('class="atsx-date-picker-period-month"', 'id="different-date-root" class="atsx-date-picker-period-month"');
  assert.notEqual(observe(changedFieldId + base, readFeishuMonthPopup('education[1].period', 'start')).popup.identity, before.popup.identity);
});

test('the scrolling-class exception cannot generalize to non-date scrollbars or date-like nodes without ps', () => {
  const identity = (classes: string) => observe(`<div id="technical-node" class="${classes}"/>`,
    `(() => { ${FEISHU_READ_HELPERS} return { url: location.href, identity: fsIdentityClass(document.querySelectorAll('[id]')[0]) }; })()`).identity;
  for (const classes of ['ps', 'atsx-date-picker-period-month-panel-list', 'ps atsx-select-dropdown-menu']) {
    assert.notEqual(identity(classes), identity(classes + ' ps--scrolling-y'));
  }
  const proven = 'ps atsx-date-picker-period-month-panel-list';
  assert.equal(identity(proven), identity(proven + ' ps--scrolling-x ps--scrolling-y'));
});
