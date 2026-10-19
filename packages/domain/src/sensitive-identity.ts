import { constants } from 'node:fs';
import { mkdir,open,rename,rm,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IdentityDocumentKind,SensitiveIdentityInput,SensitiveIdentityState } from '../../shared/src/sensitive-identity.js';

export interface IdentityCryptor { available():boolean; encrypt(value:string):Buffer; decrypt(value:Buffer):string; }
export interface ConfirmedIdentity { version:number; kind:IdentityDocumentKind; number:string; confirmedAt:string; }
interface StoredIdentity {schemaVersion:1;version:number;identity:Omit<ConfirmedIdentity,'version'>|null;}
const fail=()=>new Error('证件资料无法安全读取，请重新核对本机资料。');
function validate(input:unknown):SensitiveIdentityInput {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请填写并明确确认自己的证件资料。');
  const value=input as Record<string,unknown>;
  if(Object.keys(value).length!==3||!['national-id','passport'].includes(String(value.kind))||value.confirmed!==true
    ||typeof value.number!=='string'||!value.number.trim()||value.number.length>80||/[\u0000-\u001f\u007f]/u.test(value.number))
    throw new Error('请填写并明确确认自己的证件资料。');
  return {kind:value.kind as IdentityDocumentKind,number:value.number.trim(),confirmed:true};
}

/** Separate encrypted store. It is never part of AppState, ordinary exports, model context or telemetry. */
export class SensitiveIdentityVault {
  private pending:Promise<unknown>=Promise.resolve();
  constructor(private readonly directory:string,private readonly cryptor:IdentityCryptor){}
  private exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=this.pending.then(work,work);this.pending=next.then(()=>{},()=>{});return next;}
  private ensureEncryption():void {if(!this.cryptor.available())throw new Error('系统加密当前不可用，未保存证件资料；不会改用明文。');}
  private async directoryReady(create=false):Promise<boolean>{
    if(create)await mkdir(this.directory,{recursive:true,mode:0o700});
    try{const stat=await lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail();return true;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!create)return false;throw fail();}
  }
  private async read():Promise<StoredIdentity>{
    if(!await this.directoryReady())return {schemaVersion:1,version:0,identity:null};
    let handle;
    try{handle=await open(join(this.directory,'identity.enc'),constants.O_RDONLY|constants.O_NOFOLLOW);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {schemaVersion:1,version:0,identity:null};throw fail();}
    try{
      const stat=await handle.stat();if(!stat.isFile()||stat.size>128_000)throw fail();this.ensureEncryption();
      const raw=JSON.parse(this.cryptor.decrypt(await handle.readFile())) as StoredIdentity;
      if(raw.schemaVersion!==1||!Number.isSafeInteger(raw.version)||raw.version<0||Object.keys(raw).length!==3||Object.keys(raw).some(key=>!['schemaVersion','version','identity'].includes(key))
        ||raw.identity!==null&&(typeof raw.identity!=='object'||Array.isArray(raw.identity)))throw fail();
      if(raw.identity){validate({kind:raw.identity.kind,number:raw.identity.number,confirmed:true});
        if(Object.keys(raw.identity).length!==3||typeof raw.identity.confirmedAt!=='string'||!Number.isFinite(Date.parse(raw.identity.confirmedAt)))throw fail();}
      return raw;
    }catch{throw fail();}finally{await handle.close();}
  }
  private state(value:StoredIdentity):SensitiveIdentityState {return {version:value.version,configured:!!value.identity,
    kind:value.identity?.kind??null,maskedNumber:value.identity?`•••• •••• ${value.identity.number.slice(-4)}`:'',
    confirmedAt:value.identity?.confirmedAt??null,encryptionAvailable:this.cryptor.available()};}
  async status():Promise<SensitiveIdentityState>{return this.exclusive(async()=>this.state(await this.read()));}
  async confirmed():Promise<ConfirmedIdentity>{return this.exclusive(async()=>{const value=await this.read();if(!value.identity)throw new Error('请先在个人资料的敏感资料区保存并确认自己的证件信息。');return {...value.identity,version:value.version};});}
  private async persist(value:StoredIdentity):Promise<void>{
    this.ensureEncryption();let bytes:Buffer;try{bytes=this.cryptor.encrypt(JSON.stringify(value));}catch{throw new Error('系统加密失败，未保存证件资料。');}
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>128_000)throw fail();
    await this.directoryReady(true);const temporary=join(this.directory,`${randomUUID()}.tmp`);let handle;
    try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;
      await rename(temporary,join(this.directory,'identity.enc'));
    }finally{await handle?.close();await rm(temporary,{force:true});}
  }
  async save(input:SensitiveIdentityInput,expectedVersion:number):Promise<SensitiveIdentityState>{
    const value=validate(input);return this.exclusive(async()=>{const current=await this.read();
      if(!Number.isSafeInteger(expectedVersion)||current.version!==expectedVersion)throw new Error('证件资料版本已变化，请重新读取。');
      const next:StoredIdentity={schemaVersion:1,version:current.version+1,identity:{kind:value.kind,number:value.number,confirmedAt:new Date().toISOString()}};
      await this.persist(next);return this.state(next);});
  }
  async clear(expectedVersion:number):Promise<SensitiveIdentityState>{return this.exclusive(async()=>{const current=await this.read();
    if(!Number.isSafeInteger(expectedVersion)||current.version!==expectedVersion)throw new Error('证件资料版本已变化，请重新读取。');
    const next:StoredIdentity={schemaVersion:1,version:current.version+1,identity:null};await this.persist(next);return this.state(next);});}
}
