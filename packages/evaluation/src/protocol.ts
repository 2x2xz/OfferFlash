import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
export const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Validate file digests before and after execution, not just a mutable label in the report. */
export async function loadFrozenDataset(directory:string){
 const root=resolve(directory),names=['protocol.json','matching.json','forms.json','retrieval.json'];
 const files=await Promise.all(names.map(async name=>{const path=resolve(root,name);const size=(await stat(path)).size;if(size>8_000_000)throw new Error('Benchmark dataset too large');const bytes=await readFile(path);return {name,path,sha256:hash(bytes),value:JSON.parse(bytes.toString('utf8'))};}));
 const digest=hash(JSON.stringify(files.map(({name,sha256})=>({name,sha256}))));
 const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
 if(manifest.schemaVersion!==1||manifest.suiteId!=='offerflash-bench-v1'||manifest.datasetHash!==digest||JSON.stringify(manifest.files)!==JSON.stringify(files.map(({name,sha256})=>({name,sha256}))))throw new Error('Frozen benchmark manifest mismatch');
 const byName=Object.fromEntries(files.map(f=>[f.name,f.value]));
 for(const name of ['matching.json','forms.json','retrieval.json']){const value=byName[name];if(value.schemaVersion!==1||value.labelProvenance!=='authored-synthetic-diagnostic'||value.humanGold!==false)throw new Error('Benchmark provenance/schema mismatch');}
 if(byName['protocol.json'].id!=='offerflash-bench-v1'||byName['matching.json'].suiteId!=='offerflash-matching-v1'||byName['forms.json'].suiteId!=='offerflash-forms-v1'||byName['retrieval.json'].suiteId!=='offerflash-retrieval-v1')throw new Error('Unknown benchmark suite');
 if(byName['matching.json'].asOf!==byName['protocol.json'].asOf||byName['forms.json'].asOf!==new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(byName['protocol.json'].asOf)))throw new Error('Benchmark date mismatch');
 return {root,digest,files,protocol:byName['protocol.json'],matching:byName['matching.json'],forms:byName['forms.json'],retrieval:byName['retrieval.json'],
  async assertUnchanged(){for(const file of files)if(hash(await readFile(file.path))!==file.sha256)throw new Error('Benchmark data changed during execution');}};
}
export async function writeJson(path:string,value:unknown){await mkdir(dirname(resolve(path)),{recursive:true,mode:0o700});await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
