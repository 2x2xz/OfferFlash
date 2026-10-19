const { contextBridge, ipcRenderer } = require('electron');

const invoke = (method, ...args) => ipcRenderer.invoke('offer:request', { method, args });
const names = [
  'sensitiveIdentityState','saveSensitiveIdentity','clearSensitiveIdentity','prepareSensitiveIdentityFill','fillSensitiveIdentity','cancelSensitiveIdentityFill',
  'queueState','enqueueApplications','startApplicationQueue','cancelApplicationQueue','reviewQueuedApplication','closeQueuedApplication','refreshApplicationAttention',
  'importApplicationFacts','applyApplicationFactsImport','exportApplicationFactsTemplate',
  'workflowState','selectApplicationWorkflow','setApplicationIssueStatus','applicationAssets','saveAnswer','confirmAnswer','deleteAnswer','answerSuggestions',
  'importResumeVersion','exportResumeVersion','saveResumeVersion','deleteResumeVersion','selectApplicationResume',
  'saveCalendarEvent','deleteCalendarEvent','exportApplicationCalendar',
  'discoveryState','addDiscoverySource','discoverJobs','cancelDiscovery',
  'telemetryState','beginMeasurement','finishMeasurement','reviewMeasurement','exportTelemetry','importApplyDock',
  'getState','saveProfile','confirmCareerRecord','importResume','saveJob','deleteJob','trackJob','saveApplication','deleteApplication',
  'loadDemo','clearDemo','exportData','getSources','refreshSource','browserNavigate','browserBack',
  'browserForward','browserReload','browserZoom','locateApplicationField','locateWorkflowIssue','setFieldCompanionMotion','browserBounds','browserState','capturePage','collectPageJobs',
  'jobMatchingState','matchSavedJobs','cancelJobMatching',
  'prepareFill','fillApproved','prepareCareerFill','runCareerFill','cancelCareerFill','openTestForm','modelStatus','configureModel','runAgent','cancelAgent',
];
const api = Object.fromEntries(names.map(name => [name, (...args) => invoke(name, ...args)]));
api.onEvent = listener => {
  const receive = (_event, value) => listener(value);
  ipcRenderer.on('offer:event', receive);
  return () => ipcRenderer.removeListener('offer:event', receive);
};
contextBridge.exposeInMainWorld('offer', api);
