import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { DOMParser, XMLSerializer, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';
import { READ_FORM, readTarget, revealObservedField, locationObservationSnapshot } from '../packages/browser/src/read-scripts.js';
import { readComboboxOptionTarget, readComboboxPopup } from '../packages/browser/src/combobox-scripts.js';

/** Original HTML shapes, interpreted by a small read-only DOM fixture; no browser/session access. */
function observe(html: string, script = READ_FORM, focusedId = '', hitId = '', scrolls: Array<{id:string;options:unknown}> = []): any {
  const xml = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'application/xhtml+xml');
  const before = new XMLSerializer().serializeToString(xml);
  const elements = new Map<XmlNode, Element>();
  class Element {
    readonly children: Element[] = [];
    constructor(readonly node: XmlElement, readonly parentElement: Element | null) {
      elements.set(node, this);
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) this.children.push(new Element(child as XmlElement, this));
      }
    }
    get tagName() { return this.node.tagName.toUpperCase(); }
    get id() { return this.getAttribute('id') || ''; }
    get name() { return this.getAttribute('name') || ''; }
    get type() { return this.getAttribute('type') || 'text'; }
    get value() { return this.getAttribute('value') || ''; }
    get hidden() { return this.hasAttribute('hidden'); }
    get required() { return this.hasAttribute('required'); }
    get disabled() { return this.hasAttribute('disabled'); }
    get checked() { return this.hasAttribute('checked'); }
    get readOnly() { return this.hasAttribute('readonly'); }
    get multiple() { return this.hasAttribute('multiple'); }
    get size() { return Number(this.getAttribute('size') || 0); }
    get options() { return this.querySelectorAll('option'); }
    get text() { return this.node.textContent || ''; }
    get validity() { return { valid: true }; }
    get labels() { return root.querySelectorAll('label').filter(label => this.id && label.getAttribute('for') === this.id); }
    hasAttribute(name: string) { return this.node.hasAttribute(name); }
    getAttribute(name: string) { return this.node.getAttribute(name); }
    matches(selector: string): boolean {
      return selector.split(',').some(part => {
        const value = part.trim();
        if (value.startsWith('.')) return (this.getAttribute('class') || '').split(/\s+/).includes(value.slice(1));
        const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
        if (attr) return attr[2] === undefined ? this.hasAttribute(attr[1]!) : this.getAttribute(attr[1]!) === attr[2];
        return this.tagName.toLowerCase() === value.toLowerCase();
      });
    }
    closest(selector: string): Element | null {
      for (let node: Element | null = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    contains(other: Element | null): boolean {
      for (let node = other; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    querySelectorAll(selector: string): Element[] {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { x: Number(this.getAttribute('data-x') || 20), y: Number(this.getAttribute('data-y') || 40), width: 240, height: 32 }; }
    scrollIntoView(options: unknown) { scrolls.push({ id: this.id, options: JSON.parse(JSON.stringify(options)) }); }
  }
  const root = new Element(xml.documentElement!, null);
  const byId = (id: string) => [...elements.values()].find(element => element.id === id) || null;
  const result = runInNewContext(script, {
    Element,
    document: {
      title: '原创 ARIA 单选测试', activeElement: byId(focusedId),
      querySelectorAll: (selector: string) => root.querySelectorAll(selector), getElementById: byId,
      elementFromPoint: () => byId(hitId),
      createTreeWalker: (element: Element, _type: number, filter: { acceptNode(node: object): number }) => {
        const nodes: Array<{ nodeValue: string | null; parentElement: Element | undefined }> = [];
        const visit = (node: XmlNode) => {
          if (node.nodeType === 3) {
            const observed = { nodeValue: node.nodeValue, parentElement: elements.get(node.parentNode!) };
            if (filter.acceptNode(observed) === 1) nodes.push(observed);
          }
          for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
        };
        visit(element.node);
        let index = -1;
        return { currentNode: null as object | null, nextNode() { this.currentNode = nodes[++index] || null; return this.currentNode; } };
      },
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    location: { href: 'https://fixture.example.invalid/apply' }, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: (element: Element) => ({
      display: /display\s*:\s*none/.test(element.getAttribute('style') || '') || element.hidden ? 'none' : 'block',
      visibility: /visibility\s*:\s*hidden/.test(element.getAttribute('style') || '') ? 'hidden' : 'visible',
    }),
  });
  assert.equal(new XMLSerializer().serializeToString(xml), before, 'readers never change the source DOM');
  return JSON.parse(JSON.stringify(result));
}

const owner = '<label for="degree">学历</label><input id="degree" role="combobox" readonly="readonly" aria-controls="degrees" aria-expanded="true"/>';
const options = '<div id="degrees" role="listbox"><div id="master" role="option" aria-selected="false">硕士</div><div id="bachelor" role="option">本科</div></div>';

test('a bound readonly ARIA input remains selectable while ordinary readonly input remains protected', () => {
  const result = observe(owner + options + '<input readonly="readonly" aria-label="Email"/>');
  assert.deepEqual(result.fields[0].customSelect, { kind: 'aria-single-select', relationship: 'controls', popupId: 'degrees', valueSource: 'input-value' });
  assert.equal(result.fields[0].editable, true);
  assert.equal(result.fields[1].editable, false);
  assert.deepEqual(result.fields[0].options, []);
  const closed = observe(owner.replace('aria-expanded="true"', 'aria-expanded="false"'));
  assert.equal(result.fields[0].identity, closed.fields[0].identity, 'opening options does not change static owner identity');
  assert.equal(result.fields[0].value, '');
});

test('composite combobox ownership removes duplicate internal input and reads only explicit value sources', () => {
  const result = observe('<div id="degree" role="combobox" aria-label="学历" aria-owns="degrees" aria-valuetext="硕士"><input id="internal" readonly="readonly" value="do not prefer this"/><span>untrusted display</span></div><input aria-label="Email"/>');
  assert.equal(result.fields.length, 2);
  assert.equal(result.fields[0].value, '硕士');
  assert.equal(result.fields[0].customSelect.valueSource, 'aria-valuetext');
  assert.equal(result.fields[1].index, 1);
  const inputValue = observe('<div role="combobox" aria-label="学历" aria-controls="degrees"><input readonly="readonly" value="本科"/></div>');
  assert.equal(inputValue.fields[0].value, '本科');
  assert.equal(inputValue.fields[0].customSelect.valueSource, 'input-value');
  const unsupported = observe('<div role="combobox" aria-label="学历" aria-controls="degrees"><span>硕士</span></div>');
  assert.equal(unsupported.fields[0].customSelect, undefined);
  assert.equal(unsupported.fields[0].value, '', 'innerText is never guessed as selected value');
});

test('unsupported or ambiguous ARIA relationships never receive selectable binding', () => {
  for (const attributes of [
    '', 'aria-controls="a b"', 'aria-controls="a" aria-owns="b"',
    'aria-controls="a" aria-haspopup="tree"', 'aria-controls="a" aria-autocomplete="list"',
  ]) {
    const result = observe(`<input role="combobox" readonly="readonly" aria-label="学历" ${attributes}/>`);
    assert.equal(result.fields[0].customSelect, undefined);
    assert.equal(result.fields[0].editable, false);
  }
});

test('native navigation, default-submit owners and nested action buttons cannot become selectable comboboxes', () => {
  for (const html of [
    '<button type="submit" role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>',
    '<button role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>',
    '<a href="https://fixture.example.invalid/submit" role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>',
    '<label for="agreement" role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>',
    '<summary role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>',
    '<div contenteditable="true" role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>',
    '<div role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""><button type="button">触发另一个动作</button></div>',
    '<div role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""><a href="/apply">跳转</a></div>',
    '<div role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""><span role="button">触发另一个动作</span></div>',
  ]) assert.equal(observe(html).fields[0].customSelect, undefined);
  const explicit = observe('<button type="button" role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>');
  assert.equal(explicit.fields[0].customSelect.kind, 'aria-single-select', 'an explicit non-submit owner is allowed');
});

test('a combobox trigger inside an activating ancestor never receives a selectable binding', () => {
  const trigger = '<span role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/>';
  for (const html of [
    `<form><button type="submit">${trigger}</button></form>`,
    `<button type="button">${trigger}</button>`,
    `<a href="/submit">${trigger}</a>`,
    `<details><summary>${trigger}</summary></details>`,
    `<label for="agreement">${trigger}</label><input id="agreement" type="checkbox"/>`,
    `<div role="button">${trigger}</div>`,
    `<div role="link">${trigger}</div>`,
    `<div role="checkbox">${trigger}</div>`,
    `<div contenteditable="true">${trigger}</div>`,
  ]) {
    const field = observe(html).fields.find((entry: any) => entry.label === '学历');
    assert.equal(field.customSelect, undefined, 'a native click must not bubble into another activation');
  }
  const explicit = observe('<form><button type="button" role="combobox" aria-label="学历" aria-controls="degrees" aria-valuetext=""/></form>');
  assert.equal(explicit.fields[0].customSelect.kind, 'aria-single-select', 'the explicit non-submit owner itself remains supported');
});

test('popup observation binds the real listbox and preserves raw indices when unavailable options are filtered', () => {
  const html = owner + `<div id="degrees" role="listbox">
    <div id="disabled" role="option" aria-disabled="true">不可选</div>
    <div id="hidden" role="option" hidden="hidden">隐藏</div>
    <div id="master" role="option" aria-selected="true">硕士<span hidden="hidden">不可读</span></div>
    <div inert="inert"><div role="option">不可交互</div></div>
    <div id="bachelor" role="option">本科</div></div>`;
  const result = observe(html, readComboboxPopup(0, 'degrees'), 'degree');
  assert.equal(result.owner.focused, true);
  assert.equal(result.owner.expanded, true);
  assert.deepEqual(result.popup.options.map((option: any) => [option.index, option.label, option.selected]), [[2, '硕士', true], [4, '本科', false]]);
  assert.ok(result.popup.identity);
  assert.ok(result.popup.options.every((option: any) => typeof option.identity === 'string' && !option.disabled));
});

test('duplicate ids, foreign roles, multi-select, additional popup controls and nested listboxes are rejected', () => {
  for (const popup of [
    options + '<div id="degrees" role="listbox"/>',
    options.replace('role="listbox"', 'role="menu"'),
    options.replace('role="listbox"', 'role="listbox" aria-multiselectable="true"'),
    options.replace('</div>', '<input type="hidden"/></div>'),
    options.replace('</div>', '<div role="listbox"/></div>'),
  ]) assert.equal(observe(owner + popup, readComboboxPopup(0, 'degrees')).popup, null);
  assert.equal(observe(owner + options, readComboboxPopup(0, 'different')).popup, null);
  assert.equal(observe(owner.replace('aria-expanded="true"', 'aria-expanded="false"') + options, readComboboxPopup(0, 'degrees')).popup, null);
});

test('one popup cannot be operated while two owners both claim it as expanded', () => {
  const another = '<input id="other" role="combobox" aria-controls="degrees" aria-expanded="true"/>';
  assert.equal(observe(owner + another + options, readComboboxPopup(0, 'degrees')).popup, null);
});

test('option observations exclude native action elements and text options containing submit buttons or links', () => {
  const html = owner + `<div id="degrees" role="listbox">
    <button id="submit-option" type="submit" role="option">硕士</button>
    <a id="link-option" href="/apply" role="option">硕士</a>
    <div id="nested-submit" role="option"><button type="submit">硕士</button></div>
    <div id="nested-link" role="option"><a href="/apply">硕士</a></div>
    <div id="nested-role" role="option"><span role="button">硕士</span></div>
    <div id="safe-option" role="option"><span>本科</span></div></div>`;
  const result = observe(html, readComboboxPopup(0, 'degrees'), 'degree');
  assert.deepEqual(result.popup.options.map((option: any) => [option.index, option.id, option.label]), [[5, 'safe-option', '本科']]);
  for (let index = 0; index < 5; index++) {
    const target = observe(html, readComboboxOptionTarget(0, 'degrees', index, 30, 50), 'degree', 'submit-option');
    assert.equal(target.exists, false); assert.equal(target.uncovered, false);
  }
});

test('listboxes inside buttons, links or other activating ancestors are not operated', () => {
  const listbox = '<span id="degrees" role="listbox"><span id="master" role="option">硕士</span></span>';
  for (const html of [
    `<button type="submit">${listbox}</button>`,
    `<a href="/submit">${listbox}</a>`,
    `<summary>${listbox}</summary>`,
    `<label for="agreement">${listbox}</label>`,
    `<div role="button">${listbox}</div>`,
    `<div role="switch">${listbox}</div>`,
    `<div contenteditable="true">${listbox}</div>`,
    '<button id="degrees" type="submit" role="listbox"><span id="master" role="option">硕士</span></button>',
  ]) {
    assert.equal(observe(owner + html, readComboboxPopup(0, 'degrees')).popup, null);
    const hit = observe(owner + html, readComboboxOptionTarget(0, 'degrees', 0, 30, 50), 'degree', 'master');
    assert.equal(hit.exists, false); assert.equal(hit.uncovered, false);
  }
});

test('options wrapped in activating elements are excluded while a plain sibling remains selectable', () => {
  for (const wrap of [
    (child: string) => `<button type="submit">${child}</button>`,
    (child: string) => `<button type="button">${child}</button>`,
    (child: string) => `<a href="/submit">${child}</a>`,
    (child: string) => `<summary>${child}</summary>`,
    (child: string) => `<label for="agreement">${child}</label>`,
    (child: string) => `<span role="button">${child}</span>`,
    (child: string) => `<span role="menuitem">${child}</span>`,
  ]) {
    const popup = `<div id="degrees" role="listbox">${wrap('<span id="master" role="option">硕士</span>')}<div id="plain" role="option">本科</div></div>`;
    const result = observe(owner + popup, readComboboxPopup(0, 'degrees'));
    assert.deepEqual(result.popup.options.map((entry: any) => [entry.index, entry.id, entry.label]), [[1, 'plain', '本科']]);
    const hit = observe(owner + popup, readComboboxOptionTarget(0, 'degrees', 0, 30, 50), 'degree', 'master');
    assert.equal(hit.exists, false); assert.equal(hit.uncovered, false);
  }
});

test('target readers use the same deduplicated index and native focus may be inside a composite owner', () => {
  const html = '<div id="degree" role="combobox" aria-label="学历" aria-controls="degrees"><input id="inner" readonly="readonly" value="硕士"/></div><input id="email" value="fiction@example.invalid"/>';
  const first = observe(html, readTarget(0, 30, 50), 'inner', 'inner');
  assert.equal(first.focused, true); assert.equal(first.uncovered, true); assert.equal(first.value, '硕士');
  const second = observe(html, readTarget(1, 30, 50), 'email', 'email');
  assert.equal(second.focused, true); assert.equal(second.value, 'fiction@example.invalid');
});

test('option hit testing exposes actual covering elements and never treats highlight as selection', () => {
  const hit = observe(owner + options, readComboboxOptionTarget(0, 'degrees', 0, 30, 50), 'degree', 'master');
  assert.equal(hit.exists, true); assert.equal(hit.uncovered, true); assert.equal(hit.focused, true);
  assert.equal(hit.selected, false); assert.equal(hit.label, '硕士'); assert.equal(hit.valid, true);
  const covered = observe(owner + options + '<div id="cover"/>', readComboboxOptionTarget(0, 'degrees', 0, 30, 50), 'degree', 'cover');
  assert.equal(covered.uncovered, false);
  const selected = observe(owner + options.replace('aria-selected="false"', 'aria-selected="true"'), readComboboxOptionTarget(0, 'degrees', 0, 30, 50), 'degree', 'master');
  assert.equal(selected.selected, true); assert.notEqual(selected.identity, hit.identity);
});

test('sensitive custom values remain masked in general form observations', () => {
  const result = observe('<div role="combobox" aria-label="Passport number" aria-controls="choices" aria-valuetext="PRIVATE_MARKER"/>');
  assert.equal(result.fields[0].value, '[已有值]');
  assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false);
  const password = observe('<input type="password" role="combobox" aria-label="Email" aria-controls="choices" value="PRIVATE_PASSWORD"/>');
  assert.equal(password.fields[0].customSelect, undefined);
  assert.equal(JSON.stringify(password).includes('PRIVATE_PASSWORD'), false);
});

test('reader generation validates indices and popup strings and emits no mutating DOM actions', () => {
  assert.throws(() => readComboboxPopup(-1, 'degrees'));
  assert.throws(() => readComboboxPopup(300, 'degrees'));
  assert.throws(() => readComboboxPopup(0, 'two ids'));
  assert.throws(() => readComboboxOptionTarget(0, 'degrees', 500, 0, 0));
  assert.throws(() => readComboboxOptionTarget(0, 'degrees', 0, Number.NaN, 0));
  for (const script of [READ_FORM, readTarget(0, 20, 20), readComboboxPopup(0, 'degrees'), readComboboxOptionTarget(0, 'degrees', 0, 20, 20)]) {
    assert.doesNotMatch(script, /\.click\s*\(|\.focus\s*\(|dispatchEvent\s*\(|\.value\s*=/);
  }
});

test('precise locator scrolls only the exact freshly observed ordinary index and never changes DOM values', () => {
  const page = '<label for="name">姓名</label><input id="name"/><label for="email">邮箱</label><input id="email" value="keep@example.invalid"/>';
  const expected = locationObservationSnapshot(observe(page)), scrolls: Array<{id:string;options:unknown}> = [];
  const result = observe(page, revealObservedField(1, expected), 'name', '', scrolls);
  assert.equal(result.scrolled, true); assert.equal(result.reason, 'requested');
  assert.deepEqual(scrolls, [{ id: 'email', options: { behavior: 'instant', block: 'center', inline: 'nearest' } }]);
  assert.equal(result.url, 'https://fixture.example.invalid/apply');
});

test('ordinary locator refuses stale values, reordered identities, hidden targets and changed checkbox state', () => {
  const page = '<input id="name" aria-label="姓名"/><input id="email" aria-label="邮箱" value="keep@example.invalid"/><input id="check" type="checkbox" checked="checked"/>';
  const expected = locationObservationSnapshot(observe(page));
  for (const changed of [page.replace('keep@example.invalid', 'other@example.invalid'), page.replace('id="email"', 'id="different"'),
    page.replace('id="email"', 'id="email" hidden="hidden"'), page.replace('checked="checked"', '')]) {
    const scrolls: Array<{id:string;options:unknown}> = []; const result = observe(changed, revealObservedField(1, expected), '', '', scrolls);
    assert.equal(result.scrolled, false); assert.equal(result.reason, 'changed'); assert.deepEqual(scrolls, []);
  }
  const missing: Array<{id:string;options:unknown}> = [];
  assert.equal(observe(page, revealObservedField(10, expected), '', '', missing).reason, 'missing'); assert.deepEqual(missing, []);
});

test('locator snapshots ignore only geometry and viewport while retaining private values and structural checks locally', () => {
  const page = '<input id="name" aria-label="姓名" data-y="900"/>';
  const raw = observe(page), changed = structuredClone(raw); changed.fields[0].bounds.y = -100; changed.viewport.width = 480;
  assert.equal(locationObservationSnapshot(raw), locationObservationSnapshot(changed));
  const scrolls: Array<{id:string;options:unknown}> = [];
  assert.equal(observe(page.replace('data-y="900"', 'data-y="200"'), revealObservedField(0, locationObservationSnapshot(raw)), '', '', scrolls).scrolled, true);
  assert.equal(scrolls.length, 1);
  for (const value of [-1, 300, NaN, 1.2]) assert.throws(() => revealObservedField(value, '{}'));
  assert.throws(() => revealObservedField(0, '')); assert.throws(() => locationObservationSnapshot(undefined));
  assert.doesNotMatch(revealObservedField(0, '{}'), /\.click\s*\(|\.focus\s*\(|dispatchEvent\s*\(|\.value\s*=/);
});
