/** Fixed DOM vocabulary shared by observation and controlled select actions.
 * The caller supplies a bound element, never a model-authored selector/script.
 */
export const OWNED_SELECT_HELPERS=String.raw`
 const selectVisible=n=>{if(!n)return false;for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}const r=n.getBoundingClientRect();return !!r.width&&!!r.height;};
 // Transparent DOM can still intercept clicks. Suppress a retained popup only
 // when it is both fully transparent and provably unable to take interaction.
 // ARIA-hidden alone is not visual/hit-test evidence for popup cleanup.
 const selectPopupState=n=>{if(!n||!n.isConnected)return {rendered:false,transparent:false,nonInteractive:false};let transparent=false,inert=false;
  for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden||s.display==='none'||['hidden','collapse'].includes(s.visibility))return {rendered:false,transparent:false,nonInteractive:true};if(Number(s.opacity)===0)transparent=true;if(p.inert||p.hasAttribute('inert'))inert=true;}
  const bounds=n.getBoundingClientRect();if(!bounds.width||!bounds.height)return {rendered:false,transparent,nonInteractive:true};
  if(!transparent)return {rendered:true,transparent:false,nonInteractive:inert};
  if(inert)return {rendered:false,transparent:true,nonInteractive:true};
  const descendants=Array.from(n.querySelectorAll('*'));if(descendants.length>1600)return {rendered:true,transparent:true,nonInteractive:false};
  const canIntercept=[n,...descendants].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !!r.width&&!!r.height&&s.display!=='none'&&!['hidden','collapse'].includes(s.visibility)&&s.pointerEvents!=='none';});
  return {rendered:canIntercept,transparent:true,nonInteractive:!canIntercept};
 };
 const selectPopupRendered=n=>selectPopupState(n).rendered;
 const selectText=n=>(n?.innerText||n?.textContent||'').replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim();
 const selectInput=e=>{if(!e)return null;if(e.matches('input,textarea,select'))return e;const inputs=Array.from(e.querySelectorAll('input:not([type="hidden"]),textarea,select')).filter(selectVisible);return inputs.length===1?inputs[0]:e;};
 const selectControls=p=>Array.from(p.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"]')).filter(n=>selectVisible(n)&&!n.parentElement?.closest('[role="combobox"]'));
 const selectDisabled=e=>!!e.disabled||!!e.closest('[inert],[aria-disabled="true"],.phoenix-select--disabled,[class*="Select-containerDisabled-"]');
 const selectPhoenix=e=>{if(!e?.matches('input.phoenix-select__input'))return null;const owner=e.closest('.phoenix-select');
  if(!owner||!owner.querySelector('ul.phoenix-select__content')||selectControls(owner).length!==1||selectControls(owner)[0]!==e||owner.matches('[aria-multiselectable="true"],.phoenix-select--multiple,.phoenix-select--multi'))return null;return owner;};
 const selectLabel=e=>{const input=selectInput(e);if(!input||input.tagName!=='INPUT'||!['text','search'].includes(input.type))return null;const l=input.closest('label');if(!l||selectControls(l).length!==1||l.htmlFor&&l.htmlFor!==input.id)return null;return l;};
 const selectArrow=label=>!!label&&Array.from([label,...label.querySelectorAll('*')]).some(n=>(n.textContent||'').includes('\ue732')||(n.getAttribute('aria-label')||'').includes('\ue732')||['::before','::after'].some(p=>{const c=getComputedStyle(n,p).content;return c.includes('\ue732')||/\\0{0,2}e732\b/i.test(c);}));
 const selectSingleCategory=n=>!!n?.matches('.constant-main-selector-container')&&selectText(n.querySelector('.select-data-num-limit'))==='1'&&!!n.querySelector('.left-container .list-data-container')&&!!n.querySelector('.right-container .select-data-container')&&n.querySelectorAll('.selector-footer-button .phoenix-button').length===2;
 const selectMenu=n=>!!n&&(selectSingleCategory(n)||n.matches('[role="listbox"],[role="menu"]')||/(?:^|[\s_-])(?:dropdown|menu|autocomplete|suggestions?|options|selectlist|select-list)(?:[\s_-]|$)/i.test(n.getAttribute('class')||''));
 const selectReferences=e=>{const input=selectInput(e),nodes=[e,input].filter(Boolean),ids=new Set(nodes.flatMap(n=>(n.getAttribute('aria-controls')||'').split(/\s+/).concat((n.getAttribute('aria-owns')||'').split(/\s+/))).filter(Boolean));return Array.from(ids).map(id=>e.ownerDocument.getElementById(id)).filter(n=>n&&(selectMenu(n)||n.querySelector('[role="option"]')));};
 const selectPopupRoots=(scope,target)=>{
  const allowed=n=>!!n&&n!==target&&!n.contains(target)&&!n.matches('input,textarea,select,label,button,a[href]');
  const candidate=n=>{if(!allowed(n))return false;if(n.matches('[role="listbox"],[role="menu"]'))return true;
   const position=getComputedStyle(n).position,options=!!n.querySelector('li,[role="option"],ul,ol,[role="list"],.list-item-container .item-text-label'),content=options||!!n.querySelector('input,textarea,button')||/[\p{L}\p{N}]/u.test(selectText(n));
   return selectMenu(n)&&(options||content&&['absolute','fixed'].includes(position))||['absolute','fixed'].includes(position)&&options;
  };
  const localNodes=Array.from(new Set([...Array.from(scope.querySelectorAll('*')).slice(0,1600),...Array.from(scope.querySelectorAll('[role="listbox"],[role="menu"],[class*="dropdown" i],[class*="menu" i],[class*="options" i],[class*="selectList" i],[class*="select-list" i]'))]));
  const local=localNodes.filter(candidate).slice(0,1600),linked=[];
  for(const ref of selectReferences(target)){
   if(allowed(ref)){linked.push(ref);continue;}
   // aria-controls may point at a permanent wrapper containing its trigger.
   // Only its actual popup descendants can be shown/closed, never that wrapper.
   linked.push(...Array.from(ref.querySelectorAll('*')).slice(0,1600).filter(candidate));
  }
  // Portals can be mounted below a zero-height positioning wrapper. That
  // wrapper must not swallow its actually rendered popup before visibility is
  // checked; its absolutely positioned descendants can still be on screen.
  const all=Array.from(new Set([...linked,...local])).filter(selectPopupRendered);return all.filter(n=>!all.some(parent=>parent!==n&&parent.contains(n)));
 };
 const selectOwned=e=>{if(!e||e.matches('select,input[type="checkbox"],input[type="radio"],input[type="file"],input[type="password"],a[href],button:not([type="button"])')||e.closest('a[href],button:not([type="button"])'))return false;
  if(selectPhoenix(e))return true;
  const ud=e.closest('.ud__select__selector');if(ud&&selectControls(ud).length===1&&selectControls(ud)[0]===e)return true;
  if(e.matches('[role="combobox"]')||['listbox','menu'].includes(e.getAttribute('aria-haspopup'))||selectReferences(e).length)return true;
  const l=selectLabel(e);if(!l)return false;if(l.matches('label.select')||e.closest('.month-range-select'))return true;
  for(let p=l,d=0;p&&d<5;p=p.parentElement,d++){if(['BODY','HTML','FORM','MAIN','FIELDSET','SECTION'].includes(p.tagName))break;const cs=selectControls(p);if(cs.length!==1||cs[0]!==e)break;if(selectArrow(p)||Array.from(p.children).some(selectMenu))return true;}return false;};
 const selectScope=e=>{if(!e||!selectOwned(e)&&e.tagName!=='SELECT')return null;let scope=selectLabel(e)||selectPhoenix(e)||e;
  for(let p=scope.parentElement,d=0;p&&d<7;p=p.parentElement,d++){
   if(['BODY','HTML','FORM','MAIN','FIELDSET','SECTION'].includes(p.tagName)||p.matches('a[href],button,[role="button"]')||p.querySelector('input[type="submit"],button[type="submit"]'))break;
   const cs=selectControls(p);if(cs.length!==1||cs[0]!==e)break;scope=p;
  }return scope;};
 const selectCommitted=e=>{const input=selectInput(e);if(!e||!input)return {value:'',source:'none',committed:false};
  if(input.tagName==='SELECT'){const option=input.selectedOptions?.length===1?input.selectedOptions[0]:null;return {value:option?selectText(option):'',source:'native-select',committed:!!option};}
  const label=selectLabel(e),scope=selectScope(e)||e;
  const phoenix=selectPhoenix(e),tips=phoenix?Array.from(phoenix.querySelectorAll('.phoenix-select__tipWrapper--visible')).filter(n=>selectVisible(n)&&!n.closest('.phoenix-select__calcEle')):[];
  if(phoenix&&tips.length===1)return {value:selectText(tips[0]),source:'phoenix-marker',committed:true};
  const sd=label?Array.from(label.querySelectorAll('[class*="Input-display-value-"]')).filter(selectVisible):[];
  if(sd.length===1)return {value:selectText(sd[0]),source:'sd-marker',committed:true};
  for(const node of [e,input]){const value=node.getAttribute('aria-valuetext');if(value!==null)return {value:value.trim(),source:'aria-valuetext',committed:!!value.trim()};}
  const markers=Array.from(scope.querySelectorAll('[class*="singleValue"],[class*="single-value"],[class*="selection-item"],[class*="selected-value"],.ud__select__selector__item,.ud__select__selector__selectItem')).filter(selectVisible).filter(n=>!n.querySelector('input,textarea'));
  if(markers.length===1)return {value:selectText(markers[0]),source:'display-marker',committed:true};
  const selected=Array.from(scope.querySelectorAll('[role="option"][aria-selected="true"]')).filter(n=>!n.hidden&&n.getAttribute('aria-hidden')!=='true');
  if(selected.length===1)return {value:selectText(selected[0]),source:'aria-selected',committed:true};
  const separateDisplay=!!input.closest('.phoenix-select')||!!label&&(label.matches('label.select')||!!label.querySelector('[class*="Input-display-value-"]'))||!!input.closest('.month-range-select');
  if(!separateDisplay&&input.matches('input,textarea')&&input.readOnly&&input.value)return {value:input.value.trim(),source:'readonly-value',committed:true};
  return {value:'',source:'none',committed:false};
 };
`;
