import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ApplicationFillQueue } from '../packages/domain/src/application-queue.js';
import { BACKGROUND_READ_FORM, backgroundSnapshot, backgroundWriteScript } from '../packages/browser/src/background-scripts.js';
import { runBackgroundCareerFill, type BackgroundCareerTransport } from '../packages/browser/src/background-career.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import type { Profile } from '../packages/shared/src/contracts.js';

const profile = (): Profile => ({ version: 3, updatedAt: '', fullName: '虚构候选人', fullNameEn: '', email: 'fixture@example.invalid', phone: '',
  school: '', schoolEn: '', degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '' });
const target = (jobId: string) => ({ jobId, company: '虚构公司', title: '虚构岗位', url: `https://example.invalid/jobs/${jobId}` });
const result = () => ({ verifiedCount: 1, pendingCount: 0, message: '虚构普通字段待检查，未提交', canReview: true });

test('two simultaneous starts cannot launch two executors against the same prepared item', async () => {
  let opened = 0;
  const queue = new ApplicationFillQueue({ getProfile: async () => profile(), createPage: async () => {
    opened++; return { dispose() {}, async run() { return result(); } };
  } });
  try {
    await queue.enqueue([target('one')], 3);
    await Promise.allSettled([queue.startPrepared(), queue.startPrepared()]);
    await queue.settled();
    assert.equal(opened, 1, 'a repeated IPC click must not create duplicate draft pages or concurrent writes');
    assert.equal(queue.getState().items.length, 1);
  } finally { queue.dispose(); }
});

test('cancelled pump must settle before a replacement batch can start', async () => {
  let opened = 0, release!: () => void, began!: () => void;
  const running = new Promise<void>(resolve => { began = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const queue = new ApplicationFillQueue({ getProfile: async () => profile(), createPage: async () => {
    opened++; return { dispose() {}, async run() { began(); await wait; return result(); } };
  } });
  try {
    await queue.start([target('old')], 3); await running;
    queue.cancel();
    await assert.rejects(queue.enqueue([target('new')], 3), 'a late old pump must never race a new queue');
    assert.equal(opened, 1);
  } finally { release(); await queue.settled(); queue.dispose(); }
});

test('late success after cancellation does not turn the active item into ready-for-review', async () => {
  let release!: () => void, began!: () => void;
  const running = new Promise<void>(resolve => { began = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const queue = new ApplicationFillQueue({ getProfile: async () => profile(), createPage: async () => ({
    dispose() {}, async run() { began(); await wait; return result(); },
  }) });
  try {
    await queue.start([target('one')], 3); await running; queue.cancel(); release(); await queue.settled();
    assert.equal(queue.getState().status, 'cancelled');
    assert.equal(queue.getState().items[0]!.status, 'cancelled', 'cancellation owns terminal state even if an executor reports late success');
  } finally { release(); await queue.settled(); queue.dispose(); }
});

test('explicitly closing an old draft releases both its memory and duplicate-job guard', async () => {
  let disposed = 0;
  const queue = new ApplicationFillQueue({ getProfile: async () => profile(), createPage: async () => ({
    dispose() { disposed++; }, async run() { return result(); },
  }) });
  try {
    await queue.start([target('one')], 3); await queue.settled();
    const item = queue.getState().items[0]!; queue.closePage(item.id);
    assert.equal(disposed, 1); assert.equal(queue.getPage(item.id), undefined);
    assert.equal(queue.getState().items.find(candidate => candidate.id === item.id)?.canReview, false);
    await queue.enqueue([target('one')], 3);
    assert.equal(queue.getState().items.filter(candidate => candidate.status === 'queued').length, 1);
  } finally { queue.dispose(); }
});

/** Minimal original DOM contract for evaluating the production fixed scripts, never a website copy. */
function pageFixture() {
  class Element {
    parentElement: Element | null = null;
    children: Element[] = [];
    attrs: Record<string, string> = {};
    storedValue = '';
    events: string[] = [];
    throwOnValueRead = false;
    tagName = 'INPUT'; type = 'text'; id = ''; name = ''; maxLength = -1;
    min = ''; max = ''; step = ''; multiple = false; size = 0;
    hidden = false; disabled = false; readOnly = false; required = false; checked = false;
    options: Element[] = []; files: unknown[] = [];
    control: Element|null = null;
    get value(): string { if (this.throwOnValueRead) throw new Error('PASSWORD_VALUE_WAS_READ'); return this.storedValue; }
    set value(value: string) { this.storedValue = value; }
    get text() { return this.attrs.text ?? ''; }
    get labels() { return []; }
    get selectedOptions() { return this.options.filter(option => option.storedValue === this.storedValue); }
    getAttribute(name: string) { return this.attrs[name] ?? null; }
    hasAttribute(name: string) { return name in this.attrs; }
    matches(selector: string): boolean {
      return selector.split(',').some(entry => {
        const part = entry.trim();
        if (part === 'input[type="password"]') return this.tagName === 'INPUT' && this.type === 'password';
        if (part === 'a[href]') return this.tagName === 'A' && 'href' in this.attrs;
        const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
        if (attribute) return attribute[2] === undefined ? this.hasAttribute(attribute[1]!) : this.getAttribute(attribute[1]!) === attribute[2];
        return this.tagName.toLowerCase() === part;
      });
    }
    closest(selector: string): Element | null { for (let node: Element | null = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector: string): Element[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    getBoundingClientRect() { return { x: 20, y: 20, width: 250, height: 32 }; }
    dispatchEvent(event: { type: string }) { this.events.push(event.type); return true; }
  }
  const controls: Element[] = [];
  const add = (label: string, type = 'text', tagName = 'INPUT') => {
    const node = new Element(); node.attrs['aria-label'] = label; node.type = type; node.tagName = tagName; node.id = `control-${controls.length}`; controls.push(node); return node;
  };
  const context = {
    document: { title: '原创后台守卫测试', querySelectorAll: (selector: string) => controls.filter(node => node.matches(selector)),
      querySelector: (selector: string) => controls.find(node => node.matches(selector)) ?? null, getElementById: (id: string) => controls.find(node => node.id === id) ?? null },
    location: { href: 'https://example.invalid/jobs/apply' }, innerWidth: 1280, innerHeight: 900,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    HTMLInputElement: Element, HTMLTextAreaElement: Element, HTMLSelectElement: Element,
    Event: class Event { constructor(readonly type: string) {} },
  };
  const read = () => JSON.parse(JSON.stringify(runInNewContext(BACKGROUND_READ_FORM, context))) as Record<string, any>;
  const write = (index: number, value: string, expected = backgroundSnapshot(read())) => JSON.parse(JSON.stringify(runInNewContext(backgroundWriteScript({
    url: context.location.href, index, value, expectedSnapshot: expected,
  }), context))) as { status: string };
  const wrapLabel=(node:Element,extra?:Element)=>{const label=new Element();label.tagName='LABEL';label.control=node;label.children=extra?[node,extra]:[node];for(const child of label.children)child.parentElement=label;return label;};
  return { controls, add, read, write,wrapLabel };
}

test('ordinary input inside its own native label can be written without clicking the label',()=>{
  const f=pageFixture(),name=f.add('Full name');f.wrapLabel(name);
  assert.equal(f.write(0,'Fictional Candidate').status,'written');assert.equal(name.value,'Fictional Candidate');assert.deepEqual(name.events,['input','change']);
});
test('compound labels and interactive label descendants still block background input',()=>{
  for(const kind of ['checkbox','link','wrong-owner']){
    const f=pageFixture(),name=f.add('Full name'),other=f.add('Other',kind==='checkbox'?'checkbox':'text');
    if(kind==='link'){other.tagName='A';other.attrs.href='https://example.invalid';}
    const label=f.wrapLabel(name,kind==='wrong-owner'?undefined:other);if(kind==='wrong-owner')label.control=other;
    assert.equal(f.write(0,'Fictional Candidate').status,'unsupported');assert.equal(name.value,'');assert.deepEqual(name.events,[]);
  }
});

test('background reader stops at a password page without evaluating any credential value getter', () => {
  const fixture = pageFixture(); const password = fixture.add('密码', 'password'); password.throwOnValueRead = true;
  const raw = fixture.read();
  assert.equal(raw.loginRequired, true);
  assert.equal(raw.fields.length, 0);
  assert.ok(!JSON.stringify(raw).includes('PASSWORD_VALUE_WAS_READ'));
});

test('fixed page script preserves a real selected option beginning with Select', () => {
  const fixture = pageFixture(), selected = fixture.add('学历', 'select-one', 'SELECT');
  const manager = fixture.add('', 'option', 'OPTION'); manager.attrs.text = 'Selection Manager'; manager.storedValue = 'manager';
  const masters = fixture.add('', 'option', 'OPTION'); masters.attrs.text = '硕士'; masters.storedValue = 'masters';
  fixture.controls.splice(1); selected.options = [manager, masters]; selected.storedValue = 'manager';
  assert.equal(fixture.write(0, 'masters').status, 'nonempty');
  assert.equal(selected.storedValue, 'manager'); assert.deepEqual(selected.events, []);
});

test('fixed script compares current whole observation atomically before any setter or events', () => {
  const fixture = pageFixture(), name = fixture.add('姓名'), email = fixture.add('邮箱', 'email');
  const snapshot = backgroundSnapshot(fixture.read()); email.storedValue = 'other@example.invalid';
  assert.equal(fixture.write(0, '虚构姓名', snapshot).status, 'stale');
  assert.equal(name.storedValue, ''); assert.deepEqual(name.events, []);
});

test('fixed script refuses an oversized page rather than silently treating 300 controls as the whole form', () => {
  const fixture = pageFixture(); for (let index = 0; index < 301; index++) fixture.add(index ? '其它字段' : '姓名');
  assert.equal(fixture.read().truncated, true);
  assert.equal(fixture.write(0, '虚构姓名').status, 'unsupported');
  assert.equal(fixture.controls[0]!.storedValue, ''); assert.deepEqual(fixture.controls[0]!.events, []);
});

test('fixed script only changes a blank ordinary target and emits input/change without clicking controls', () => {
  const fixture = pageFixture(), name = fixture.add('姓名'); fixture.add('同意协议', 'checkbox'); fixture.add('附件', 'file');
  const before = fixture.read().protected;
  assert.equal(fixture.write(0, '虚构姓名').status, 'written');
  assert.equal(name.storedValue, '虚构姓名'); assert.deepEqual(name.events, ['input', 'change']);
  assert.deepEqual(fixture.read().protected, before);
  assert.equal(fixture.write(1, 'yes').status, 'unsupported');
  assert.equal(fixture.write(2, 'file.pdf').status, 'unsupported');
});

test('host JSON payload preserves literal angle brackets instead of entering escaped text into the form', () => {
  const fixture = pageFixture(), name = fixture.add('姓名');
  assert.equal(fixture.write(0, '<虚构姓名>').status, 'written');
  assert.equal(name.storedValue, '<虚构姓名>');
});

test('career guard rechecks same-URL navigation after its asynchronous profile read before writing', async () => {
  const candidate = createCareerFormFixtureProfile(), internship = candidate.career!.internships[0]!;
  const raw = { url: 'https://modelbest.jobs.feishu.cn/fixture', supported: true, reason: '', groups: [{
    id: 'internship[0]', kind: 'internship', key: '0', identity: 'fictional-group', fields: [
      { fieldId: 'internship[0].company', path: 'internship[0].company', property: 'company', kind: 'internship', type: 'text', value: internship.organization, editable: true, identity: 'company-field' },
      { fieldId: 'internship[0].title', path: 'internship[0].title', property: 'title', kind: 'internship', type: 'text', value: '', editable: true, identity: 'role-field' },
    ],
  }], addControls: [], protectedControls: [] };
  let generation = 3, profileReads = 0, writes = 0;
  const transport: BackgroundCareerTransport = { read: async () => structuredClone(raw), getProfile: async () => {
    if (++profileReads === 3) generation++;
    return structuredClone(candidate);
  }, getURL: () => raw.url, getGeneration: () => generation, settle: async () => {}, write: async () => { writes++; return { status: 'written' }; } };
  await assert.rejects(runBackgroundCareerFill(transport, candidate, new AbortController().signal, () => {}));
  assert.equal(writes, 0, 'unchanged URL and identical fields cannot authorize writing into a replacement document');
});
