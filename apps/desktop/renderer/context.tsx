import type {AgentQuestionRequest,AgentQuestionResponse} from '../../../packages/shared/src/agent-questions.js';
import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { AgentEvent, AppState, Application, ApplicationInput, BrowserState, CapturedPage, FillPlan, FillResult, JobInput, ModelStatus, OfferAPI, SourceDefinition } from '../../../packages/shared/src/contracts.js';
import type { ChatMessage } from '../../../packages/ui/src/agent-state.js';
import type {ApplicationReport,ApplicationReportKind} from '../../../packages/ui/src/application-fill-workflow.js';
import type {AgentQuestionInput,AgentQuestionResult} from '../../../packages/shared/src/agent-questions.js';
export type { ChatMessage } from '../../../packages/ui/src/agent-state.js';

export type Page = 'apply' | 'dashboard' | 'jobs' | 'applications' | 'profile' | 'browser' | 'agent' | 'telemetry';
export interface FormPreviewState {
  plan: FillPlan;
  selectedFieldIds: string[];
  result?: FillResult;
  used: boolean;
  filling: boolean;
}
export function createFormPreviewState(plan: FillPlan): FormPreviewState {
  return { plan, selectedFieldIds: plan.items.filter(item => item.status === 'ready').map(item => item.fieldId), used: false, filling: false };
}
export interface Workspace {
  api: OfferAPI; state: AppState; sources: SourceDefinition[]; browser: BrowserState; model: ModelStatus;
  agentQuestion?:AgentQuestionRequest|null;answerAgentQuestion?:(response:AgentQuestionResponse)=>Promise<void>;
  askApplicationQuestion?:(taskId:string,input:AgentQuestionInput,signal:AbortSignal,form?:AgentQuestionRequest['form'],validate?:(result:AgentQuestionResult)=>void)=>Promise<AgentQuestionResult>;
  cancelApplicationQuestion?:()=>void;
  currentApplicationReport?:ApplicationReport;
  locateApplicationReview?:(report:ApplicationReport,target:import('../../../packages/ui/src/application-review.js').ApplicationReviewTarget)=>Promise<void>;
  recordApplicationReport?:(report:ApplicationReport)=>void;
  getApplicationReport?:(context:ApplicationReport['context'])=>ApplicationReport|undefined;
  showApplicationReport?:(kind:ApplicationReportKind)=>Promise<void>;
  agentBusy: boolean; messages: ChatMessage[]; events: AgentEvent[]; streamText: string; overlayOpen: boolean;
  browserFocusMode: boolean;
  toggleBrowserFocus: () => void;
  composerDraft: string;
  setComposerDraft: (text: string) => void;
  restoreAgentRequest: (messageId: string) => void;
  formPreview: FormPreviewState | undefined;
  setFormPreview: Dispatch<SetStateAction<FormPreviewState | undefined>>;
  setState: (state: AppState) => void; setBrowser: (state: BrowserState) => void; setModel: (status: ModelStatus) => void;
  navigate: (page: Page) => void; openBrowser: (url: string) => Promise<void>;
  openJob: (job?: JobInput, capture?: CapturedPage) => void;
  openApplication: (application?: Application | ApplicationInput) => void;
  openApplicationSetup?: () => void; openSources: () => void; openModel: () => void;
  startResumeImport: () => void;
  notify: (message: string, error?: boolean) => void;
  runAgent: (input: string) => Promise<void>;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace is unavailable.');
  return value;
}
