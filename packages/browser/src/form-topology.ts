/** Host-owned semantic topology. These programs accept no model selectors or
 * code. Framework classes describe a control shape, never an employer/domain. */
export const FORM_TOPOLOGY_HELPERS=String.raw`
 const fieldOwnerCache=new WeakMap(),sectionCache=new WeakMap();
 // HTML label[for] is handled by labelFor against the actual input ID. Inside
 // a composite selector it can label its search/selection display instead of
 // the application question, so it cannot establish a field owner here.
 const fieldLabelSelector='.ud-formily-item-label,[class$="-item-label"],[class*="form-item-label"],[class*="formItemLabel"],[data-field-label]';
 const fieldOwner=e=>{
  if(fieldOwnerCache.has(e))return fieldOwnerCache.get(e);
  const item=e.closest('.ud-formily-item');
  if(item){
   const labels=Array.from(item.querySelectorAll('.ud-formily-item-label')).filter(n=>n.closest('.ud-formily-item')===item&&!n.querySelector(selector)&&(visible(n)||Array.from(n.children).some(visible))&&txt(n));
   if(labels.length===1){const owner={node:item,label:txt(labels[0]),controls:visibleControls(item)};fieldOwnerCache.set(e,owner);return owner;}
  }
  for(let p=e.parentElement;p&&!['FORM','BODY','HTML','MAIN'].includes(p.tagName);p=p.parentElement){
   const cs=visibleControls(p);if(cs.length>5)break;
   const labels=Array.from(p.querySelectorAll(fieldLabelSelector)).filter(n=>visible(n)&&!n.querySelector(selector)&&!n.matches('[class*="label-desc"],[class*="label-content"]')&&txt(n)&&!validationText(txt(n)));
   const leaves=labels.filter(n=>!labels.some(other=>other!==n&&n.contains(other)));
   if(leaves.length===1&&cs.includes(e)){const owner={node:p,label:txt(leaves[0]),controls:cs};fieldOwnerCache.set(e,owner);return owner;}
  }fieldOwnerCache.set(e,null);return null;
 };
 const headingSelector='legend,h1,h2,h3,h4,h5,h6,[role="heading"],.section-title,.form-part-title,.form-part__title,.applyFormModuleWrapper-left,[data-section-title]';
 const discoverTopologySection=e=>{
  if(e.closest('nav,[role="navigation"],[role="banner"]')&&!e.closest('form,fieldset,.application-question'))return null;
  for(let p=e.parentElement;p&&!['BODY','HTML','MAIN'].includes(p.tagName);p=p.parentElement){
   const headings=Array.from(p.querySelectorAll(headingSelector)).filter(n=>visible(n)&&!n.matches(selector)&&!n.querySelector(selector)&&!n.closest('[role="listbox"],[role="menu"]')).map(n=>({node:n,family:family(sectionCaption(n))})).filter(n=>n.family);
   if(headings.length===1)return {node:p,family:headings[0].family};
   // A root spanning two modules must never lend one heading to its siblings.
   if(headings.length>1)return null;
   const direct=Array.from(p.children).filter(n=>visible(n)&&!n.matches(selector)&&!n.querySelector(selector)&&!n.matches('button,[role="button"],a[href]')).map(n=>({node:n,family:family(sectionCaption(n))})).filter(n=>n.family);
   if(direct.length===1)return {node:p,family:direct[0].family};
   if(direct.length>1)return null;
  }return null;
 };
 const topologySection=e=>{if(!sectionCache.has(e))sectionCache.set(e,discoverTopologySection(e));return sectionCache.get(e);};
`;
