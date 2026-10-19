import {execFileSync} from 'node:child_process';
import {readdir,lstat,readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,join,relative,extname,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectPublicFiles} from './check-public-package.mjs';
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function inspectReleaseText(path,text,deny=[]){
 const failures=[];const add=code=>failures.push({path,code});
 if(/\/(?:Users|home)\/[a-z\d_.-]+\//i.test(text))add('PERSONAL_ABSOLUTE_PATH');
 if(deny.some(marker=>typeof marker==='string'&&marker.length>=2&&text.toLowerCase().includes(marker.toLowerCase())))add('PRIVATE_MARKER');
 const emails=text.match(/[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}/gi)??[];
 // Reserved example domains and test-only pseudo-domains. URL userinfo is tested separately in source fixtures.
 if(emails.some(email=>!/@(?:[a-z\d.-]*\.)?(?:invalid|example\.(?:org|com|net))$/i.test(email)
   &&!(/^(?:pass|password|secret)@/.test(email)&&['user','name'].some(user=>text.includes('https://'+user+':'+email)))&&!(/^(?:user|name)@/.test(email)&&['https://','http://'].some(protocol=>text.includes(protocol+email)))))add('UNREVIEWED_EMAIL');
 const numbers=text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/g)??[];
 const fictionalPhones=new Set(['13000000000','13800000000','13800138000','13900000000','13900139000','13700000000','13912345678']);
 if(numbers.some(number=>!fictionalPhones.has(number)))add('UNREVIEWED_PHONE');
 if(/(?<![\da-f])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?![\da-f])/i.test(text))add('POSSIBLE_DOCUMENT_NUMBER');
 return failures;
}
async function walk(directory){const paths=[];for(const name of (await readdir(directory)).sort()){const path=join(directory,name),s=await lstat(path);if(s.isSymbolicLink())throw new Error('SYMLINK_REFUSED '+relative(source,path));if(s.isDirectory())paths.push(...await walk(path));else if(s.isFile())paths.push(path);else throw new Error('NON_REGULAR_FILE');}return paths;}
export async function exportRelease({output,deny=[]}){
 const destination=resolve(source,output);
 if(!destination.startsWith(source+sep+'.publish'+sep)&&!destination.startsWith(source+sep+'.export'+sep))throw new Error('Export must be a new child of .publish/ or .export/');
 try{await access(destination);throw new Error('Export destination already exists; choose a fresh directory');}catch(e){if(e.code!=='ENOENT')throw e;}
 const assets=JSON.parse(await readFile(join(source,'scripts/release-assets.json'),'utf8'));
 const roots=['apps','packages','prompts','skills','scripts','tests','benchmarks'];
 const files=[];const tracked=new Set(execFileSync('git',['-C',source,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean));
 for(const root of roots)for(const file of await walk(join(source,root))){const path=relative(source,file).split(sep).join('/');if(!tracked.has(path))continue;if(path==='apps/desktop/assets/OfferAgent.icns'||path==='scripts/check-references.mjs')continue;files.push({path,bytes:await readFile(file)});}
 for(const path of Object.keys(assets).filter(path=>path.startsWith('docs/screenshots/')))files.push({path,bytes:await readFile(join(source,path))});
 for(const path of ['package.json','package-lock.json','tsconfig.json','.gitattributes'])files.push({path,bytes:await readFile(join(source,path))});
 for(const [from,to] of [['README.md','README.md'],['architecture.md','docs/architecture.md'],['privacy.md','docs/privacy.md'],['verification.md','docs/verification.md'],['benchmark.md','docs/benchmark.md'],['benchmark-results.md','docs/benchmark-results.md'],['benchmark-summary.json','docs/benchmark-summary.json'],['benchmark-dashboard.html','docs/benchmark-dashboard.html'],['benchmark-dashboard-baseline.html','docs/benchmark-dashboard-baseline.html'],['benchmark-repair.html','docs/benchmark-repair.html'],['benchmark-repair-summary.json','docs/benchmark-repair-summary.json'],['benchmark-repair-details.html','docs/benchmark-repair-details.html'],['benchmark-example.html','docs/benchmark-example.html'],['benchmark-career-example.html','docs/benchmark-career-example.html'],['demo.md','docs/demo.md'],['demo-report.json','docs/demo-report.json'],['real-form-demo.md','docs/real-form-demo.md'],['real-form-demo-report.json','docs/real-form-demo-report.json'],['workspace-form-demo.md','docs/workspace-form-demo.md'],['workspace-form-demo-report.json','docs/workspace-form-demo-report.json'],['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md']])files.push({path:to,bytes:await readFile(join(source,'docs/release',from))});
 for(const path of ['docs/research/benchmark-form-survey.md','docs/research/benchmark-matching-survey.md','docs/research/benchmark-rag-telemetry.md'])files.push({path,bytes:await readFile(join(source,path))});
 // Keep export templates so a maintainer can reproduce this clean export. They contain no local handoff history.
 for(const file of await walk(join(source,'docs/release')))files.push({path:relative(source,file).split(sep).join('/'),bytes:await readFile(file)});
 const manifest=JSON.parse(files.find(f=>f.path==='package.json').bytes);
 delete manifest.scripts['check:references'];manifest.scripts.check='npm run typecheck && npm test && npm run check:skills && npm run check:public';
 files.find(f=>f.path==='package.json').bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 files.push({path:'.gitignore',bytes:Buffer.from('node_modules/\ndist/\n/release/\nbuild/\nruntime-home/\ndata/\n.backups/\n.publish/\n.export/\n.env\n.env.*\n*.log\n.DS_Store\n')});
 const failures=inspectPublicFiles(files);
 const binary=/\.(?:png|jpe?g|gif|webp|icns|woff2?|pdf|docx)$/i;
 for(const file of files){if(binary.test(file.path)){if(assets[file.path]!==digest(file.bytes))failures.push({path:file.path,code:'UNREVIEWED_BINARY_DIGEST'});}else failures.push(...inspectReleaseText(file.path,file.bytes.toString('utf8'),deny));}
 if(failures.length){console.log(JSON.stringify({passed:false,failures}));throw new Error('Release privacy gate failed; no export created');}
 await mkdir(destination,{recursive:true,mode:0o700});
 const inventory=[];
 for(const file of files){const target=join(destination,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,file.bytes,{mode:0o644});inventory.push({path:file.path,sha256:digest(file.bytes)});}
 const report={schemaVersion:1,passed:true,files:inventory,historyIncluded:false,runtimeIncluded:false,knownPrivateMarkersChecked:deny.length,binaryPolicy:'reviewed-exact-digests'};
 await writeFile(join(destination,'release-manifest.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:true,fileCount:files.length,knownPrivateMarkersChecked:deny.length,output:relative(source,destination)}));
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'.publish/offerflash';
 const denyFile=process.argv.find(a=>a.startsWith('--deny-file='))?.slice(12);
 const deny=denyFile?JSON.parse(await readFile(resolve(denyFile),'utf8')):[];
 if(!Array.isArray(deny)||deny.some(v=>typeof v!=='string'||v.length<2))throw new Error('Invalid private marker list');
 await exportRelease({output,deny});
}
