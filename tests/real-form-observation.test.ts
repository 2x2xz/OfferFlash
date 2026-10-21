import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { DOMParser, XMLSerializer, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';
import { READ_FORM } from '../packages/browser/src/read-scripts.js';
import { fieldSignature, matchFields, matchProfileKey, normalizeFieldLabel, pageSignature } from '../packages/forms/src/index.js';
import { buildModelFormInput, parseModelMappings } from '../packages/forms/src/model-recognition.js';
import type { FieldObservation, FormObservation, Profile } from '../packages/shared/src/contracts.js';

const profile: Profile = {
  version: 1, updatedAt: '2026-10-17T00:00:00Z', fullName: '虚构候选人', fullNameEn: 'Fictional Candidate',
  email: 'candidate@example.invalid', phone: '13800000000', school: '虚构高校', schoolEn: 'Fictional University',
  degree: '硕士', major: '计算机科学', majorEn: 'Computer Science', graduationMonth: '2027-06',
  skills: [], cities: [], targetRoles: [], resumeText: '',
};

/** Small read-only DOM adapter: original short HTML shapes, no enterprise page copy. */
function read(html: string): FormObservation {
  const xml = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'application/xhtml+xml');
  const source = new XMLSerializer().serializeToString(xml);
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
    get value() { return this.getAttribute('value') || (this.tagName === 'TEXTAREA' ? this.node.textContent : '') || ''; }
    get hidden() { return this.node.hasAttribute('hidden'); }
    get required() { return this.node.hasAttribute('required'); }
    get disabled() { return this.node.hasAttribute('disabled'); }
    get readOnly() { return this.node.hasAttribute('readonly'); }
    get multiple() { return this.node.hasAttribute('multiple'); }
    get size() { return Number(this.getAttribute('size') || 0); }
    get options() { return this.querySelectorAll('option'); }
    get text() { return this.node.textContent || ''; }
    get labels() {
      return root.querySelectorAll('label').filter(label => label.getAttribute('for') === this.id && this.id !== ''
        || this.closest('label') === label);
    }
    getAttribute(name: string) { return this.node.getAttribute(name); }
    hasAttribute(name: string) { return this.node.hasAttribute(name); }
    matches(selector: string): boolean {
      return selector.split(',').some(part => {
        const value = part.trim();
        if (value.startsWith('.')) return (this.getAttribute('class') || '').split(/\s+/).includes(value.slice(1));
        const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
        if (attr) return attr[2] === undefined ? this.node.hasAttribute(attr[1]!) : this.getAttribute(attr[1]!) === attr[2];
        return this.tagName.toLowerCase() === value.toLowerCase();
      });
    }
    closest(selector: string): Element | null {
      for (let node: Element | null = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    querySelectorAll(selector: string): Element[] {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { x: 20, y: 20, width: 240, height: 32 }; }
  }
  const root = new Element(xml.documentElement!, null);
  const raw = runInNewContext(READ_FORM, {
    document: {
      title: '原创招聘表单结构测试', querySelectorAll: (selector: string) => root.querySelectorAll(selector),
      getElementById: (id: string) => id ? [...elements.values()].find(element => element.id === id) : null,
      createTreeWalker: (root: Element, _type: number, filter: { acceptNode(node: object): number }) => {
        const textNodes: Array<{ nodeValue: string | null; parentElement: Element | undefined }> = [];
        const visit = (node: XmlNode) => {
          if (node.nodeType === 3) {
            const observed = { nodeValue: node.nodeValue, parentElement: elements.get(node.parentNode!) };
            if (filter.acceptNode(observed) === 1) textNodes.push(observed);
          }
          for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
        };
        visit(root.node);
        let index = -1;
        return { currentNode: null as object | null, nextNode() { this.currentNode = textNodes[++index] || null; return this.currentNode; } };
      },
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    location: { href: 'https://fixture.example.invalid/apply' }, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: (element: Element) => ({
      display: /display\s*:\s*none/.test(element.getAttribute('style') || '') || element.hidden ? 'none' : 'block',
      visibility: /visibility\s*:\s*hidden/.test(element.getAttribute('style') || '') ? 'hidden' : 'visible',
    }),
  }) as { fields: Array<Omit<FieldObservation, 'id' | 'signature'>> };
  assert.equal(new XMLSerializer().serializeToString(xml), source, 'the observation never changes the HTML or field values');
  const fields = (JSON.parse(JSON.stringify(raw.fields)) as typeof raw.fields).map(field => ({
    ...field, id: `field-${field.index}`, signature: fieldSignature(field),
  }));
  return { id: 'fixture', url: 'https://fixture.example.invalid/apply', title: '原创测试',
    observedAt: '2026-10-17T00:00:00Z', signature: pageSignature(fields), fields };
}

test('nested div/span field titles support ordinary facts without using placeholder or another field label', () => {
  const observation = read('<section><div>个人信息</div><div><div><span>* 姓名</span></div><div><input placeholder="请输入" /></div></div><div><span>邮箱</span><div><input placeholder="请输入" /></div></div></section>');
  assert.equal(observation.fields[0]!.label, '* 姓名'); assert.equal(observation.fields[0]!.required, true);
  assert.equal(observation.fields[1]!.label, '邮箱'); assert.equal(observation.fields[1]!.section, '个人信息');
  assert.deepEqual(matchFields(observation, profile).map(item => item.profileKey), ['fullName', 'email']);
  assert.ok(matchFields(observation, profile).every(item => item.status === 'ready'));
});

test('div section titles retain other-person protection; ambiguous generic titles and shared wrappers do not guess', () => {
  const protectedForm = read('<section><div>紧急联系人</div><div><span>姓名</span><input placeholder="请输入" /></div><div><span>电话</span><input placeholder="请输入" /></div></section>');
  assert.ok(matchFields(protectedForm, profile).every(item => item.status === 'skip'));
  const ambiguous = read('<div><span>姓名</span><span>邮箱</span><input placeholder="请输入" /></div>');
  assert.equal(ambiguous.fields[0]!.label, '请输入');
  const shared = read('<div><span>姓名</span><input placeholder="请输入" /><input placeholder="请输入" /></div>');
  assert.ok(shared.fields.every(field => field.label === '请输入'));
});

test('Unicode required stars preserve known key matching and reject conflicting model mappings', () => {
  const observation = read('<label for="name">Full name ✱</label><input id="name"/><label for="email">Email ∗</label><input id="email"/><label for="phone">Phone ＊</label><input id="phone"/>');
  assert.deepEqual(observation.fields.map(matchProfileKey), ['fullName', 'email', 'phone']);
  assert.deepEqual(matchFields(observation, profile).map(item => item.status), ['ready', 'ready', 'ready']);
  assert.equal(normalizeFieldLabel('Full name ✱'), normalizeFieldLabel('Full name'));
  assert.notEqual(normalizeFieldLabel('Email or phone'), normalizeFieldLabel('Email'));
  assert.throws(() => parseModelMappings('{"mappings":[{"fieldId":"field-0","profileKey":"email"}]}', buildModelFormInput(observation, profile), observation), /已知字段含义冲突/);
});

test('unassociated question labels describe only their own fields and override generic placeholders', () => {
  const observation = read(`<div class="application-question"><div class="application-label">Which university do you attend?</div><div><p>Enter your answer below</p><input placeholder="Type your response"/></div></div>
    <div class="application-question"><div class="application-label">Where can we email you?</div><div><input placeholder="Type your response"/></div></div>`);
  assert.deepEqual(observation.fields.map(field => field.label), ['Which university do you attend?', 'Where can we email you?']);
  assert.deepEqual(observation.fields.map(field => field.section), ['Which university do you attend?', 'Where can we email you?']);
});

test('explicit ARIA and native label associations remain ahead of nearby questions', () => {
  const observation = read(`<div class="application-question"><div class="application-label">Nearby title</div><p id="email-label">Email</p><input aria-labelledby="email-label" placeholder="Type your response"/></div>
    <div><p>Nearby prompt</p><label for="name">Full name</label><input id="name" aria-label="Applicant name"/></div>`);
  assert.deepEqual(observation.fields.map(field => field.label), ['Email', 'Applicant name']);
});

test('generic wrappers require a single visible control and an unambiguous local label', () => {
  const observation = read(`<div><p>Preferred contact number</p><input placeholder="Type your response"/></div>
    <div><label for="outside">Email</label><input id="other" placeholder="Keep placeholder"/></div>
    <div><p>Shared heading must not label either control</p><input placeholder="First field"/><input placeholder="Second field"/></div>
    <div><p>First possible question</p><p>Second possible question</p><input placeholder="Ambiguous"/></div>`);
  assert.deepEqual(observation.fields.map(field => field.label), ['Preferred contact number', 'Keep placeholder', 'First field', 'Second field', 'Ambiguous']);
});

test('radio options retain their own labels and obtain the same question section', () => {
  const observation = read(`<div class="application-question"><div class="application-label">Do you need visa sponsorship?</div>
    <label>Yes<input type="radio" name="visa"/></label><label>No<input type="radio" name="visa"/></label></div>
    <fieldset><legend>Emergency contact</legend><label for="email">Email</label><input id="email"/></fieldset>`);
  assert.deepEqual(observation.fields.slice(0, 2).map(field => field.label), ['Yes', 'No']);
  assert.deepEqual(observation.fields.slice(0, 2).map(field => field.section), ['Do you need visa sponsorship?', 'Do you need visa sponsorship?']);
  assert.equal(observation.fields[2]?.section, 'Emergency contact');
  assert.ok(matchFields(observation, profile).every(item => item.status === 'skip'));
});

test('visible questions exclude textarea/select contents, hidden text and current input values', () => {
  const observation = read(`<div class="application-question"><div class="application-label">Email <span hidden="hidden">HIDDEN_PRIVATE_MARKER</span><textarea>TEXTAREA_PRIVATE_MARKER</textarea><select><option>OPTION_PRIVATE_MARKER</option></select></div>
    <input value="CURRENT_PRIVATE_MARKER" placeholder="Type your response"/></div>
    <div style="display:none"><p id="hidden-label">ANOTHER_HIDDEN_MARKER</p></div><input aria-labelledby="hidden-label" placeholder="Visible fallback"/>`);
  const input = observation.fields.find(field => field.value === 'CURRENT_PRIVATE_MARKER')!;
  assert.equal(input.label, 'Type your response', 'a question containing additional native controls cannot claim this field');
  assert.equal(input.section, 'Email');
  const text = JSON.stringify(observation.fields.map(field => ({ label: field.label, section: field.section })));
  for (const marker of ['HIDDEN_PRIVATE_MARKER', 'TEXTAREA_PRIVATE_MARKER', 'OPTION_PRIVATE_MARKER', 'CURRENT_PRIVATE_MARKER', 'ANOTHER_HIDDEN_MARKER']) assert.equal(text.includes(marker), false);
  assert.equal(observation.fields.at(-1)?.label, 'Visible fallback');
});

test('other-person, sensitive and agreement questions remain protected after local question discovery', () => {
  const observation = read(`<div class="application-question"><div class="application-label">Emergency contact email ✱</div><input value="PRIVATE_CONTACT"/></div>
    <div class="application-question"><div class="application-label">Passport number ∗</div><input value="PRIVATE_PASSPORT"/></div>
    <div class="application-question"><div class="application-label">I accept the privacy terms</div><input/></div>
    <div class="application-question"><div class="application-label">Emergency contact</div><div class="form-section"><label for="nested-email">Email</label><input id="nested-email"/></div></div>`);
  assert.deepEqual(observation.fields.slice(0, 2).map(field => field.value), ['[已有值]', '[已有值]']);
  assert.ok(matchFields(observation, profile).every(item => item.status === 'skip' && item.value === ''));
  assert.equal(buildModelFormInput(observation, profile).fields.length, 0);
});

test('unbound ARIA combobox inputs are observed but cannot be model-mapped or marked ready as plain text', () => {
  const observation = read('<label for="school">University</label><input id="school" role="combobox" aria-expanded="false"/><label for="email">Email</label><input id="email"/>');
  assert.equal(observation.fields[0]?.type, 'combobox');
  const rows = matchFields(observation, profile);
  assert.equal(rows[0]?.status, 'review');
  assert.match(rows[0]!.reason, /自定义下拉.*手动选择/);
  assert.equal(rows[0]?.value, '');
  assert.deepEqual(buildModelFormInput(observation, profile).fields.map(field => field.fieldId), ['field-1']);
  assert.equal(rows[1]?.status, 'ready');
});

test('an aria-hidden required widget proxy is excluded without renumbering the actual ARIA-labeled phone', () => {
  // Original compact HTML reproducing the observed Greenhouse widget shape,
  // including its plain-text required proxy; no enterprise page is bundled.
  const observation = read(`<div role="group" aria-label="Phone">
    <input type="text" required="required" tabindex="-1" aria-hidden="true" style="opacity:0;pointer-events:none"/>
    <span id="country-label">Country</span><input role="combobox" aria-labelledby="country-label"/>
    <span id="phone-label">Phone</span><input type="tel" aria-labelledby="phone-label"/>
  </div>`);
  assert.deepEqual(observation.fields.map(field => ({ id: field.id, index: field.index, label: field.label, type: field.type })), [
    { id: 'field-1', index: 1, label: 'Country', type: 'combobox' },
    { id: 'field-2', index: 2, label: 'Phone', type: 'tel' },
  ]);
  const rows = matchFields(observation, profile);
  assert.deepEqual(rows.map(item => item.status), ['review', 'ready']);
  assert.equal(rows[1]?.value, profile.phone);
  assert.deepEqual(buildModelFormInput(observation, profile).fields.map(field => field.fieldId), ['field-2']);
});

test('control filtering respects explicit hidden ancestors without treating opacity or widget classes as hidden', () => {
  const observation = read(`<input aria-hidden="true" aria-label="Hidden direct"/>
    <div aria-hidden="true"><input aria-hidden="false" aria-label="Hidden ancestor"/></div>
    <div hidden="hidden"><input aria-label="Hidden attribute ancestor"/></div>
    <div style="display:none"><input aria-label="Hidden display ancestor"/></div>
    <div style="visibility:hidden"><input aria-label="Hidden visibility ancestor"/></div>
    <span id="visible-phone-label">Phone</span><input type="tel" aria-labelledby="visible-phone-label"/>
    <input class="requiredInput" style="opacity:0;pointer-events:none" aria-label="Email"/>`);
  assert.deepEqual(observation.fields.map(field => field.index), [5, 6]);
  assert.deepEqual(observation.fields.map(field => field.label), ['Phone', 'Email']);
  assert.deepEqual(observation.fields.map(field => field.id), ['field-5', 'field-6']);
});

test('Phoenix explicit field titles outrank nested widget hints without granting unbound select writes', () => {
  const control=(title:string,html:string)=>`<div class="form-item form-item--phoenix"><div class="form-item__title"><label>${title}</label></div><div class="form-item__control">${html}</div></div>`;
  const deep='<div>'.repeat(6)+'<div class="phoenix-select"><div>请选择</div><input class="phoenix-select__input" placeholder="请选择"/></div>'+'</div>'.repeat(6);
  const observation=read(control('姓名','<div><input placeholder="请输入"/></div>')+control('手机号码','<div><div>中国大陆</div><input value="13800000000"/></div>')+control('邮箱','<input placeholder="请输入"/>')+control('学历',deep));
  assert.deepEqual(observation.fields.map(f=>f.label),['姓名','手机号码','邮箱','学历']);
  assert.equal(observation.fields[3]!.type,'combobox');assert.equal(observation.fields[3]!.customSelect,undefined);
  const rows=matchFields(observation,profile);assert.deepEqual(rows.map(f=>f.status),['ready','skip','ready','review']);
  assert.match(rows[3]!.reason,/自定义下拉/);
});

test('Phoenix ambiguous ownership does not choose between multiple titles or sibling fields',()=>{
  const observation=read('<div class="form-item form-item--phoenix"><div class="form-item__title"><label>姓名</label></div><div class="form-item__title"><label>邮箱</label></div><input placeholder="请输入"/></div><div class="form-item form-item--phoenix"><div class="form-item__title"><label>姓名</label></div><input placeholder="请输入"/><input placeholder="请输入"/></div>');
  assert.ok(observation.fields.every(f=>f.label==='请输入'));
  assert.ok(matchFields(observation,profile).every(f=>f.status==='review'));
});
