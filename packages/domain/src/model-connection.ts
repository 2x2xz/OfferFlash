import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ModelConfig} from '../../shared/src/contracts.js';
import type {IdentityCryptor} from './sensitive-identity.js';

const failure=()=>Error('保存的模型连接无法安全读取，请重新输入连接信息。');
export function normalizeModelConnection(input:ModelConfig):ModelConfig {
 if(input.mode!=='live'||!['custom','openai','anthropic','deepseek'].includes(input.provider))throw Error('请选择有效的模型服务。');
 for(const value of [input.modelId,input.apiKey])if(typeof value!=='string'||!value.trim()||value.length>8192||/[\u0000-\u001f\u007f]/u.test(value))throw Error('请填写有效的模型名称和 API Key。');
 let baseURL:string|undefined;
 if(input.provider==='custom'){
  try{const url=new URL(input.baseURL?.trim()||'');if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();baseURL=url.href.replace(/\/$/,'');}
  catch{throw Error('服务地址必须是 HTTP(S)，且不能包含账号、查询参数或密钥。');}
 }
 return{mode:'live',provider:input.provider,modelId:input.modelId.trim(),apiKey:input.apiKey.trim(),...(baseURL?{baseURL}:{})};
}
export function sameModelDestination(a:Pick<ModelConfig,'provider'|'baseURL'>,b:Pick<ModelConfig,'provider'|'baseURL'>):boolean{
 return a.provider===b.provider&&(a.provider!=='custom'||(a.baseURL??'').trim().replace(/\/$/,'')===(b.baseURL??'').trim().replace(/\/$/,''));
}
/** Host-only ciphertext, separate from profile exports, model context and ordinary logs. */
export class ModelConnectionVault {
 constructor(private readonly directory:string,private readonly cryptor:IdentityCryptor){}
 private async ready(create=false){if(create)await mkdir(this.directory,{recursive:true,mode:0o700});try{const stat=await lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw failure();return true;}catch(error){if(!create&&(error as NodeJS.ErrnoException).code==='ENOENT')return false;throw failure();}}
 async load():Promise<ModelConfig|undefined>{
  if(!await this.ready())return;
  let handle;try{handle=await open(join(this.directory,'connection.enc'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw failure();}
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>64000||!this.cryptor.available())throw failure();const data=JSON.parse(this.cryptor.decrypt(await handle.readFile()));if(data.schema!==1)throw failure();return normalizeModelConnection(data.connection);}catch{throw failure();}finally{await handle.close();}
 }
 async save(input:ModelConfig):Promise<void>{
  const connection=normalizeModelConnection(input);if(!this.cryptor.available())throw Error('系统加密不可用，本次连接仅保留在内存，未改用明文保存。');
  let bytes:Buffer;try{bytes=this.cryptor.encrypt(JSON.stringify({schema:1,connection}));}catch{throw Error('系统加密失败，本次连接仅保留在内存。');}
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>64000)throw failure();await this.ready(true);
  const temporary=join(this.directory,randomUUID()+'.tmp');let handle;
  try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;await rename(temporary,join(this.directory,'connection.enc'));}finally{await handle?.close();await rm(temporary,{force:true});}
 }
 async clear():Promise<void>{if(await this.ready())await rm(join(this.directory,'connection.enc'),{force:true});}
}
