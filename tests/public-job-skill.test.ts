import test from'node:test';import assert from'node:assert/strict';
import{publicSkillInput,publicSkillPrompt,parsePublicSkillRanking,evaluatePublicSkillRequest}from'../packages/evaluation/src/public-job-skill.js';
test('Skill evaluation forwards the same minimized CV/JD fields, never identity or gold',()=>{
 const p={profile:{fullName:'PRIVATE_NAME',email:'PRIVATE_EMAIL',phone:'PRIVATE_PHONE',degree:'硕士',major:'AI',graduationMonth:'2027-07',skills:['Python'],cities:['北京'],targetRoles:['AI'],career:{projects:[{role:'开发',description:'虚构证据',technologies:['Python'],sourceNote:'PRIVATE_SOURCE'}]}},evaluationPreferences:{region:'mainland'}};
 const jobs=[{id:'j1',job:{title:'AI',city:'北京',type:'campus',description:'JD',requirements:'REQ',publishedAt:null,deadline:null},labelFacts:'SECRET_GOLD',tags:['SECRET_TAG']}];
 const payload=JSON.stringify(publicSkillInput(p,jobs,'2026-10-19'));for(const marker of ['PRIVATE','SECRET'])assert.ok(!payload.includes(marker));assert.ok(payload.includes('虚构证据'));
});
test('Original shortlist constraints reject foreign IDs, duplicates, excessive slots and extra generated scores',()=>{
 assert.deepEqual(parsePublicSkillRanking('{"ranking":[]}',[]),[]);assert.deepEqual(parsePublicSkillRanking('{"ranking":["j1"]}',['j1']),['j1']);
 for(const s of ['{"ranking":["no"]}','{"ranking":["j1","j1"]}','{"ranking":["j1"],"score":100}','{"ranking":["a","b","c","d","e","f"]}'])assert.throws(()=>parsePublicSkillRanking(s,['j1','a','b','c','d','e','f']));
});
test('Skill text is kept verbatim and the request has no tools, retries or private persistence',async()=>{
 const skill='EXTERNAL_SKILL_TEXT',prompt=publicSkillPrompt([{path:'SKILL.md',text:skill}]);assert.ok(prompt.includes(skill));
 let observed:any;const runtime={completeSimple:async(_m:any,ctx:any,opts:any)=>{assert.deepEqual(ctx.tools,[]);assert.equal(opts.maxRetries,0);assert.equal(opts.maxTokens,1000);assert.equal(opts.timeoutMs,20000);opts.onResponse({status:200});return {stopReason:'stop',content:[{type:'text',text:'{"ranking":["j1"]}'}],usage:{input:10,output:5,cacheRead:2,cacheWrite:0,totalTokens:17}};}};
 const input={jobs:[{id:'j1'}]};assert.deepEqual(await evaluatePublicSkillRequest(runtime as any,{}as any,prompt,input as any,{onObserved:o=>observed=o}),['j1']);assert.equal(observed.httpStatus,200);assert.equal(observed.usage.totalTokens,17);
});
test('SDK error placeholder zero tokens never become successful usage or a recommendation',async()=>{
 let observed:any;const runtime={completeSimple:async()=>({stopReason:'error',content:[],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0}})};
 await assert.rejects(evaluatePublicSkillRequest(runtime as any,{}as any,'', {jobs:[]}as any,{onObserved:o=>observed=o}));assert.equal(observed.usage,null);
});
