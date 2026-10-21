import {constants} from 'node:fs';import {mkdir,lstat,open,rename,rm} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {emptyApplicationSetup,type ApplicationSetupInput,type ApplicationSetupState} from '../../shared/src/application-setup.js';import type {IdentityCryptor} from './sensitive-identity.js';
const bad=()=>Error('网申资料引导无法安全读取，请重新核对。');
export function validateApplicationSetup(value:ApplicationSetupInput):ApplicationSetupInput{
 const keys=Object.keys(emptyApplicationSetup());if(!value||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw bad();
 for(const key of ['hometown','politicalStatus','interviewPreference','recruitmentSource','recruitmentSourceFallback'] as const)if(typeof value[key]!=='string'||value[key].length>500||/[\u0000-\u001f]/.test(value[key]))throw bad();
 if(value.resumeVersionId!==null&&(typeof value.resumeVersionId!=='string'||!/^[-\w]{10,100}$/.test(value.resumeVersionId))||typeof value.autoUploadResume!=='boolean'||value.autoUploadResume&&!value.resumeVersionId||!['ask','yes','no'].includes(value.acceptTransfer)||!['unknown','none','provided'].includes(value.awards))throw bad();
 if(!Array.isArray(value.educations)||value.educations.length>30||new Set(value.educations.map(item=>item.recordId)).size!==value.educations.length)throw bad();
 for(const item of value.educations){if(Object.keys(item).length!==6||typeof item.recordId!=='string'||item.recordId.length>160||!Number.isSafeInteger(item.sourceRevision)||item.sourceRevision<1)throw bad();for(const key of ['major','category','fallbackMajor','awardDate'] as const)if(typeof item[key]!=='string'||item[key].length>500||/[\u0000-\u001f]/.test(item[key]))throw bad();if(item.awardDate&&!/^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/.test(item.awardDate))throw Error('学位日期请选择明确的年月或年月日。');if(item.awardDate.length===10&&new Date(item.awardDate+'T00:00:00Z').toISOString().slice(0,10)!==item.awardDate)throw bad();}
 if(!Array.isArray(value.companyAnswers)||value.companyAnswers.length>100)throw bad();for(const item of value.companyAnswers){if(Object.keys(item).length!==3||typeof item.company!=='string'||item.company.length>200||!['ask','yes','no'].includes(item.hasRelatives))throw bad();const u=new URL(item.origin);if(u.protocol!=='https:'||u.username||u.password||u.origin!==item.origin)throw bad();}
 return structuredClone(value);
}
/** Separate encrypted host store. Never part of ordinary exports, Agent context or telemetry. */
export class ApplicationSetupVault {
 private pending:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private cryptor:IdentityCryptor){}
 private exclusive<T>(fn:()=>Promise<T>){const next=this.pending.then(fn,fn);this.pending=next.then(()=>{},()=>{});return next;}
 private async ready(create=false){if(create)await mkdir(this.directory,{recursive:true,mode:0o700});try{const stat=await lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw bad();return true;}catch(error){if(!create&&(error as NodeJS.ErrnoException).code==='ENOENT')return false;throw bad();}}
 private async read():Promise<ApplicationSetupState>{
  const empty={version:0,confirmedAt:null,profileVersion:null,value:emptyApplicationSetup(),encryptionAvailable:this.cryptor.available()};if(!await this.ready())return empty;
  let file;try{file=await open(join(this.directory,'setup.enc'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return empty;throw bad();}
  try{if(!this.cryptor.available())throw bad();const stat=await file.stat();if(!stat.isFile()||stat.size>100000)throw bad();const state=JSON.parse(this.cryptor.decrypt(await file.readFile())) as ApplicationSetupState;if(!Number.isSafeInteger(state.version)||state.version<1||!state.confirmedAt||!Number.isFinite(Date.parse(state.confirmedAt))||!Number.isSafeInteger(state.profileVersion))throw bad();return{...state,value:validateApplicationSetup(state.value),encryptionAvailable:true};}catch{throw bad();}finally{await file.close();}
 }
 state(){return this.exclusive(()=>this.read());}
 save(input:ApplicationSetupInput,expectedVersion:number,profileVersion:number){return this.exclusive(async()=>{const value=validateApplicationSetup(input),previous=await this.read();if(previous.version!==expectedVersion)throw Error('引导资料已变化，请重新打开。');if(!this.cryptor.available())throw Error('系统加密不可用，未保存这些资料，也不会改用明文。');const next:ApplicationSetupState={version:previous.version+1,profileVersion,confirmedAt:new Date().toISOString(),value,encryptionAvailable:true};const bytes=this.cryptor.encrypt(JSON.stringify(next));await this.ready(true);const temporary=join(this.directory,randomUUID()+'.tmp');let file;
  try{file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined;await rename(temporary,join(this.directory,'setup.enc'));}finally{await file?.close();await rm(temporary,{force:true});}return next;});}
}
