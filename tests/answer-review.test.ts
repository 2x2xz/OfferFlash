import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {answerForReview,answerForSave} from '../packages/ui/src/answer-review.js';
import {openDatabaseFile,writeDocument} from '../packages/domain/src/sqlite.js';
import {createApplicationAssetsStore} from '../packages/domain/src/application-assets.js';
import type {ConfirmedAnswer} from '../packages/shared/src/application-assets.js';
import type {Profile} from '../packages/shared/src/contracts.js';

const question={key:'[OfferFlash:11111111111111111111111111111111] 是否接受出差',reusableKey:'[OfferFlash:22222222222222222222222222222222] 是否接受出差'};
const answer=(id:string,key:string,text:string):ConfirmedAnswer=>({id,questionPattern:key,answer:text,revision:2,createdAt:'2026-10-21',updatedAt:'2026-10-21',scope:{kind:'general'},risk:'ordinary',demo:false,confirmedAt:'2026-10-21',confirmedRevision:2,confirmedProfileVersion:1});
test('review prefers the application answer and saving it preserves the general answer',()=>{
 const general=answer('general',question.reusableKey,'长期回答'),local=answer('local',question.key,'当前申请回答');
 assert.equal(answerForReview([general,local],question)?.id,'local');
 assert.equal(answerForSave([general,local],question,false)?.id,'local');
 assert.equal(answerForSave([general],question,false),undefined);
 assert.equal(answerForSave([general],question,true)?.id,'general');
 assert.throws(()=>answerForSave([general,local],question,true),/当前申请和长期回答/);
});
test('conflicting, unconfirmed, demo and high-impact review answers do not become implicit defaults',()=>{
 const a=answer('a',question.key,'甲'),b=answer('b',question.key,'乙');
 assert.equal(answerForReview([a,b],question),undefined);assert.throws(()=>answerForSave([a,b],question,false),/多个回答/);
 for(const change of [{confirmedRevision:null},{demo:true},{risk:'high-impact' as const}])assert.equal(answerForReview([{...a,...change}],question),undefined);
 assert.throws(()=>answerForSave([{...a,risk:'high-impact'}],question,false),/逐题核对/);
});
test('saving an application override through SQLite leaves the reusable answer unchanged after reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'offerflash-answer-review-'));let file=await openDatabaseFile({directory});
 try{
  const now='2026-10-21T00:00:00Z',profile={version:1,updatedAt:now,fullName:'',fullNameEn:'',email:'',phone:'',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',skills:[],cities:[],targetRoles:[],resumeText:''} satisfies Profile;
  await file.transact(db=>writeDocument(db,'profile','current',profile,now));let assets=createApplicationAssetsStore(file);
  const first=await assets.saveAnswer({questionPattern:question.reusableKey,answer:'长期回答',scope:{kind:'general'},risk:'ordinary',demo:false},null),draft=first.answers[0]!;
  const before=(await assets.confirmAnswer(draft.id,draft.revision,1)).answers;
  assert.equal(answerForSave(before,question,false),undefined);
  const saved=await assets.saveAnswer({questionPattern:question.key,answer:'当前申请例外',scope:{kind:'general'},risk:'ordinary',demo:false},null),current=saved.answers.find(item=>item.questionPattern===question.key)!;
  await assets.confirmAnswer(current.id,current.revision,1);await file.close();file=await openDatabaseFile({directory});assets=createApplicationAssetsStore(file);
  const after=(await assets.getState()).answers;assert.equal(after.length,2);assert.deepEqual(after.find(item=>item.id===draft.id),before[0]);assert.equal(answerForReview(after,question)?.answer,'当前申请例外');
 }finally{await file.close();await rm(directory,{recursive:true,force:true});}
});
