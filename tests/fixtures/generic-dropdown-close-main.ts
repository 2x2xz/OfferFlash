import {app,BrowserWindow,WebContentsView} from 'electron';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {createOwnedSelectController} from '../../packages/browser/src/owned-select.js';

// Original synthetic controls. No employer HTML, normal profile or network.
const directory=await mkdtemp(resolve('.backups/dropdown-close-browser-'));
app.setPath('userData',directory);await app.whenReady();
const window=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'dropdown-close-fictional'}});
window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1100,height:850});
const head='<style>body{font:16px sans-serif}input,button{min-height:28px}.control{position:relative;display:inline-block}label:focus-within [class*="Input-display-value-"]{display:none}[role=listbox]{position:absolute;z-index:3;background:white;border:1px solid #555;min-width:180px}[role=option]{padding:8px}.closing{opacity:0;transition:opacity .28s}</style>';
const safety='<label>Unrelated<input id="other" value="KEEP"></label><button type="button" id="unrelated" onclick="window.unrelated++">Other action</button><button type="submit">Submit application</button>';
const wrap=(body:string,script:string)=>head+'<form onsubmit="window.submits++;return false">'+body+safety+'</form><script>(()=>{window.focuses=0;window.escapes=0;window.unrelated=0;window.submits=0;window.choices=0;window.captionClicks=0;'+script+'})()</script>';
const sd='<label class="select"><span class="sd-Input-display-value-fixture" hidden></span><input id="control" autocomplete="off"></label><div role="listbox" id="menu" hidden></div>';
try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(head+'<p>Fictional cleanup checks</p>'));
 const attached=await attachPlaywrightView(view.webContents),page=attached.page;let checks=0;
 const safe=async()=>{assert.equal(await page.locator('#other').inputValue(),'KEEP');assert.equal(await page.evaluate('window.unrelated+window.submits'),0);checks+=2;};
 const school={kind:'school',value:'虚构大学'};
 // The real selection leaves focus on body while a close timer is pending.
 // Focusing the input again cancels that timer and opens the dropdown again.
 await page.setContent(wrap('<fieldset><legend>Education</legend><div class="control">'+sd+'</div></fieldset>',String.raw`
  const input=document.getElementById('control'),menu=document.getElementById('menu'),marker=document.querySelector('[class*="Input-display-value-"]');let closing;
  const render=()=>{menu.replaceChildren();const option=document.createElement('div');option.setAttribute('role','option');option.textContent=input.value;option.onmousedown=event=>event.preventDefault();option.onclick=()=>{window.choices++;marker.textContent=input.value;marker.hidden=false;input.value='';input.blur();};menu.append(option);menu.hidden=false;};
  input.onfocus=()=>{window.focuses++;clearTimeout(closing);render();};input.oninput=render;
  input.onblur=()=>{closing=setTimeout(()=>menu.hidden=true,240);};input.onkeydown=event=>{if(event.key==='Escape'){window.escapes++;input.blur();}};
 `));
 let controller=await createOwnedSelectController(page.locator('#control'),async()=>{}),opened=await controller.open(school.value);
 let option=opened.options.find(option=>option.label===school.value);assert.ok(option);const before=await page.evaluate('window.focuses'),started=Date.now();
 assert.equal((await controller.choose(option.ref,school)).committed,true);const bodyElapsed=Date.now()-started;
 assert.equal(await page.evaluate('window.focuses'),before);assert.equal(await page.evaluate('document.activeElement===document.body'),true);assert.equal(await page.locator('#menu').isVisible(),false);assert.equal(await page.evaluate('window.choices'),1);assert.ok(bodyElapsed>=200);checks+=6;await controller.dispose();await safe();

 // A closed aria-expanded value does not mean the outgoing popup has finished
 // its CSS transition. It remains visible/intercepting until the real timer ends.
 await page.setContent(wrap('<fieldset><legend>Education</legend><div><button type="button" role="combobox" aria-label="Level" aria-controls="menu" aria-expanded="false" aria-valuetext="" id="control">Choose</button></div></fieldset><div role="listbox" id="menu" hidden></div>',String.raw`
  const input=document.getElementById('control'),menu=document.getElementById('menu');let closing;
  const close=()=>{if(closing)return;input.setAttribute('aria-expanded','false');menu.classList.add('closing');closing=setTimeout(()=>{menu.hidden=true;},280);};
  input.onfocus=()=>window.focuses++;input.onclick=()=>{menu.classList.remove('closing');menu.replaceChildren();const option=document.createElement('div');option.setAttribute('role','option');option.textContent='硕士';option.onmousedown=event=>event.preventDefault();option.onclick=()=>{window.choices++;input.setAttribute('aria-valuetext','硕士');close();};menu.append(option);menu.hidden=false;input.setAttribute('aria-expanded','true');};
  input.onkeydown=event=>{if(event.key==='Escape'){window.escapes++;close();}};input.onblur=close;
 `));
 const degree={kind:'degree',value:'硕士'};controller=await createOwnedSelectController(page.locator('#control'),async()=>{});opened=await controller.open();option=opened.options.find(option=>option.label===degree.value);assert.ok(option);
 const animationStarted=Date.now();assert.equal((await controller.choose(option.ref,degree)).value,degree.value);const animationElapsed=Date.now()-animationStarted;
 assert.ok(animationElapsed>=230);assert.equal(await page.locator('#menu').isVisible(),false);assert.equal(await page.evaluate('window.focuses'),1);assert.equal(await page.evaluate('window.choices'),1);checks+=5;await controller.dispose();await safe();

 // The caption is outside the single-control owner because this field contains
 // multiple controls. Only the actual host caption, never another field/button,
 // can be used as the outside click. Generated date-part suffixes are metadata.
 await page.setContent(wrap('<fieldset><legend>Education</legend><div><div id="caption">Period</div><div class="control">'+sd+'</div><input id="other-part" value="KEEP-MONTH"></div></fieldset>',String.raw`
  const input=document.getElementById('control'),menu=document.getElementById('menu'),marker=document.querySelector('[class*="Input-display-value-"]');
  const render=()=>{menu.replaceChildren();const option=document.createElement('div');option.setAttribute('role','option');option.textContent=input.value;option.onmousedown=event=>event.preventDefault();option.onclick=()=>{window.choices++;marker.textContent=input.value;marker.hidden=false;input.value='';input.blur();};menu.append(option);menu.hidden=false;};input.onfocus=()=>{window.focuses++;render();};input.oninput=render;
  document.onmousedown=event=>{if(event.target===document.getElementById('caption')){window.captionClicks++;menu.hidden=true;}};
 `));
 controller=await createOwnedSelectController(page.locator('#control'),async()=>{},{label:'Period · Start · Year'});opened=await controller.open('2025');option=opened.options.find(option=>option.label==='2025');assert.ok(option);
 assert.equal((await controller.choose(option.ref,{kind:'yearPart',value:'2025'})).committed,true);assert.equal(await page.evaluate('window.captionClicks'),1);assert.equal(await page.evaluate('window.focuses'),1);assert.equal(await page.locator('#other-part').inputValue(),'KEEP-MONTH');checks+=4;await controller.dispose();await safe();

 // A permanent generic dropdown wrapper contains both its trigger and the real
 // options panel. aria-controls can reference that wrapper too. It is not the
 // popup and must never make a completed selection look permanently open.
 const retainedFixture=(finish:string)=>wrap('<fieldset><legend>Education</legend><div id="shell" class="permanent-dropdown-container"><button type="button" role="combobox" aria-label="Level" aria-controls="shell" aria-expanded="false" aria-valuetext="" id="control">Choose</button><div id="menu" class="generic-options-panel" style="position:absolute;background:white;min-width:180px" hidden></div></div></fieldset>',String.raw`
  document.onmousedown=null;const input=document.getElementById('control'),menu=document.getElementById('menu');input.onfocus=()=>window.focuses++;
  input.onclick=()=>{menu.replaceChildren();menu.inert=false;menu.style.opacity='1';menu.style.pointerEvents='auto';const option=document.createElement('div');option.setAttribute('role','option');option.textContent='硕士';option.onmousedown=event=>event.preventDefault();option.onclick=()=>{window.choices++;input.setAttribute('aria-valuetext','硕士');input.setAttribute('aria-expanded','false');`+finish+String.raw`};menu.append(option);menu.hidden=false;input.setAttribute('aria-expanded','true');};
 `);
 for(const finish of ["menu.style.opacity='0';menu.style.pointerEvents='none';","menu.style.opacity='0';menu.inert=true;"]){
  await page.setContent(retainedFixture(finish));controller=await createOwnedSelectController(page.locator('#control'),async()=>{},{label:'Level'});opened=await controller.open();option=opened.options.find(option=>option.label===degree.value);assert.ok(option);
  assert.equal((await controller.choose(option.ref,degree)).committed,true);assert.equal((await controller.close()).closed,true);
  assert.equal(await page.locator('#shell').isVisible(),true);assert.equal(await page.locator('#menu').isVisible(),true,'Opacity zero retains a measurable DOM box');
  assert.equal(await page.locator('#menu').evaluate(e=>getComputedStyle(e).opacity),'0');assert.equal(await page.evaluate('window.focuses'),1);assert.equal(await page.evaluate('window.choices'),1);checks+=7;await controller.dispose();await safe();
 }
 // Opacity alone is not enough: the transparent panel (or a child overriding
 // pointer-events:none) can still intercept real clicks. No false close proof.
 for(const finish of ["menu.style.opacity='0';","menu.style.opacity='0';menu.style.pointerEvents='none';option.style.pointerEvents='auto';"]){
  await page.setContent(retainedFixture(finish));controller=await createOwnedSelectController(page.locator('#control'),async()=>{},{label:'Level'});opened=await controller.open();option=opened.options.find(option=>option.label===degree.value);assert.ok(option);
  await assert.rejects(controller.choose(option.ref,degree),/OWNED_SELECT_POPUP_NOT_CLOSED/);assert.equal((await controller.close()).closed,false);assert.equal(await page.locator('#control').getAttribute('aria-valuetext'),degree.value);assert.equal(await page.locator('#menu').isVisible(),true);checks+=4;await controller.dispose();await safe();
 }

 // A menu that ignores Escape/blur and has no matching safe caption must stay
 // explicitly unclosed. Do not fake hidden state or undo its real selected value.
 await page.setContent(wrap('<fieldset><legend>Education</legend><button type="button" role="combobox" aria-label="Stuck selector" aria-controls="menu" aria-expanded="false" aria-valuetext="" id="control">Choose</button><div>Unrelated caption</div></fieldset><div role="listbox" id="menu" hidden></div>',String.raw`
  document.onmousedown=null;const input=document.getElementById('control'),menu=document.getElementById('menu');
  input.onfocus=()=>window.focuses++;input.onclick=()=>{menu.replaceChildren();const option=document.createElement('div');option.setAttribute('role','option');option.textContent='硕士';option.onmousedown=event=>event.preventDefault();option.onclick=()=>{window.choices++;input.setAttribute('aria-valuetext','硕士');};menu.append(option);menu.hidden=false;input.setAttribute('aria-expanded','true');};input.onkeydown=event=>{if(event.key==='Escape')window.escapes++;};
 `));
 controller=await createOwnedSelectController(page.locator('#control'),async()=>{},{label:'Stuck selector'});opened=await controller.open();option=opened.options.find(option=>option.label===degree.value);assert.ok(option);const stuckStarted=Date.now();
 await assert.rejects(controller.choose(option.ref,degree),/OWNED_SELECT_POPUP_NOT_CLOSED/);const stuckElapsed=Date.now()-stuckStarted;
 assert.equal((await controller.close()).closed,false);assert.equal(await page.locator('#menu').isVisible(),true);assert.equal(await page.locator('#control').getAttribute('aria-valuetext'),degree.value);assert.equal(await page.evaluate('window.focuses'),1);assert.equal(await page.evaluate('window.choices'),1);assert.ok(stuckElapsed<1800,'Repeated finally cleanup must share its original deadline: '+stuckElapsed);checks+=7;await controller.dispose();await safe();
 await attached.close();
 const report={dropdownClose:true,ok:true,checks,realEmployer:false,paidRequests:0,bodyNeverRefocused:true,animationWaited:true,hostCaptionClosed:true,persistentTriggerWrapperExcluded:true,transparentNonInteractiveClosed:true,transparentInterceptorRejected:true,unclosableStayedFalse:true,selectedValuePreserved:true,unsafeActions:0,bodyElapsed,animationElapsed,stuckElapsed};
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));view.webContents.close();window.destroy();app.exit(0);
}catch(error){console.error(error);window.destroy();app.exit(1);}
