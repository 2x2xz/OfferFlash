import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { FieldCompanion, FIELD_COMPANION_WORLD_ID, placeFieldCompanion, fieldCompanionAttentionRect,fieldCompanionTrail } from '../packages/browser/src/field-companion.js';

class Element {
  parentNode: Element | null = null;
  children: Element[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  textContent = '';
  className = '';
  animations:Array<{playState:string;cancel():void;frames:unknown;options:unknown}>=[];
  constructor(readonly tagName: string, readonly body?: Element) {}
  get isConnected(): boolean { return this.tagName === 'body' || !!this.parentNode?.isConnected; }
  append(...children: Element[]) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  attachShadow(options: { mode: string }) { assert.equal(options.mode, 'closed'); return new Element('shadow'); }
  getAnimations(){return this.animations.filter(animation=>animation.playState!=='idle');}
  animate(frames:unknown,options:unknown){const animation={playState:'running',frames,options,cancel(){this.playState='idle';}};this.animations.push(animation);return animation;}
}

function fixture() {
  const events = new EventEmitter(), body = new Element('body');
  const context = createContext({ document: { body, createElement: (tag: string) => new Element(tag),
    createElementNS: (_namespace: string, tag: string) => new Element(tag) }, innerWidth: 1000, innerHeight: 700, matchMedia:()=>({matches:false}),setTimeout, clearTimeout });
  const calls: Array<{ world: number; code: string; gesture: boolean }> = [];
  let dead = false, error = false, before: (() => Promise<void>) | undefined;
  const contents = Object.assign(events, {
    isDestroyed: () => dead,
    executeJavaScriptInIsolatedWorld: async (world: number, scripts: Array<{ code: string }>, gesture: boolean) => {
      calls.push({ world, code: scripts[0]!.code, gesture });
      const wait = before; before = undefined; if (wait) await wait();
      if (error) throw new Error('isolated decoration unavailable');
      return runInContext(scripts[0]!.code, context);
    },
  });
  const companion = new FieldCompanion(contents as never);
  return { companion, calls, body, events, context, setDead: () => { dead = true; }, setError: () => { error = true; },
    defer: (wait: () => Promise<void>) => { before = wait; } };
}
const target = { phase: 'typing' as const, bounds: { x: 100, y: 100, width: 300, height: 36 } };

test('electric wake is bounded to the viewport, capped to a short tail and rejects non-finite or stationary targets',()=>{
  const wake=fieldCompanionTrail({x:10,y:10},{x:900,y:600},1000,700)!;
  assert.ok(wake.length>=280&&wake.length<310);assert.ok(wake.path.endsWith('L900 600'));
  const values=[...wake.path.matchAll(/[ML](\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/g)];assert.equal(values.length,9);
  assert.equal(wake.arcs.length,5);assert.equal(wake.echoes.length,3);assert.equal(wake.sparks.length,20);assert.equal(wake.streamers.length,7);
  assert.ok(wake.arcs.every(arc=>arc.length<700));assert.ok(wake.ribbon.endsWith(' Z'));
  assert.ok(values.every(value=>Number(value[1])>=0&&Number(value[1])<=1000&&Number(value[2])>=0&&Number(value[2])<=700));
  for(const end of [{x:NaN,y:4},{x:1001,y:4},{x:20,y:-1},{x:10,y:10}])assert.equal(fieldCompanionTrail({x:10,y:10},end,1000,700),undefined);
});

test('only movement between actual supplied targets creates a wake, and attention or reduced motion cancels it',async()=>{
  const value=fixture();await value.companion.show(target);
  const state=runInContext('Object.values(globalThis).find(v=>v?.token&&v?.runner)',value.context);
  assert.equal(state.wakePaths.flatMap((path:Element)=>path.getAnimations()).length,0);
  await value.companion.show({...target,bounds:{...target.bounds,y:350}});
  assert.equal(state.wakePaths.flatMap((path:Element)=>path.getAnimations()).length,8);
  assert.equal(new Set(state.wakePaths.map((path:Element)=>path.attributes.get('d'))).size,6);
  assert.equal(state.wakeEchoes.length,3);assert.equal(state.wakeSparks.length,20);assert.equal(state.wakeStreamers.length,7);
  assert.ok(state.wakePaths.every((path:Element)=>path.attributes.get('d')?.includes('L')));
  await value.companion.show({...target,phase:'verified',bounds:{...target.bounds,y:350}});
  assert.equal(state.wake.style.visibility,'visible');assert.equal(state.wakePaths.flatMap((path:Element)=>path.getAnimations()).length,8);
  await value.companion.show({...target,phase:'attention'});
  assert.equal(state.wakeNodes.flatMap((node:Element)=>node.getAnimations()).length,0);
  assert.equal(state.wake.style.visibility,'hidden');assert.equal(state.wakePaths.flatMap((path:Element)=>path.getAnimations()).length,0);
  await value.companion.setEnabled(true,true);await value.companion.show(target);await value.companion.show({...target,bounds:{...target.bounds,y:350}});
  const reduced=runInContext('Object.values(globalThis).find(v=>v?.token&&v?.runner)',value.context);
  assert.equal(reduced.wake.style.visibility,'hidden');assert.equal(reduced.wakePaths.flatMap((path:Element)=>path.getAnimations()).length,0);
  await value.companion.dispose();
});

test('the companion uses a neighbouring margin and never covers a field or invents a partial offscreen target', () => {
  assert.deepEqual(placeFieldCompanion(target.bounds, 1000, 700), { x: 406, y: 100, facing: 'right' });
  assert.deepEqual(placeFieldCompanion({ x: 650, y: 100, width: 300, height: 36 }, 1000, 700), { x: 596, y: 100, facing: 'left' });
  for (const bounds of [{ x: 10, y: 30, width: 980, height: 36 }, { x: -1, y: 30, width: 300, height: 36 },
    { x: 10, y: -1, width: 300, height: 36 }, { x: 10, y: 690, width: 300, height: 36 },
    { x: 10, y: 30, width: 0, height: 36 }, { x: Infinity, y: 30, width: 300, height: 36 }]) assert.equal(placeFieldCompanion(bounds, 1000, 700), undefined);
});

test('attention accepts only an exact fully visible rectangle, independently of sprite margin space', () => {
  const wide = { x: 10, y: 30, width: 980, height: 36 };
  assert.deepEqual(fieldCompanionAttentionRect(wide, 1000, 700), wide);
  assert.equal(placeFieldCompanion(wide, 1000, 700), undefined);
  for (const bounds of [{ ...wide, x: -1 }, { ...wide, width: 1000 }, { ...wide, height: 0 }, { ...wide, y: Infinity }, { ...wide, y: 690 }]) {
    assert.equal(fieldCompanionAttentionRect(bounds, 1000, 700), undefined);
  }
});

test('attention draws a separate transparent outline when a wide field has no safe sprite position', async () => {
  const value = fixture(), wide = { x: 10, y: 30, width: 980, height: 36 };
  await value.companion.show({ phase: 'attention', bounds: wide });
  const state = runInContext('Object.values(globalThis).find(v=>v?.token&&v?.runner)', value.context);
  assert.equal(state.runner.dataset.visible, 'false'); assert.equal(state.attention.dataset.visible, 'true');
  assert.equal(state.attention.style.width, '980px'); assert.equal(state.attention.style.height, '36px');
  assert.equal(state.attention.style.transform, 'translate3d(10px,30px,0)'); assert.ok(state.attentionTimer);
  await value.companion.show(target);
  assert.equal(state.attention.dataset.visible, 'false'); assert.equal(state.attentionTimer, undefined);
  await value.companion.dispose();
});

test('clear cancels the isolated attention timer and removes only its decorative host', async () => {
  const value = fixture(); await value.companion.show({ ...target, phase: 'attention' });
  const state = runInContext('Object.values(globalThis).find(v=>v?.token&&v?.runner)', value.context);
  const timer = state.attentionTimer; assert.ok(timer); await value.companion.clear();
  assert.equal(timer._destroyed, true); assert.equal(state.attentionTimer, undefined); assert.equal(value.body.children.length, 0);
});

test('only closed shadow SVG decoration is injected in an isolated world without user gesture', async () => {
  const value = fixture(); await value.companion.show(target);
  assert.equal(value.calls.length, 2);
  assert.ok(value.calls.every(call => call.world === FIELD_COMPANION_WORLD_ID && call.gesture === false));
  assert.equal(value.body.children.length, 1);
  const host = value.body.children[0]!;
  assert.equal(host.attributes.get('aria-hidden'), 'true'); assert.equal(host.attributes.has('inert'), true);
  assert.match(host.style.cssText!, /pointer-events:none!important/);
  assert.ok(value.calls.every(call => !/\.focus\(|\.click\(|\.scroll|dispatchEvent|insertText|input\.value|querySelector/.test(call.code)));
  await value.companion.dispose(); assert.equal(value.body.children.length, 0);
});

test('repeated fields reuse one private host while their actual target coordinates change', async () => {
  const value = fixture(); await value.companion.show(target); const host = value.body.children[0];
  await value.companion.show({ phase: 'verified', bounds: { x: 200, y: 350, width: 300, height: 40 } });
  assert.equal(value.body.children.length, 1); assert.equal(value.body.children[0], host);
  const state = runInContext('Object.values(globalThis).find(v=>v?.token&&v?.runner)', value.context);
  assert.equal(state.runner.dataset.phase, 'verified'); assert.deepEqual({ ...state.position }, { x: 506, y: 352, facing: 'right' });
});

test('clear and disable remove only the owned host, preserving a page-created same-tag closed shadow', async () => {
  const value = fixture(); const fake = new Element('offeragent-field-companion'); fake.attachShadow({ mode: 'closed' }); value.body.append(fake);
  await value.companion.show(target); assert.equal(value.body.children.length, 2);
  await value.companion.setEnabled(false); assert.deepEqual(value.body.children, [fake]);
  const count = value.calls.length; await value.companion.show(target); assert.equal(value.calls.length, count);
  await value.companion.setEnabled(true, true); await value.companion.show(target);
  const state = runInContext('Object.values(globalThis).find(v=>v?.token&&v?.runner)', value.context);
  assert.equal(state.runner.dataset.reduced, 'true');
});

test('a body reconstruction does not bind an attacker node and recreates a single owned decoration', async () => {
  const value = fixture(); await value.companion.show(target); const old = value.body.children[0]!; old.remove();
  const fake = new Element('offeragent-field-companion'); value.body.append(fake);
  await value.companion.show(target); assert.equal(value.body.children.length, 2); assert.ok(value.body.children.includes(fake));
  assert.ok(!value.body.children.includes(old)); await value.companion.clear(); assert.deepEqual(value.body.children, [fake]);
});

test('navigation during bootstrap revokes a late show, including an identical URL reload', async () => {
  const value = fixture(); let release!: () => void;
  value.defer(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = value.companion.show(target); await new Promise(resolve => setImmediate(resolve));
  value.events.emit('did-start-navigation', {}, 'https://example.invalid/apply', false, true);
  release(); await pending; await value.companion.clear(); assert.equal(value.body.children.length, 0);
  assert.equal(value.calls.filter(call => call.code.includes('"operation":"show"')).length, 0);
  await value.companion.show(target); assert.equal(value.body.children.length, 1);
});

test('an unresponsive optional bootstrap times out without dispatching a late field animation', async () => {
  const value = fixture(); let release!: () => void;
  value.defer(() => new Promise<void>(resolve => { release = resolve; }));
  await value.companion.show(target);
  assert.equal(value.calls.filter(call => call.code.includes('"operation":"show"')).length, 0);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(value.body.children.length, 0);
  await value.companion.show(target); assert.equal(value.body.children.length, 1);
});

test('iframe navigation does not remove the current main frame companion', async () => {
  const value = fixture(); await value.companion.show(target);
  value.events.emit('did-start-navigation', {}, 'https://example.invalid/frame', false, false);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(value.body.children.length, 1);
});

test('invalid coordinates and phases cannot send executable input, and decoration errors never fail a fill', async () => {
  const value = fixture();
  await value.companion.show({ phase: 'invalid' as never, bounds: target.bounds });
  await value.companion.show({ phase: 'typing', bounds: { ...target.bounds, x: NaN } });
  assert.equal(value.calls.length, 0);
  value.setError(); await assert.doesNotReject(value.companion.show(target)); await assert.doesNotReject(value.companion.clear());
});

test('dispose is idempotent, removes host listeners, and cannot send new commands after destruction', async () => {
  const value = fixture(); await value.companion.show(target); await value.companion.dispose(); await value.companion.dispose();
  assert.equal(value.events.listenerCount('did-start-navigation'), 0); assert.equal(value.events.listenerCount('destroyed'), 0);
  const count = value.calls.length; await value.companion.show(target); assert.equal(value.calls.length, count);
  const dead = fixture(); dead.setDead(); await dead.companion.show(target); assert.equal(dead.calls.length, 0);
});
