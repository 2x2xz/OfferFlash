import type {ProfileInput} from '../packages/shared/src/contracts.js';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createStore} from '../packages/domain/src/store.js';import {pickCareerInput} from '../packages/profile/src/career-input.js';import {applicationFacts} from '../packages/forms/src/application-facts.js';import {parseCareerCandidates} from '../packages/profile/src/career-import.js';import {overrideProfile} from './fixtures/override-profile.js';import {BackgroundModelProvider} from '../packages/agent/src/background-model-provider.js';
test('college persists separately per education; edits require confirmation and retain other records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'college-profile-')),store=await createStore({directory:dir});try{
 const {version,updatedAt,...base}=overrideProfile;const input:ProfileInput={...base,career:pickCareerInput(base.career)};input.career!.primaryEducationId=null;
 let p=(await store.saveProfile(input,0)).profile;assert.equal(applicationFacts(p).filter(f=>f.kind==='college').length,0);
 for(const e of [...p.career!.educations])p=(await store.confirmCareerRecord('educations',e.id,p.version,e.revision)).profile;
 assert.equal(applicationFacts(p).filter(f=>f.kind==='college').length,2);
 const career=pickCareerInput(p.career);career.educations[0]!.college='虚构新学院';p=(await store.saveProfile({...input,career},p.version)).profile;
 assert.equal(p.career!.educations[0]!.confirmation,'pending');assert.equal(p.career!.educations[1]!.confirmation,'confirmed');assert.equal(applicationFacts(p).filter(f=>f.kind==='college').length,1);
 const {college,...legacy}=career.educations[1]!;career.educations[1]=legacy;assert.equal(pickCareerInput(career).educations[1]!.college,undefined);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
test('resume import extracts only explicit college labels with provenance',()=>{
 const text='教育经历\n学校：虚构甲大学\n学院名称：虚构计算学院\n专业：计算机\n学历：硕士';const result=parseCareerCandidates({text,fileName:'fixture.txt',fileHash:'a'.repeat(64)});assert.equal(result.career.educations[0]!.college,'虚构计算学院');assert.ok(result.career.educations[0]!.evidence.some(e=>e.field==='college'));
 const missing=parseCareerCandidates({text:'教育经历\n学校：虚构甲大学\n专业：数学\n学历：本科',fileName:'fixture.txt',fileHash:'a'.repeat(64)});assert.equal(missing.career.educations[0]!.college,'');
});
test('universal compatible models do not silently require exact qwen-flash or enable Bailian services',async()=>{
 const config={mode:'live' as const,provider:'custom',modelId:'custom-tool-model',apiKey:'invalid-fixture-only',baseURL:'http://127.0.0.1:1/v1'};
 await assert.rejects(BackgroundModelProvider.create(config),/测评/);const p=await BackgroundModelProvider.create(config,10,'universal');try{assert.equal(p.model.id,'custom-tool-model');assert.throws(()=>p.embedJobTexts(['fixture']),/NOT_CONFIGURED/);assert.throws(()=>p.searchPublicJobs({} as any),/NOT_CONFIGURED/);}finally{p.close();}
});
