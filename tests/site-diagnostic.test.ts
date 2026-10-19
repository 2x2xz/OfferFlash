import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { siteDiagnosticScript } from '../apps/desktop/site-diagnostic-script.js';

class FixtureElement {
  readonly children: FixtureElement[] = [];
  parentElement: FixtureElement | null = null;
  constructor(readonly tagName: string, readonly attributes: Record<string, string> = {}, readonly ownText = '') {}
  append(...elements: FixtureElement[]): this {
    for (const element of elements) { this.children.push(element); element.parentElement = this; }
    return this;
  }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  hasAttribute(name: string) { return Object.hasOwn(this.attributes, name); }
  getBoundingClientRect() { return { width: 240, height: 35 }; }
  contains(other: FixtureElement): boolean { return this === other || this.children.some(child => child.contains(other)); }
  querySelectorAll(selector: string): FixtureElement[] {
    const matches = (element: FixtureElement): boolean => selector.split(',').some(item => {
      const part = item.trim();
      const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      return match ? element.hasAttribute(match[1]!) && (match[2] === undefined || element.getAttribute(match[1]!) === match[2])
        : element.tagName.toLowerCase() === part;
    });
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}

function fixture() {
  const secret = 'private_candidate_91@example.invalid';
  const selected = new FixtureElement('DIV', { 'data-cy': 'selectedValue', class: 'atsx-select-selection-selected-value' }, secret);
  const owner = new FixtureElement('DIV', { 'data-cy': 'education[3].degreeInput', id: secret, class: `atsx-select form-private-candidate` })
    .append(new FixtureElement('INPUT', { name: 'education[3].degree', value: secret, 'aria-controls': secret }), selected);
  const option = new FixtureElement('DIV', { 'data-cy': '2027' }, secret);
  const popup = new FixtureElement('DIV', { 'data-cy': 'education[3].periodInputBeginDropdown', id: 'popup-private-id' })
    .append(new FixtureElement('DIV', { class: 'period-year-column' }).append(option));
  const group = new FixtureElement('DIV', { 'data-cy': 'education', class: 'resume-section' })
    .append(owner, new FixtureElement('SPAN', { class: 'add-button' }, '添加教育经历'), popup);
  const body = new FixtureElement('BODY').append(group,
    new FixtureElement('INPUT', { name: secret, value: secret }),
    new FixtureElement('DIV', { 'data-cy': 'unknown.secret', class: secret }, secret));
  return { body, secret, selected, owner };
}

function observe() {
  const { body, secret } = fixture();
  const result = runInNewContext(siteDiagnosticScript('https://careers.example.invalid'), {
    location: { origin: 'https://careers.example.invalid', href: `https://careers.example.invalid/apply/${secret}?token=${secret}` },
    document: {
      title: secret, querySelectorAll: (selector: string) => body.querySelectorAll(selector),
      getElementById: (id: string) => body.querySelectorAll('[id]').find(element => element.getAttribute('id') === id) ?? null,
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  });
  return { report: JSON.parse(JSON.stringify(result)), secret };
}

test('site diagnostic filters private values, opaque IDs, URLs and arbitrary text inside the page', () => {
  const { report, secret } = observe();
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('form-private-candidate'), false, 'class names use a fixed structural vocabulary');
  assert.equal(serialized.includes('popup-private-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.privateValuesIncluded, false);
  const owner = report.fields.find((field: any) => field.binding.suffix === 'Input');
  assert.deepEqual(owner.classes, ['atsx-select']);
  assert.equal(owner.binding.path, 'education[].degree');
  assert.equal(owner.binding.recordKey, 3);
  assert.equal(owner.selectedValueNodes[0].empty, false);
  assert.match(owner.selectedValueNodes[0].node, /^node-\d+$/);
  assert.equal(report.addControls[0].group, 'education');
  assert.equal(report.periodPopups[0].columns[0].items[0].numericDataCy, 2027);
});

test('site diagnostic requires an exact HTTPS origin and refuses a changed page origin', () => {
  for (const origin of ['http://careers.example.invalid', 'https://careers.example.invalid/path', 'https://user:pass@careers.example.invalid']) {
    assert.throws(() => siteDiagnosticScript(origin));
  }
  assert.throws(() => runInNewContext(siteDiagnosticScript('https://careers.example.invalid'), {
    location: { origin: 'https://login.example.invalid' },
  }), /ORIGIN_CHANGED/);
});

test('diagnostic entry is isolated from the ordinary backend and exposes only named fixed requests', async () => {
  const source = await readFile(new URL('../apps/desktop/site-diagnostic.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../apps/desktop/site-diagnostic-preload.cjs', import.meta.url), 'utf8');
  assert.equal(/createStore|AgentBridge|utilityProcess|OFFERAGENT_LIVE_FORM_API_KEY|readFile|capturePage|cookies|localStorage/.test(source), false);
  assert.match(source, /feishu-site-diagnostic/);
  assert.match(source, /mode: 0o600, flag: 'wx'/);
  assert.match(source, /siteDiagnosticScript\(selectedOrigin\)/);
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]), [
    'site-diagnostic:navigate', 'site-diagnostic:read', 'site-diagnostic:status', 'site-diagnostic:validate',
  ]);
  assert.match(source, /if \(!labEnabled \|\| reading \|\| validating/);
  assert.match(source, /selectedOrigin !== 'https:\/\/modelbest\.jobs\.feishu\.cn'/);
  assert.match(source, /join\(projectRoot, 'dist\/desktop\/feishu-site-lab\.js'\)/);
  assert.match(source, /module\.runFeishuSiteLab\(\{ window, view, directory, getGeneration:/);
  assert.match(source, /const module = await import\(pathToFileURL\(modulePath\)\.href\)/);
});
