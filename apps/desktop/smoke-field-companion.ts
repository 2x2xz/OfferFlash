import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserWindow, session } from 'electron';
import { FieldCompanion, FIELD_COMPANION_WORLD_ID } from '../../packages/browser/src/field-companion.js';
import { READ_FORM, locationObservationSnapshot, revealObservedField } from '../../packages/browser/src/read-scripts.js';
import { createFeishuFixtureScripts } from '../../packages/browser/src/feishu-scripts.js';
import type { BrowserBounds } from '../../packages/shared/src/contracts.js';

/** Hidden owned Chromium only: no normal database/session, paid provider, OS input or enterprise URL. */
export async function smokeFieldCompanion(screenshotDirectory?:string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-field-companion-only')
    || process.argv.some(arg => arg.startsWith('--smoke-') && !['--smoke-test', '--smoke-field-companion-only'].includes(arg))
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic')) throw new Error('字段小助手仅允许专用隐藏隔离检查。');
  const checks: Array<{ name: string; passed: true }> = [];
  const check = (value: unknown, name: string, diagnostic?: unknown) => {
    assert.ok(value, diagnostic === undefined ? name : name + ' ' + JSON.stringify(diagnostic)); checks.push({ name, passed: true });
  };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const html = await readFile(join(root, 'apps/desktop/fixtures/feishu-career.html'), 'utf8');
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || !['/form', '/other'].includes(request.url ?? '')) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html);
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => done()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('隔离样表地址无效。');
  const origin = `http://127.0.0.1:${address.port}`;
  const ownSession = session.fromPartition(`field-companion-${randomUUID()}`);
  let externalNetworkRequests = 0, ownDebugger = false;
  ownSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === origin + '/form' || details.url === origin + '/other';
    if (!allowed) externalNetworkRequests++;
    callback({ cancel: !allowed });
  });
  const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: {
    session: ownSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const contents = window.webContents, companion = new FieldCompanion(contents);
  const read = <T = unknown>(script: string) => contents.executeJavaScript(script, false) as Promise<T>;
  const inspect = () => contents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID, [{ code: `(() => {
    const values=Object.keys(globalThis).filter(key=>key.startsWith('__offeragentFieldCompanion_')).map(key=>globalThis[key]);
    const state=values.find(value=>value?.runner&&value?.host?.isConnected);
    if(!state)return {visible:false,ownedCount:0};
    const r=state.runner.getBoundingClientRect(),s=getComputedStyle(state.runner),all=[...state.root.querySelectorAll('*')],a=state.attention,
      ar=a?.getBoundingClientRect(),as=a&&getComputedStyle(a);
    return {visible:state.runner.dataset.visible==='true'&&s.visibility==='visible',ownedCount:values.filter(v=>v?.host?.isConnected).length,
      x:r.x,y:r.y,width:r.width,height:r.height,phase:state.runner.dataset.phase,transition:s.transitionDuration,
      closed:state.host.shadowRoot===null,pointer:getComputedStyle(state.host).pointerEvents,
      wake:state.wake?{visible:getComputedStyle(state.wake).visibility,echoes:state.wakeEchoes?.map(n=>({opacity:Number(getComputedStyle(n).opacity),transform:n.getAttribute('transform')})),sparks:state.wakeSparks?.length,streamers:state.wakeStreamers?.map(n=>({d:n.getAttribute('d'),fill:getComputedStyle(n).fill,opacity:Number(getComputedStyle(n).opacity)})),paths:state.wakePaths.map(p=>({d:p.getAttribute('d'),length:p.getTotalLength(),animations:p.getAnimations().map(a=>({duration:a.effect.getComputedTiming().duration,state:a.playState}))}))}:null,
      hasControls:all.some(n=>n.matches('input,textarea,select,button,a,[tabindex],[contenteditable]')),
      allPointerNone:all.every(n=>getComputedStyle(n).pointerEvents==='none'),
      reduced:all.every(n=>getComputedStyle(n).animationName==='none')&&s.transitionDuration==='0s',
      attention:a?{visible:as.visibility==='visible'&&Number(as.opacity)>.5,opacity:Number(as.opacity),background:as.backgroundColor,
        x:ar.x,y:ar.y,width:ar.width,height:ar.height,outline:as.outlineStyle,pointer:as.pointerEvents,transition:as.transitionDuration,
        dataVisible:a.dataset.visible,timerPending:state.attentionTimer!==undefined,at:performance.now(),
        animations:a.getAnimations().map(animation=>({kind:animation.constructor.name,property:animation.transitionProperty??null,currentTime:animation.currentTime,playState:animation.playState,timing:animation.effect?.getComputedTiming()}))}:null,
      hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.tagName||''};
  })()` }], false) as Promise<Record<string, any>>;
  // The test controls only this owned decoration's existing Chromium transition.
  // Capture in the mutation microtask so host/IPC scheduling cannot skip its middle.
  const armTransformSampling = () => contents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID, [{ code: `(() => {
    const state=Object.keys(globalThis).filter(key=>key.startsWith('__offeragentFieldCompanion_')).map(key=>globalThis[key]).find(v=>v?.runner&&v?.host?.isConnected);
    if(!state)throw new Error('owned companion missing before transition sampling');
    state.smokeMotionObserver?.disconnect();state.smokeMotionAnimation=undefined;state.smokeMotionCapture=undefined;
    state.smokeMotionObserver=new MutationObserver(()=>{
      state.smokeMotionObserver.disconnect();
      const r=state.runner,transform=getComputedStyle(r).transform,animations=r.getAnimations(),transitions=animations.filter(a=>a instanceof CSSTransition&&a.transitionProperty==='transform');
      state.smokeMotionCapture={at:performance.now(),transform,transitionDuration:getComputedStyle(r).transitionDuration,
        candidates:animations.map(a=>({kind:a.constructor.name,property:a.transitionProperty??null,currentTime:a.currentTime,playState:a.playState,timing:a.effect?.getComputedTiming()}))};
      if(transitions.length===1){const animation=transitions[0];animation.pause();animation.currentTime=0;state.smokeMotionAnimation=animation;}
      for(const path of state.wakeNodes??[])for(const animation of path.getAnimations()){animation.pause();animation.currentTime=240;}
    });
    state.smokeMotionObserver.observe(state.runner,{attributes:true,attributeFilter:['style']});
    return true;
  })()` }], false);
  const sampleTransform = (operation: 'initial-finish' | 'middle' | 'finish') => contents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID, [{ code: `(() => {
    const state=Object.keys(globalThis).filter(key=>key.startsWith('__offeragentFieldCompanion_')).map(key=>globalThis[key]).find(v=>v?.runner&&v?.host?.isConnected);
    if(!state)return {exists:false};
    const runner=state.runner;getComputedStyle(runner).transform;
    if(${JSON.stringify(operation)}==='initial-finish')for(const a of runner.getAnimations())if(a instanceof CSSTransition&&a.transitionProperty==='transform')a.finish();
    const animation=state.smokeMotionAnimation;
    if(animation&&${JSON.stringify(operation)}==='middle'){animation.pause();animation.currentTime=80;}
    if(animation&&${JSON.stringify(operation)}==='finish')animation.finish();
    const r=runner.getBoundingClientRect(),style=getComputedStyle(runner);
    return {exists:true,x:r.x,y:r.y,width:r.width,height:r.height,transform:style.transform,at:performance.now(),
      captured:!!animation,capture:state.smokeMotionCapture??null,
      animation:animation?{kind:animation.constructor.name,property:animation.transitionProperty,currentTime:animation.currentTime,playState:animation.playState,timing:animation.effect?.getComputedTiming()}:null};
  })()` }], false) as Promise<Record<string, any>>;
  // Capture both opacity transitions where the production code changes its own
  // decoration state. The real production timer is never replaced or advanced.
  const armAttentionSampling = () => contents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID, [{ code: `(() => {
    const state=Object.keys(globalThis).filter(key=>key.startsWith('__offeragentFieldCompanion_')).map(key=>globalThis[key]).find(v=>v?.attention&&v?.host?.isConnected);
    if(!state)throw new Error('owned attention outline missing before opacity sampling');
    state.smokeAttentionObserver?.disconnect();
    const target=state.attention,baselineStyle=getComputedStyle(target),baselineRect=target.getBoundingClientRect();
    state.smokeAttentionTiming={method:'real-production-timer-and-captured-native-opacity-transition-seek-half-finish',
      baseline:{at:performance.now(),opacity:Number(baselineStyle.opacity),visibility:baselineStyle.visibility,dataVisible:target.dataset.visible,
        x:baselineRect.x,y:baselineRect.y,width:baselineRect.width,height:baselineRect.height},events:[]};
    state.smokeAttentionObserver=new MutationObserver(()=>{
      const r=target.getBoundingClientRect(),style=getComputedStyle(target),animations=target.getAnimations(),
        transitions=animations.filter(animation=>animation instanceof CSSTransition&&animation.transitionProperty==='opacity');
      const event={at:performance.now(),dataVisible:target.dataset.visible,timerPending:state.attentionTimer!==undefined,
        before:{opacity:Number(style.opacity),visibility:style.visibility,x:r.x,y:r.y,width:r.width,height:r.height,
          background:style.backgroundColor,outline:style.outlineStyle,pointer:style.pointerEvents,transitionDuration:style.transitionDuration},
        candidates:animations.map(animation=>({kind:animation.constructor.name,property:animation.transitionProperty??null,currentTime:animation.currentTime,playState:animation.playState,timing:animation.effect?.getComputedTiming()})),
        captured:false,middle:null,finished:null};
      if(transitions.length===1){
        const animation=transitions[0],duration=animation.effect.getComputedTiming().duration;
        animation.pause();animation.currentTime=Number(duration)/2;
        event.captured=true;event.middle={opacity:Number(getComputedStyle(target).opacity),currentTime:animation.currentTime,playState:animation.playState,duration};
        // Only existing transitions on this decorative node are completed.
        for(const existing of animations)if(existing instanceof CSSTransition)existing.finish();
        const after=getComputedStyle(target);
        event.finished={opacity:Number(after.opacity),visibility:after.visibility,currentTime:animation.currentTime,playState:animation.playState};
      }
      state.smokeAttentionTiming.events.push(event);
    });
    state.smokeAttentionObserver.observe(target,{attributes:true,attributeFilter:['data-visible']});
    return state.smokeAttentionTiming;
  })()` }], false) as Promise<Record<string, any>>;
  const attentionSampling = (stop = false) => contents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID, [{ code: `(() => {
    const state=Object.keys(globalThis).filter(key=>key.startsWith('__offeragentFieldCompanion_')).map(key=>globalThis[key]).find(v=>v?.attention&&v?.host?.isConnected);
    if(!state)return {events:[],missing:true};
    if(${JSON.stringify(stop)})state.smokeAttentionObserver?.disconnect();
    return state.smokeAttentionTiming??{events:[],missing:true};
  })()` }], false) as Promise<Record<string, any>>;
  const awaitRealAttentionTimer = async () => {
    const until = performance.now() + 8000; let timing = await attentionSampling();
    while (!timing.events?.some((event: any) => event.dataVisible === 'false') && performance.now() < until) {
      await delay(30); timing = await attentionSampling();
    }
    return timing;
  };
  const formState = () => read(`(() => ({active:document.activeElement?.id||'',scroll:[scrollX,scrollY],size:[document.body.scrollWidth,document.body.scrollHeight],
    fields:[...document.querySelectorAll('input,textarea,select')].map(n=>({id:n.id,value:n.value,checked:n.checked,files:n.files?.length??0})),
    counts:JSON.stringify(window.feishuCareerFixture),bridge:typeof window.offer,
    hits:['fixture-existing-email','fictional-education[0].school'].map(id=>{const n=document.getElementById(id),r=n.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===n})}))()`);
  const bounds = (id: string) => read<BrowserBounds>(`(() => {const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  try {
    await contents.loadURL(origin + '/form');
    check(!window.isVisible() && !contents.isFocused(), 'ownedChromiumRemainsHiddenWithoutOSInputFocus');
    if (!contents.debugger.isAttached()) { contents.debugger.attach('1.3'); ownDebugger = true; }
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    // The deliberate same-tag closed shadow is page-owned and must never be reused or removed.
    await read(`(() => {const fake=document.createElement('offeragent-field-companion');fake.id='page-owned-fake';fake.attachShadow({mode:'closed'});document.body.append(fake);
      const wide=document.createElement('input');wide.id='fixture-attention-wide';wide.setAttribute('aria-label','原创宽字段定位样本');wide.readOnly=true;
      wide.style.cssText='position:fixed;left:10px;bottom:10px;width:calc(100% - 20px);height:32px';document.body.append(wide);
      document.getElementById('fixture-existing-email').focus();})()`);
    const scripts = createFeishuFixtureScripts(origin);
    const before = await formState(), ordinary = await read(READ_FORM), career = await read<any>(scripts.READ_FEISHU_CAREER);
    check(career.supported && career.groups.length === 1, 'realFeishuObserverRecognizesTheOriginalOwnedFixture');
    const first = await bounds('fixture-existing-email'), second = await bounds('fictional-education[0].school');
    await companion.show({ phase: 'approach', bounds: first });
    const initialAnimation = await sampleTransform('initial-finish');
    const firstSprite = await inspect();
    check(firstSprite.visible && firstSprite.phase === 'approach' && firstSprite.width === 48 && firstSprite.height === 36
      && (firstSprite.x >= first.x + first.width || firstSprite.x + firstSprite.width <= first.x)
      && firstSprite.y < first.y + first.height && firstSprite.y + firstSprite.height > first.y,
      'actualSVGIsPaintedBesideTheFirstObservedField', {first,firstSprite,initialAnimation});
    check(firstSprite.closed && firstSprite.pointer === 'none' && firstSprite.allPointerNone && !firstSprite.hasControls, 'closedInertDecorationHasNoInteractiveControlsOrPointerSurface');
    check(!String(firstSprite.hit).startsWith('OFFERAGENT'), 'elementFromPointPassesThroughTheActualPaintedSprite');
    await armTransformSampling();
    await companion.show({ phase: 'typing', bounds: second });
    // Deliberately exceed the production transition's 240ms duration after it
    // has been captured/paused: subsequent samples must use its animation clock.
    await delay(300);
    const intermediate = await sampleTransform('middle'), finishedAnimation = await sampleTransform('finish'), secondSprite = await inspect();
    const motionTiming = { method: 'captured-native-CSSTransition-pause-seek-80ms-finish', first, second, initialAnimation, firstSprite, intermediate, finishedAnimation, secondSprite };
    check(intermediate.captured && intermediate.animation?.kind === 'CSSTransition' && intermediate.animation?.property === 'transform'
      && intermediate.animation.currentTime === 80 && intermediate.animation.playState === 'paused'
      && finishedAnimation.animation?.playState === 'finished'
      && Math.abs(firstSprite.y - secondSprite.y) > 40 && Math.abs(intermediate.y - firstSprite.y) > 1 && Math.abs(intermediate.y - secondSprite.y) > 1,
      'actualChromiumTransformMovesBetweenTwoRealObservedFieldRectangles', motionTiming);
    check(secondSprite.wake?.visible==='visible' && secondSprite.wake.paths.length===8 && new Set(secondSprite.wake.paths.map((p:any)=>p.d)).size===6 && secondSprite.wake.echoes.length===3 && secondSprite.wake.echoes.every((e:any)=>e.opacity>0&&e.opacity<.4) && secondSprite.wake.sparks===20 && secondSprite.wake.streamers.length===7 && secondSprite.wake.streamers.every((p:any)=>p.d.endsWith(' Z')&&p.opacity>.3) && secondSprite.wake.paths.every((path:any)=>/^M[-\d]/.test(path.d??'')&&path.length>8&&path.length<700&&path.animations.some((a:any)=>a.duration===720)), 'actualSevenThickTaperedRibbonsTenForksThreePixelEchoesAndTwentySparksUseNativeWebAnimations',secondSprite.wake);
    if(screenshotDirectory)await writeFile(join(screenshotDirectory,'fictional-field-lightning-paused.png'),(await contents.capturePage()).toPNG());
    check(secondSprite.ownedCount === 1 && secondSprite.phase === 'typing', 'repeatedTargetsReuseOneOwnedClosedShadow');
    check(JSON.stringify(await formState()) === JSON.stringify(before), 'focusHitTestingScrollExistingValuesCheckedFilesAndPageHandlersAreUnchanged');
    check(JSON.stringify(await read(READ_FORM)) === JSON.stringify(ordinary), 'productionOrdinaryObservationAndPointerIdentitiesRemainByteEqual');
    check(JSON.stringify(await read(scripts.READ_FEISHU_CAREER)) === JSON.stringify(career), 'productionFeishuObservationGroupIdentitiesAndProtectedControlsRemainByteEqual');
    await companion.show({ phase: 'verified', bounds: second }); check((await inspect()).phase === 'verified', 'verifiedPoseRequiresAnExplicitHostPhase');
    await armAttentionSampling();
    await companion.show({ phase: 'attention', bounds: second });
    const attentionShownTiming = await attentionSampling(), shownTransition = attentionShownTiming.events?.find((event: any) => event.dataVisible === 'true');
    const attention = await inspect(); check(attention.wake?.visible==='hidden'&&attention.wake.paths.every((p:any)=>p.animations.length===0),'attentionCancelsEveryElectricWakeAnimation'); check(attention.phase === 'attention', 'attentionPoseIsDecorativeAndDoesNotOpenAControl');
    check(attention.attention?.visible && attention.attention.background === 'rgba(0, 0, 0, 0)' && attention.attention.outline === 'solid'
      && attention.attention.pointer === 'none' && Math.abs(attention.attention.x-second.x)<.5 && Math.abs(attention.attention.y-second.y)<.5
      && Math.abs(attention.attention.width-second.width)<.5 && Math.abs(attention.attention.height-second.height)<.5
      && shownTransition?.captured && shownTransition.timerPending && shownTransition.middle?.opacity > 0 && shownTransition.middle.opacity < 1
      && shownTransition.finished?.opacity === 1 && shownTransition.finished.playState === 'finished',
      'attentionOutlinesTheExactLocatedFieldWithTransparentBackgroundAndPointerPassThrough', {second,attention,attentionShownTiming});
    const attentionTiming = await awaitRealAttentionTimer(), hiddenTransition = attentionTiming.events?.find((event: any) => event.dataVisible === 'false');
    const faded = await inspect(); await attentionSampling(true);
    check(faded.visible && faded.attention?.opacity === 0 && faded.attention.dataVisible === 'false' && !faded.attention.timerPending
      && hiddenTransition?.captured && !hiddenTransition.timerPending && hiddenTransition.at - shownTransition.at >= 2000
      && hiddenTransition.middle?.opacity > 0 && hiddenTransition.middle.opacity < 1
      && hiddenTransition.finished?.opacity === 0 && hiddenTransition.finished.playState === 'finished',
      'realAttentionTimerHidesOutlineAndControlledNativeOpacityTransitionReachesZeroWhileSpriteRemains', {second,faded,attentionTiming});
    const wide = await bounds('fixture-attention-wide');
    await armAttentionSampling(); await companion.show({ phase: 'attention', bounds: wide });
    const wideAttentionTiming = await attentionSampling(true), wideAttention = await inspect();
    check(!wideAttention.visible && wideAttention.attention?.visible && Math.abs(wideAttention.attention.width-wide.width)<.5
      && wideAttentionTiming.events?.find((event: any) => event.dataVisible === 'true')?.finished?.opacity === 1,
      'fullyVisibleWideFieldCanShowOnlyAnOutlineWhenNoSpriteMarginExists', {wide,wideAttention,wideAttentionTiming});
    check(JSON.stringify(await formState()) === JSON.stringify(before) && JSON.stringify(await read(READ_FORM)) === JSON.stringify(ordinary)
      && JSON.stringify(await read(scripts.READ_FEISHU_CAREER)) === JSON.stringify(career), 'attentionHighlightPreservesFocusEveryValueAndBothProductionObservers');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await companion.show({ phase: 'typing', bounds: first });
    check((await inspect()).reduced, 'systemReducedMotionDisablesActualCSSMovementAndStepAnimations');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await companion.setEnabled(true, true); await companion.show({ phase: 'typing', bounds: second });
    check((await inspect()).reduced, 'applicationReducedMotionAlsoDisablesMovement');
    await companion.show({ phase: 'attention', bounds: second });
    check((await inspect()).attention?.transition === '0s', 'reducedMotionAttentionHasNoFadeOrMovementTransition');
    await companion.setEnabled(false); check(!(await inspect()).visible, 'disabledPreferenceRemovesTheOwnedDecoration');
    check(await read<boolean>('!!document.getElementById("page-owned-fake")'), 'disablePreservesThePageCreatedSameTagClosedShadow');
    await companion.setEnabled(true); await companion.show({ phase: 'typing', bounds: first });
    await read('document.body.replaceWith(document.body.cloneNode(true))');
    const rebuilt = await formState(); await companion.show({ phase: 'typing', bounds: first });
    check((await inspect()).ownedCount === 1, 'bodyReconstructionRecreatesExactlyOneOwnedHost');
    check(JSON.stringify(await formState()) === JSON.stringify(rebuilt), 'recoveryFromBodyReplacementDoesNotChangeTheRebuiltForm');
    await companion.clear(); check(!(await inspect()).visible, 'clearRemovesTheEffectWithoutChangingAnyField');
    await companion.show({ phase: 'typing', bounds: first }); await contents.loadURL(origin + '/other');
    check(!(await inspect()).visible, 'mainFrameNavigationLeavesNoStaleCompanionOnTheNewPage');

    // Locator scripts use a different isolated world from both the page reader and the decoration.
    // This exercises the actual scrolling primitive, not production controller authorization/input.
    const reveal = (script: string) => contents.executeJavaScriptInIsolatedWorld(9468, [{ code: script }], false) as Promise<Record<string, any>>;
    const protectedState = () => read(`(() => ({active:document.activeElement?.id||'',
      fields:[...document.querySelectorAll('input,textarea,select')].map(n=>({id:n.id,value:n.value,checked:n.checked,files:n.files?.length??0})),
      counts:JSON.stringify(window.feishuCareerFixture),fakeScroll:window.locatorFakeScroll,bridge:typeof window.offer}))()`);
    const scrollState = () => read<{page:number;nested:number}>(`({page:scrollY,nested:document.getElementById('locator-nested-scroll')?.scrollTop??0})`);
    const setupLocator = async (nested: boolean) => {
      await contents.loadURL(origin + '/form');
      await read(`(() => {
        const form=document.getElementById('fixture-form');
        ${nested ? `const holder=document.createElement('div');holder.id='locator-nested-scroll';holder.style.cssText='height:280px;overflow:auto;margin:24px';form.parentNode.insertBefore(holder,form);holder.append(form);` : ''}
        document.getElementById('fixture-sections').style.marginTop='1900px';
        window.locatorFakeScroll=0;
        for(const target of document.querySelectorAll('input,[data-cy$="InputEnd"]'))target.scrollIntoView=()=>{window.locatorFakeScroll++;throw new Error('page override must not run');};
        document.getElementById('fixture-existing-email').focus();
      })()`);
    };
    for (const nested of [false, true]) for (const kind of ['ordinary', 'career'] as const) {
      await setupLocator(nested);
      const ordinaryRead = await read<any>(READ_FORM), careerRead = await read<any>(scripts.READ_FEISHU_CAREER);
      const targetId = kind === 'ordinary' ? 'fictional-education[0].school' : 'education[0].period:end';
      const field = kind === 'ordinary' ? ordinaryRead.fields.find((entry: any) => entry.identity.startsWith(targetId + '|'))
        : careerRead.groups[0].fields.find((entry: any) => entry.fieldId === targetId);
      check(field && field.bounds.y > 900, `${kind}${nested?'Nested':'LongPage'}TargetStartsOutsideTheVisibleViewport`);
      const raw = kind === 'ordinary' ? ordinaryRead : careerRead;
      const geometryIndependent = structuredClone(raw);
      geometryIndependent.viewport = {width:100,height:100};
      for (const entry of kind === 'ordinary' ? geometryIndependent.fields : geometryIndependent.groups.flatMap((group: any) => group.fields)) entry.bounds = {x:-2000,y:-2000,width:1,height:1};
      check(locationObservationSnapshot(geometryIndependent) === locationObservationSnapshot(raw), `${kind}${nested?'Nested':'LongPage'}SnapshotExcludesOnlyGeometryAndViewport`);
      const protect = await protectedState();
      const result = await reveal(kind === 'ordinary' ? revealObservedField(field.index, locationObservationSnapshot(geometryIndependent))
        : scripts.revealFeishuCareerField(targetId, locationObservationSnapshot(geometryIndependent)));
      await delay(40);
      const current = kind === 'ordinary' ? await read<any>(READ_FORM) : await read<any>(scripts.READ_FEISHU_CAREER);
      const afterField = kind === 'ordinary' ? current.fields.find((entry: any) => entry.index === field.index)
        : current.groups[0].fields.find((entry: any) => entry.fieldId === targetId);
      const exactHit = await read<boolean>(`(() => {const ${kind==='ordinary' ? `target=document.getElementById(${JSON.stringify(targetId)})` : `target=document.querySelector('[data-cy="education[0].periodInputEnd"]')`},r=target.getBoundingClientRect();
        return r.y>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===target;})()`);
      const scroll = await scrollState();
      check(result.scrolled === true && exactHit && afterField.bounds.y >= 0 && (nested ? scroll.nested > 100 : scroll.page > 100),
        `${kind}${nested?'Nested':'LongPage'}IsolatedNativeScrollRevealsTheExactField`);
      check(JSON.stringify(await protectedState()) === JSON.stringify(protect) && locationObservationSnapshot(current) === locationObservationSnapshot(raw),
        `${kind}${nested?'Nested':'LongPage'}ScrollPreservesFocusValuesCheckboxFilesHandlersAndObservationIdentity`);
    }
    for (const kind of ['ordinary', 'career'] as const) {
      await setupLocator(true);
      const raw = kind === 'ordinary' ? await read<any>(READ_FORM) : await read<any>(scripts.READ_FEISHU_CAREER);
      const index = kind === 'ordinary' ? raw.fields.find((entry: any) => entry.identity.startsWith('fictional-education[0].school|')).index : 0;
      await read(`document.getElementById('fixture-existing-email').value='changed-owned-fixture@example.invalid'`);
      const beforeScroll = await scrollState(), protect = await protectedState();
      const result = await reveal(kind === 'ordinary' ? revealObservedField(index, locationObservationSnapshot(raw))
        : scripts.revealFeishuCareerField('education[0].period:end', locationObservationSnapshot(raw)));
      check(result.scrolled === false && result.reason === 'changed' && JSON.stringify(await scrollState()) === JSON.stringify(beforeScroll), `${kind}StaleRawValueRefusesEveryScrollInTheIsolatedWorld`);
      check(JSON.stringify(await protectedState()) === JSON.stringify(protect), `${kind}StaleRefusalDoesNotChangeFocusFieldsOrHandlers`);
    }
    check(!window.isVisible() && !contents.isFocused() && externalNetworkRequests === 0, 'wholeCheckStaysHiddenWithZeroExternalNetworkOrOSInput');
    return { ok: true as const, assertionCount: checks.length, checks, motionTiming, attentionTiming, wideAttentionTiming, nativeInputCount: 0 as const, externalNetworkRequests: 0 as const,
      scope: 'production field companion, original loopback Feishu fixture, real hidden Chromium CSS/observers; no enterprise form, provider or application submission' };
  } finally {
    await companion.dispose(); if (ownDebugger && !contents.isDestroyed()) contents.debugger.detach();
    if (!window.isDestroyed()) window.destroy(); ownSession.webRequest.onBeforeRequest(null);
    await new Promise<void>(done => server.close(() => done()));
  }
}
