/** Package only the runtime files from an already-tested, immutable QA build.
 * No QA launcher, resume, replay manifest, private state or development history. */
import {packager} from '@electron/packager';
import {access,cp,mkdir,mkdtemp,readFile,readdir,lstat,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyPreloadRuntime} from './verify-preload-runtime.mjs';
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const root=resolve('.'),source=resolve(arg('source')??''),version=arg('version'),output=resolve(arg('output')??'');
if(!source.startsWith(root+sep+'.backups'+sep)||!/^\d+\.\d+\.\d+$/.test(version??'')||!output.startsWith(root+sep+'release'+sep))throw Error('Explicit verified source, version and fresh release output required');
try{await access(output);throw Error('Output already exists; preserve earlier releases');}catch(e){if(e.code!=='ENOENT')throw e;}
const expected=arg('backend-sha'),hash=b=>createHash('sha256').update(b).digest('hex');
const backend=await readFile(join(source,'dist/desktop/backend.js'));if(!expected||hash(backend)!==expected)throw Error('Verified backend SHA required');
const preload=await readFile(join(source,'apps/desktop/preload.cjs'));
const preloadSHA=arg('preload-sha');if(!preloadSHA||hash(preload)!==preloadSHA)throw Error('Verified preload SHA required');
const bridge=verifyPreloadRuntime(preload.toString('utf8'));
const stage=await mkdtemp(join(root,'.backups/runtime-release-'));
try{
const runtime=join(stage,'app');await mkdir(runtime);
const roots=['dist','node_modules','prompts','skills','apps/desktop/assets','apps/desktop/fixtures'];
for(const path of roots){await mkdir(join(runtime,path,'..'),{recursive:true});await cp(join(source,path),join(runtime,path),{recursive:true,dereference:false});}
await mkdir(join(runtime,'apps/desktop'),{recursive:true});
for(const file of ['main.cjs','preload.cjs'])await cp(join(source,'apps/desktop',file),join(runtime,'apps/desktop',file));
const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
await writeFile(join(runtime,'package.json'),JSON.stringify({name:'offerflash',version,main:'apps/desktop/main.cjs',type:'module',private:true,
  description:manifest.description,dependencies:manifest.dependencies},null,2)+'\n');
const electronVersion=JSON.parse(await readFile('node_modules/electron/package.json','utf8')).version;
const cache=join(homedir(),'Library/Caches/electron');let electronZipDir;
for(const e of await readdir(cache,{withFileTypes:true})){if(!e.isDirectory()||e.isSymbolicLink())continue;const p=join(cache,e.name);
  try{await access(join(p,`electron-v${electronVersion}-darwin-${process.arch}.zip`));electronZipDir=p;break;}catch{}}
if(!electronZipDir)throw Error('Official cached Electron required; no replacement download');
const paths=await packager({dir:runtime,name:'OfferFlash',appVersion:version,platform:'darwin',arch:process.arch,electronVersion,electronZipDir,
  appBundleId:'dev.offeragent.desktop',executableName:'OfferFlash',out:output,overwrite:false,asar:false,prune:false,icon:join(runtime,'apps/desktop/assets/OfferFlash.icns')});
const application=join(paths[0],'OfferFlash.app'),appRuntime=join(application,'Contents/Resources/app');let files=0;
async function inspect(directory){for(const e of await readdir(directory)){const p=join(directory,e),stat=await lstat(p);
  if(stat.isSymbolicLink()){const {realpath}=await import('node:fs/promises');const target=await realpath(p);if(!target.startsWith(application+sep))throw Error('External symlink');}
  else if(stat.isDirectory())await inspect(p);else files++;}}
await inspect(application);
for(const denied of ['real-site-qa-main.cjs','qa-resume.txt','qa-replay.json','OfferFlash-QA-resume.txt','AGENTS.md','plan.md','data','runtime-home','.backups','.git']){
  try{await access(join(appRuntime,denied));throw Error('Non-runtime file in package: '+denied);}catch(e){if(e.code!=='ENOENT')throw e;}}
if(hash(await readFile(join(appRuntime,'dist/desktop/backend.js')))!==expected)throw Error('Packaged backend differs');
if(hash(await readFile(join(appRuntime,'apps/desktop/preload.cjs')))!==preloadSHA)throw Error('Packaged preload differs');
verifyPreloadRuntime(await readFile(join(appRuntime,'apps/desktop/preload.cjs'),'utf8'));
const report={version,application,preloadSHA256:preloadSHA,bridge,backendSHA256:expected,files,normalIdentity:'dev.offeragent.desktop',normalDataCompatibility:true,
  normalUserDataCopied:false,qaLauncherIncluded:false,fixtureResumeImportedIntoNormalData:false,launched:false,signedOrNotarized:false,
  runtimeRoots:roots};
await writeFile(join(output,'package-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  // This directory contains only copies of the explicit input runtime. Keep
  // the source and reports; release packaging must not accumulate these copies.
  await rm(stage,{recursive:true,force:true});
}
