import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
// @ts-expect-error own small JS packaging helper
import {verifyPreloadRuntime} from '../scripts/verify-preload-runtime.mjs';
test('packaging rejects a legacy bridge before building, and exercises the actual exposed dispatch',async()=>{
 const source=await readFile('apps/desktop/preload.cjs','utf8');assert.deepEqual(verifyPreloadRuntime(source),{universalFill:true,cancelUniversalFill:true,interactiveQuestion:true});
 assert.throws(()=>verifyPreloadRuntime(source.replace("'runUniversalFill',",'')),/missing API: runUniversalFill/);
 assert.throws(()=>verifyPreloadRuntime(source.replace("'cancelUniversalFill',",'')),/missing API: cancelUniversalFill/);
 assert.throws(()=>verifyPreloadRuntime(source.replace("'pendingAgentQuestion',",'')),/missing API: pendingAgentQuestion/);
 assert.throws(()=>verifyPreloadRuntime(source.replace("'respondAgentQuestion',",'')),/missing API: respondAgentQuestion/);
});
