import type { BrowserWindow } from 'electron';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent, AppState } from '../../packages/shared/src/contracts.js';

/** Own renderer IPC, using only a fictional record in the isolated smoke DB. */
export async function smokePendingStatus(window: BrowserWindow, store: DomainStore, send: (event: AppEvent) => void) {
  const before = await store.getState();
  const input = { id:'fixture-pending-progress', company:'虚构进度核对企业', title:'企业招聘线索（虚构；暂无具体岗位）', url:'', status:'needs-review', deadline:null, notes:'虚构备注：公司曾投递，但这个岗位是否已投尚未确认。' };
  const state = await window.webContents.executeJavaScript(`window.offer.saveApplication(${JSON.stringify(input)})`) as AppState;
  send({ type:'navigate', page:'applications' });
  const settle = () => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await settle();
  const board = await window.webContents.executeJavaScript(`(() => { const column=Array.from(document.querySelectorAll('.kanban-column')).find(e=>e.querySelector('.kanban-title')?.textContent.includes('待核对')); return !!column && column.getBoundingClientRect().width>0 && column.textContent.includes(${JSON.stringify(input.title)}); })()`);
  if (!board) throw new Error('待核对记录没有显示在独立看板列');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="列表视图"]').click()`); await settle();
  await window.webContents.executeJavaScript(`(() => { const select=document.querySelector('[aria-label="筛选申请状态"]'); select.value='needs-review'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`); await settle();
  const list = await window.webContents.executeJavaScript(`(() => { const rows=Array.from(document.querySelectorAll('.application-list-mode .table-row')); return rows.length===1 && rows[0].textContent.includes(${JSON.stringify(input.title)}) && rows[0].textContent.includes('待核对'); })()`);
  if (!list) throw new Error('待核对筛选混入其他状态或丢失记录');
  await window.webContents.executeJavaScript(`document.querySelector('.application-list-mode .table-row').click()`); await settle();
  const dialog = await window.webContents.executeJavaScript(`(() => { const modal=document.querySelector('.modal'); return !!Array.from(modal?.querySelectorAll('select')||[]).find(e=>e.value==='needs-review') && modal.querySelector('textarea').value.includes('是否已投尚未确认') && modal.querySelector('input[type="url"]').value==='' && !modal.querySelector('[aria-label="打开申请页面"]'); })()`);
  if (!dialog) throw new Error('编辑界面丢失待核对状态、原备注或为空网址生成访问动作');
  const active = (s:AppState) => s.applications.filter(a=>['applied','assessment','interview'].includes(a.status)).length;
  if (active(before)!==active(state) || state.applications.find(a=>a.id===input.id)?.status!=='needs-review') throw new Error('待核对被计作已投或进行中');
  if (!before.applications.every(old=>JSON.stringify(state.applications.find(a=>a.id===old.id))===JSON.stringify(old))) throw new Error('待核对测试改写了旧申请');
  return {ok:true,fixtureOnly:true,boardVisible:true,listFilterExact:true,editorStatusPreserved:true,missingWebsitePreserved:true,activeCountUnchanged:true,priorApplicationsPreserved:true};
}
