import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForBackgroundNavigationReady} from '../packages/browser/src/background-readiness.js';
test('startup waits for loading and same-URL navigation to settle before execution can pin a generation',async()=>{
  let samples=0;const state={url:'https://example.invalid/apply',generation:1,loading:true};
  await waitForBackgroundNavigationReady(()=>({...state}),new AbortController().signal,async ms=>{
    assert.equal(ms,150);samples++;if(samples===1){state.loading=false;state.generation++;}
  });assert.equal(samples,3);assert.equal(state.generation,2);
});
test('startup navigation readiness has a fixed bound and cannot ignore continued navigation',async()=>{
  let generation=0,samples=0;
  await assert.rejects(waitForBackgroundNavigationReady(()=>({url:'https://example.invalid/apply',generation,loading:false}),new AbortController().signal,async()=>{samples++;generation++;}),/控件仍在变化/);
  assert.equal(samples,8);
});
test('startup cancellation does not let readiness return success',async()=>{
  const abort=new AbortController();let samples=0;
  await assert.rejects(waitForBackgroundNavigationReady(()=>({url:'https://example.invalid/apply',generation:1,loading:false}),abort.signal,async()=>{samples++;abort.abort();}),/已变化/);
  assert.equal(samples,1);
});
