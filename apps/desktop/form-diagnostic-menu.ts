import { app, Menu, MenuItem, dialog, type BrowserWindow } from 'electron';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { formDiagnostic } from '../../packages/forms/src/form-diagnostic.js';

/** Native menu, no renderer/model entry point, no new write plan or field input. */
export function installFormDiagnosticMenu(window:BrowserWindow,read:()=>Promise<ReturnType<typeof formDiagnostic>>) {
  let active=false,disposed=false;
  const menu=Menu.getApplicationMenu()??Menu.buildFromTemplate([{role:'appMenu'},{role:'fileMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]);
  const item=new MenuItem({label:'诊断',submenu:[{label:'只读诊断当前表单',click:()=>{void run();}}]});
  menu.append(item);Menu.setApplicationMenu(menu);
  async function run(){
    if(active||disposed)return;active=true;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const report=await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('诊断读取超时，未执行填写。')),8000);})]);
      if(disposed||window.isDestroyed())return;
      const directory=await mkdtemp(join(app.getPath('temp'),'offerflash-form-diagnostic-'));
      const file=join(directory,'report.json');await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
      if(disposed||window.isDestroyed())return;
      await dialog.showMessageBox(window,{type:'info',title:'只读表单诊断',message:'当前网页只读诊断已完成',
        detail:`网站：${report.origin}\n观察 ${report.counts.observed} 项；旧规则可填 ${report.counts.ready} 项。${report.universal?'\n已附通用 Agent 的字段名称、经历分组与控件类型；这是只读结构检查，不是填写成功数。':''}\n\n不包含填写值、密钥或完整网址；没有填写、提交、模型调用或生成可执行计划。\n\n本地诊断文件：\n${file}`,buttons:['关闭'],noLink:true});
    }catch{
      if(!disposed&&!window.isDestroyed())await dialog.showMessageBox(window,{type:'warning',title:'只读表单诊断',message:'本次未取得稳定的诊断结果',detail:'请等待网页加载或其它操作结束后再试。没有填写或提交。',buttons:['关闭'],noLink:true});
    }finally{if(timer)clearTimeout(timer);active=false;}
  }
  return ()=>{disposed=true;item.enabled=false;};
}
