import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {SensitiveIdentityVault,type IdentityCryptor} from '../packages/domain/src/sensitive-identity.js';
import {identityDocumentFieldKind,ownEmptyIdentityFields} from '../packages/forms/src/sensitive-identity.js';
import type {FieldObservation} from '../packages/shared/src/contracts.js';
function cryptor():IdentityCryptor{const key=randomBytes(32);return {available:()=>true,encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decrypt(value){const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');}};}
async function fixture(t:test.TestContext){const root=await mkdtemp(join(tmpdir(),'offerflash-sensitive-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'private');const codec=cryptor();return {root,directory,codec,vault:new SensitiveIdentityVault(directory,codec)};}
const fake={kind:'national-id' as const,number:'DEMO-DOCUMENT-0001',confirmed:true as const};
test('encrypted document persistence exposes only masked metadata and remains separate from ordinary data',async t=>{
 const f=await fixture(t);assert.equal((await f.vault.status()).configured,false);const status=await f.vault.save(fake,0);
 assert.equal(status.configured,true);assert.equal(status.maskedNumber,'•••• •••• 0001');assert.equal(JSON.stringify(status).includes(fake.number),false);
 assert.equal((await readFile(join(f.directory,'identity.enc'))).includes(Buffer.from(fake.number)),false);
 assert.equal((await stat(join(f.directory,'identity.enc'))).mode&0o777,0o600);
 const reloaded=new SensitiveIdentityVault(f.directory,f.codec);assert.equal((await reloaded.confirmed()).number,fake.number);
 assert.equal('number'in(await reloaded.status()),false);
});
test('unavailable encryption and encryption errors never fall back to a plaintext file or expose the number',async t=>{
 const f=await fixture(t);const unavailable=new SensitiveIdentityVault(f.directory,{...f.codec,available:()=>false});
 await assert.rejects(unavailable.save(fake,0),/加密当前不可用/);await assert.rejects(readFile(join(f.directory,'identity.enc')));
 const broken=new SensitiveIdentityVault(f.directory,{...f.codec,encrypt(){throw new Error(fake.number);}});
 await assert.rejects(broken.save(fake,0),error=>error instanceof Error&&!error.message.includes(fake.number));await assert.rejects(readFile(join(f.directory,'identity.enc')));
});
test('explicit confirmation, exact revision and serialized updates protect local sensitive facts',async t=>{
 const f=await fixture(t);await assert.rejects(f.vault.save({...fake,confirmed:false}as never,0));
 const outcomes=await Promise.allSettled([f.vault.save(fake,0),f.vault.save({...fake,number:'DEMO-DOCUMENT-0002'},0)]);
 assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);assert.equal((await f.vault.confirmed()).number,fake.number);
 await assert.rejects(f.vault.clear(0),/版本/);const cleared=await f.vault.clear(1);assert.equal(cleared.version,2);assert.equal(cleared.configured,false);await assert.rejects(f.vault.confirmed());
});
test('corrupt ciphertext and file or directory symlinks fail closed',async t=>{
 const f=await fixture(t);await f.vault.save(fake,0);const file=join(f.directory,'identity.enc');await writeFile(file,'not encrypted');await assert.rejects(f.vault.status());
 await rm(file);const other=join(f.root,'other');await writeFile(other,'kept');await symlink(other,file);await assert.rejects(f.vault.status());assert.equal(await readFile(other,'utf8'),'kept');
 const real=join(f.root,'real');await mkdir(real);const link=join(f.root,'directory-link');await symlink(real,link);await assert.rejects(new SensitiveIdentityVault(link,f.codec).save(fake,0));
});
function field(label='身份证号码',section='个人基本资料',type='text'):FieldObservation{return {id:'field-0',index:0,label,section,type,value:'',editable:true,required:true,options:[],bounds:{x:10,y:10,width:200,height:32},signature:'a'.repeat(64)};}
test('only uniquely named own-document empty text fields are eligible; ordinary filling remains outside this helper',()=>{
 assert.equal(identityDocumentFieldKind(field()),'national-id');assert.equal(identityDocumentFieldKind(field('Passport number')),'passport');
 for(const candidate of [field('证件号码'),field('身份证号码','父亲信息'),field('身份证号码','紧急联系人'),field('身份证号码','','password'),field('同意身份证信息授权')])assert.equal(identityDocumentFieldKind(candidate),undefined);
 const existing={...field(),value:'KEEP-EXISTING'};assert.equal(ownEmptyIdentityFields([existing,field()],'national-id').length,1);assert.equal(ownEmptyIdentityFields([field()],'passport').length,0);
});
