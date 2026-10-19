import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {BrowserWindow} from 'electron';
import type {IdentityCryptor} from '../../packages/domain/src/sensitive-identity.js';
import type {AppEvent} from '../../packages/shared/src/contracts.js';
/** In-memory test key only; never safeStorage / real keychain. */
export function ephemeralIdentityCryptor():IdentityCryptor {
 const key=randomBytes(32);return {available:()=>true,encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]);},
 decrypt(value){const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(-16));return Buffer.concat([decipher.update(value.subarray(12,-16)),decipher.final()]).toString('utf8');}};
}
export async function smokeIdentity(window:BrowserWindow,methods:Record<string,(...args:any[])=>Promise<any>>,send:(event:AppEvent)=>void,directory:string){
 if(window.isVisible()||!process.argv.includes('--smoke-test')||!process.argv.includes('--smoke-identity-only'))throw new Error('Identity check requires hidden isolated smoke');
 const checks:string[]=[],check=(v:unknown,name:string)=>{assert.ok(v,name);checks.push(name);};
 let stage='initial-state';
 const ui=async<T=any>(code:string):Promise<T>=>{try{return await window.webContents.executeJavaScript(code) as T;}catch{throw new Error('Identity UI failed at '+stage);}};
 const wait=async(code:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){if(await ui(code))return;await delay(30);}throw new Error('Identity UI did not settle');};
 const click=async(selector:string)=>{await ui(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||!n.checkVisibility())throw new Error('owned identity control unavailable');n.click();})()`);};
 const invoke=(name:string,...args:unknown[])=>ui(`window.offer[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
 const initial=await invoke('getState');check(initial.profile.version===0,'new isolated empty data');
 stage='profile-navigation';send({type:'navigate',page:'profile'});await wait(`!!document.querySelector('[data-testid="identity-profile"]')`);
 check(await ui(`!document.querySelector('[data-testid="identity-profile"]').open`),'sensitive panel defaults collapsed');
 stage='open-panel';await click('[data-testid="identity-profile"] > summary');await wait(`!!document.querySelector('[data-testid="identity-number"]')&&!document.querySelector('[data-testid="identity-number"]').disabled`);
 check(await ui(`document.querySelector('[data-testid="identity-save"]').disabled`),'save blocked without explicit confirmation');
 stage='type-fictional-document';await ui(`(()=>{const n=document.querySelector('[data-testid="identity-number"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'DEMO-DOCUMENT-0001');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await wait(`document.querySelector('[data-testid="identity-number"]').value==='DEMO-DOCUMENT-0001'`);
 stage='explicit-confirmation';await click('[data-testid="identity-profile"] input[type=checkbox]');
 await wait(`document.querySelector('[data-testid="identity-save"]').disabled===false`);
 stage='save-confirmed-document';await click('[data-testid="identity-save"]');
 await wait(`document.querySelector('[data-testid="identity-profile"]').textContent.includes('0001')&&document.querySelector('[data-testid="identity-number"]').value===''`);
 const status=await invoke('sensitiveIdentityState');check(status.configured&&status.maskedNumber.endsWith('0001')&&!JSON.stringify(status).includes('DEMO-DOCUMENT'),'actual IPC save returns only masked state');
 check(!(await readFile(join(directory,'sensitive/identity.enc'))).includes(Buffer.from('DEMO-DOCUMENT-0001')),'actual host file contains ciphertext');
 check(JSON.stringify(await invoke('getState'))===JSON.stringify(initial),'ordinary application state unchanged by identity save');
 await assert.rejects(invoke('saveSensitiveIdentity',{kind:'national-id',number:'REPLACEMENT-DEMO',confirmed:true},0));check(true,'stale identity revision rejected through IPC');
 await assert.rejects(invoke('fillSensitiveIdentity','arbitrary-preview'));check(true,'arbitrary renderer nonce cannot execute sensitive input');
 await invoke('clearSensitiveIdentity',status.version);check(!(await invoke('sensitiveIdentityState')).configured,'versioned deletion through actual IPC');
 await writeFile(join(directory,'identity-ui.png'),(await window.webContents.capturePage()).toPNG());
 const report={ok:true,checks,encryption:'ephemeral-test-key',systemKeychainAccess:false,nativeInputs:0,realModelCalls:0,enterpriseRequests:0};
 await writeFile(join(directory,'smoke-identity-report.json'),JSON.stringify(report,null,2));return report;
}
