import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createStore} from '../packages/domain/src/store.js';
test('profile-only guards read the same authoritative current profile without ranking the job library',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'profile-read-'));const store=await createStore({directory:dir});
 try{const profile=await store.getProfile(),state=await store.getState();assert.deepEqual(profile,state.profile);const before=await store.getProfile();const {version,updatedAt,...input}=before;await store.saveProfile({...input,fullName:'虚构测试姓名'},before.version);const updated=await store.getProfile();assert.equal(updated.version,before.version+1);assert.equal(updated.fullName,'虚构测试姓名');}finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
