import vm from 'node:vm';
/** Exercise our own preload against a fake Electron bridge, without a window or IPC host. */
export function verifyPreloadRuntime(source){
 let exposed;const calls=[];
 const electron={contextBridge:{exposeInMainWorld(name,api){if(name!=='offer'||exposed)throw Error('Unexpected preload exposure');exposed=api;}},ipcRenderer:{invoke(channel,value){calls.push({channel,value});return Promise.resolve({});},on(){},removeListener(){}}};
 vm.runInNewContext(source,{require(name){if(name!=='electron')throw Error('Unexpected preload import');return electron;}},{timeout:1000});
 for(const name of ['getState','configureModel','runUniversalFill','cancelUniversalFill','pendingAgentQuestion','respondAgentQuestion'])if(typeof exposed?.[name]!=='function')throw Error('Packaged preload missing API: '+name);
 exposed.runUniversalFill({profileVersion:1,overwriteExisting:true});exposed.cancelUniversalFill();
 if(calls[0]?.channel!=='offer:request'||calls[0]?.value?.method!=='runUniversalFill'||calls[1]?.value?.method!=='cancelUniversalFill')throw Error('Preload API dispatch differs');
 exposed.pendingAgentQuestion();exposed.respondAgentQuestion({requestId:'fixture',disposition:'skipped',answers:[]});
 if(calls[2]?.value?.method!=='pendingAgentQuestion'||calls[3]?.value?.method!=='respondAgentQuestion')throw Error('Question bridge API dispatch differs');
 return {universalFill:true,cancelUniversalFill:true,interactiveQuestion:true};
}
