import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import { readLocationWheelTarget } from '../packages/browser/src/read-scripts.js';

interface WheelTarget { url: string; exists: boolean; x?: number; y?: number; pointerIdentity?: string; }
interface ReadNode {
  tagName: string; id: string | ReadNode; className: string; parentElement: ReadNode | null; children: ReadNode[];
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  closest(selector: string): ReadNode | null;
}

/** Original XML-backed DOM. This executes the actual generated read script;
 * it is a DOM contract test, not native-wheel or enterprise-page evidence. */
function fixture(body: string, options: { namedId?: boolean } = {}) {
  const xml = new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'application/xhtml+xml');
  const nodes: ReadNode[] = [], sources = new Map<ReadNode, XmlElement>();
  const styles = new Map<ReadNode, { visibility: string; display: string }>();
  const attempts: string[] = [], points: Array<{ x: number; y: number }> = [];
  const forbid = (name: string) => { attempts.push(name); throw new Error(`只读脚本不允许 ${name}`); };
  const matchOne = (source: XmlElement, selector: string): boolean => {
    const token = /^([a-z][\w-]*)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/iu.exec(selector.trim());
    if (!token || !token[1] && !token[2]) throw new Error(`测试DOM不支持的选择器：${selector}`);
    return (!token[1] || source.tagName.toLowerCase() === token[1].toLowerCase())
      && (!token[2] || source.hasAttribute(token[2]) && (token[3] === undefined || source.getAttribute(token[2]) === token[3]));
  };
  const wrap = (source: XmlElement, parentElement: ReadNode | null): ReadNode => {
    const node = {} as ReadNode, children: ReadNode[] = [];
    Object.defineProperties(node, {
      tagName: { get: () => source.tagName.toUpperCase() }, parentElement: { value: parentElement }, children: { value: children },
      id: { get: () => options.namedId && source.tagName === 'form'
        ? nodes.find(candidate => candidate.getAttribute('name') === 'id') ?? source.getAttribute('id') ?? '' : source.getAttribute('id') || '' },
      className: { get: () => source.getAttribute('class') || '' },
      getAttribute: { value: (name: string) => source.getAttribute(name) },
      matches: { value: (selector: string) => selector.split(',').some(part => matchOne(source, part)) },
      closest: { value: (selector: string): ReadNode | null => {
        for (let current: ReadNode | null = node; current; current = current.parentElement) if (current.matches(selector)) return current;
        return null;
      } },
      value: { get: () => forbid('读取字段值'), set: () => forbid('写入字段值') },
      checked: { get: () => forbid('读取checked'), set: () => forbid('写入checked') },
      innerHTML: { get: () => forbid('读取innerHTML'), set: () => forbid('写入innerHTML') },
      textContent: { get: () => forbid('读取文本'), set: () => forbid('写入文本') },
      scrollTop: { set: () => forbid('改写scrollTop') }, scrollLeft: { set: () => forbid('改写scrollLeft') },
      click: { value: () => forbid('click') }, focus: { value: () => forbid('focus') }, blur: { value: () => forbid('blur') },
      dispatchEvent: { value: () => forbid('dispatchEvent') }, scrollIntoView: { value: () => forbid('scrollIntoView') },
      setAttribute: { value: () => forbid('setAttribute') }, appendChild: { value: () => forbid('appendChild') },
    });
    nodes.push(node); sources.set(node, source);
    for (let child = source.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) children.push(wrap(child as XmlElement, node));
    Object.freeze(children);
    return node;
  };
  wrap(xml.documentElement!, null);
  const byId = (id: string) => {
    const node = nodes.find(candidate => candidate.getAttribute('id') === id); assert.ok(node, `测试节点 ${id} 存在`); return node;
  };
  let active = nodes.find(node => node.tagName === 'BODY')!;
  let hit = (_x: number, _y: number): ReadNode | null => nodes.find(node => node.tagName === 'BODY')!;
  const snapshot = () => new XMLSerializer().serializeToString(xml);
  const read = (point?: { x: number; y: number }): WheelTarget => {
    const before = snapshot(), beforeAttempts = attempts.length;
    try {
      const result = runInNewContext(readLocationWheelTarget(point), {
        document: { get activeElement() { return active; }, elementFromPoint(x: number, y: number) { points.push({ x, y }); return hit(x, y); } },
        location: { href: 'https://example.invalid/fictional-locator' }, innerWidth: 900, innerHeight: 700,
        getComputedStyle: (node: ReadNode) => styles.get(node) ?? { visibility: 'visible', display: 'block' },
      }) as WheelTarget;
      return JSON.parse(JSON.stringify(result)) as WheelTarget;
    } finally {
      assert.equal(snapshot(), before, 'generated reader never modifies the document');
      assert.equal(attempts.length, beforeAttempts, 'generated reader never reads values, clicks, focuses, sets values or dispatches events');
    }
  };
  return { byId, read, points, attempts, snapshot,
    active(id: string) { active = byId(id); },
    hit(callback: (x: number, y: number) => ReadNode | null) { hit = callback; },
    style(id: string, visibility: string, display: string) { styles.set(byId(id), { visibility, display }); },
    // Fixture-owned external changes simulate hover rerenders; the generated script cannot call this.
    mutate(id: string, name: string, value: string) { sources.get(byId(id))!.setAttribute(name, value); },
  };
}

test('locator wheel reader selects a visible viewport-edge background without reading or writing form values', () => {
  const dom = fixture('<main id="scroll-area"><div id="safe-surface" class="page-space" /><input id="private-field" value="FICTIONAL_VALUE_NOT_READ" /></main>');
  dom.hit(() => dom.byId('safe-surface')); const result = dom.read();
  assert.deepEqual(Object.keys(result).sort(), ['exists', 'pointerIdentity', 'url', 'x', 'y']);
  assert.equal(result.exists, true); assert.equal(result.x, 12); assert.equal(result.y, 350);
  assert.match(result.pointerIdentity!, /safe-surface/u); assert.doesNotMatch(result.pointerIdentity!, /FICTIONAL_VALUE_NOT_READ/u);
  assert.equal(dom.points.length, 1); assert.equal(dom.attempts.length, 0);
});

test('an unsafe left-edge control is skipped and a safe right-edge background is selected', () => {
  const dom = fixture('<input id="left-control" value="FICTIONAL" /><div id="right-background" />');
  dom.hit(x => dom.byId(x < 100 ? 'left-control' : 'right-background'));
  const result = dom.read(); assert.equal(result.exists, true); assert.equal(result.x, 888); assert.equal(result.y, 350);
  assert.deepEqual(dom.points, [{ x: 12, y: 350 }, { x: 888, y: 350 }]);
});

test('focused native wheel-sensitive fields block all candidate points even when the pointer could hit safe background', () => {
  for (const control of [
    '<select id="active"><option>虚构</option></select>',
    ...['number', 'range', 'date', 'month', 'time'].map(type => `<input id="active" type="${type}" value="FICTIONAL" />`),
    ...['combobox', 'spinbutton', 'slider'].map(role => `<div id="active" role="${role}" />`),
  ]) {
    const dom = fixture(`${control}<div id="safe" />`); dom.active('active'); dom.hit(() => dom.byId('safe'));
    assert.equal(dom.read().exists, false, control); assert.equal(dom.points.length, 0, 'no hit-test is needed while an active wheel control blocks scrolling');
    assert.equal(dom.attempts.length, 0);
  }
});

test('focused descendants of a listbox or menu also block page-wheel candidate selection', () => {
  for (const role of ['listbox', 'menu']) {
    const dom = fixture(`<div role="${role}"><span id="active" /></div><div id="safe" />`);
    dom.active('active'); dom.hit(() => dom.byId('safe')); assert.equal(dom.read().exists, false); assert.equal(dom.points.length, 0);
  }
});

test('pointer hits on inputs, actions, links, popup lists and editable areas never become wheel surfaces', () => {
  for (const element of [
    '<input id="unsafe" />', '<textarea id="unsafe" />', '<select id="unsafe" />', '<button id="unsafe" />', '<a id="unsafe" href="/do-not-open" />',
    ...['combobox', 'button', 'spinbutton', 'slider', 'listbox', 'menu'].map(role => `<div id="unsafe" role="${role}" />`),
    '<div id="unsafe" contenteditable="true" />',
  ]) {
    const dom = fixture(element); dom.hit(() => dom.byId('unsafe'));
    assert.equal(dom.read({ x: 12, y: 350 }).exists, false, element); assert.equal(dom.points.length, 1); assert.equal(dom.attempts.length, 0);
  }
});

test('a descendant inside an action, link, popup or editable wrapper cannot bypass the ancestor check', () => {
  for (const wrapper of ['button', 'a href="/do-not-open"', 'div role="listbox"', 'div role="menu"', 'div contenteditable="true"']) {
    const tag = wrapper.split(' ')[0]!;
    const dom = fixture(`<${wrapper}><span id="unsafe-child" /></${tag}>`); dom.hit(() => dom.byId('unsafe-child'));
    assert.equal(dom.read({ x: 12, y: 350 }).exists, false, wrapper); assert.equal(dom.attempts.length, 0);
  }
});

test('hidden or display-none background points are rejected', () => {
  for (const [visibility, display] of [['hidden', 'block'], ['visible', 'none']]) {
    const dom = fixture('<div id="hidden" />'); dom.style('hidden', visibility!, display!); dom.hit(() => dom.byId('hidden'));
    assert.equal(dom.read({ x: 12, y: 350 }).exists, false);
  }
});

test('hover identity changes are observable at the exact previously chosen point', () => {
  const dom = fixture('<main id="scroll-parent"><div id="safe" class="before-hover" /></main>'); dom.hit(() => dom.byId('safe'));
  const before = dom.read(); assert.equal(before.exists, true);
  dom.mutate('safe', 'class', 'after-hover');
  const after = dom.read({ x: before.x!, y: before.y! });
  assert.equal(after.exists, true); assert.equal(after.x, before.x); assert.equal(after.y, before.y);
  assert.notEqual(after.pointerIdentity, before.pointerIdentity, 'the controller can reject a hover rerender before sending a wheel');
  assert.equal(dom.attempts.length, 0);
});

test('a hover recheck cannot silently substitute another safe candidate for an unsafe original point', () => {
  const dom = fixture('<div id="safe" /><input id="hover-control" /><div id="other-safe" />');
  dom.hit(() => dom.byId('safe')); const before = dom.read();
  dom.hit(x => dom.byId(x === before.x ? 'hover-control' : 'other-safe'));
  const after = dom.read({ x: before.x!, y: before.y! }); assert.equal(after.exists, false);
  assert.equal(dom.points.length, 2, 'only the original point is checked during the hover confirmation');
});

test('nonfinite or nonnumeric requested points are rejected before generating executable page code', () => {
  for (const point of [{ x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: -Infinity }, { x: '12', y: 0 }, { x: 0, y: undefined }]) {
    assert.throws(() => readLocationWheelTarget(point as { x: number; y: number }), /滚动位置无效/u);
  }
});

test('form named properties cannot turn a safe pointer identity into cyclic React objects or field-value reads', () => {
  const dom = fixture('<form id="application-form"><div id="safe" /><input id="named-id-field" name="id" value="FICTIONAL_VALUE_NOT_READ" /></form>', { namedId: true });
  const form = dom.byId('application-form'), input = dom.byId('named-id-field');
  Object.defineProperty(input, '__reactInternalInstance', { value: { stateNode: input }, enumerable: true });
  assert.strictEqual(form.id, input, 'the fixture reproduces the browser form.id named-property behavior');
  dom.hit(() => dom.byId('safe')); const result = dom.read();
  assert.equal(result.exists, true); assert.match(result.pointerIdentity!, /application-form/u);
  assert.doesNotMatch(result.pointerIdentity!, /reactInternalInstance|stateNode|FICTIONAL_VALUE_NOT_READ/u); assert.equal(dom.attempts.length, 0);
});
