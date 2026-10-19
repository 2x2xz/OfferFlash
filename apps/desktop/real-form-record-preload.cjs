const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('recordDemo',Object.fromEntries(['inspect','start','stop'].map(name=>[name,()=>ipcRenderer.invoke('real-form-record:'+name)])));
ipcRenderer.on('real-form-record:status',(_event,status)=>{window.dispatchEvent(new CustomEvent('record-status',{detail:status}));});
