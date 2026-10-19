/** Evaluation-only observer around the existing real Pi session suite. Does not alter prompts, options or stream consumption. */
import {readBenchmarkCredential} from '../packages/evaluation/src/credential-input.ts';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {observeModelStreams} from '../packages/evaluation/src/stream-observer.ts';
import {summarizeRequestAttempts} from '../packages/evaluation/src/efficiency.ts';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
if(!process.argv.includes('--key-stdin'))throw new Error('Use explicit stdin credential input');
const output=resolve(process.argv.find(a=>a.startsWith('--usage-output='))?.slice(15)??'.backups/benchmark-20261019/pi-agent-live/usage.json');if(!output.includes('/.backups/'))throw new Error('Private benchmark output required');
process.stdout.write('AGENT_BENCHMARK_KEY_INPUT_READY\n');
const key=await readBenchmarkCredential();
const observations=[];const restore=observeModelStreams(ModelRuntime.prototype,record=>observations.push(record));process.env.OFFERAGENT_EVAL_API_KEY=key;
try{await import('./evaluate-agent.ts');}finally{delete process.env.OFFERAGENT_EVAL_API_KEY;await new Promise(done=>setImmediate(done));restore();const attempts=observations.map((r,index)=>({id:'pi-agent-request-'+index,source:'real-model',status:['error','aborted','unknown'].includes(r.stopReason)?'failed':'succeeded',durationMs:r.durationMs,usage:r.usage}));const summary=attempts.length?summarizeRequestAttempts(attempts):{usageComplete:false,tokens:null,reason:'No model-runtime stream observation; never infer zero actual requests'};await mkdir(dirname(output),{recursive:true,mode:0o700});await writeFile(output,JSON.stringify({scope:'separate-Pi-tool-contract-suite-real-model',observerDoesNotChangeModelOptions:true,observations,requestStatistics:summary},null,2),{mode:0o600});}
