import type {JobMatchingRequest,JobMatchingState} from './job-matching.js';
import type { TelemetryBeginInput, TelemetryFinishInput, TelemetryReviewInput, TelemetryRun, TelemetryState } from '../../telemetry/src/contracts.js';
export type * from '../../telemetry/src/contracts.js';
import type { RunResult, RuntimeEvent } from '../../runtime/src/runtime.js';
import type { CareerFillOptions, CareerFillOutcome, CareerFillPreview } from './career-form.js';
export type * from './career-form.js';
import type { ApplicationWorkflowAPI, ApplicationWorkflowState } from './application-workflow.js';
import type { ApplicationAssetsAPI, ApplicationAssetsState } from './application-assets.js';
import type { DiscoveryAPI, DiscoveryState } from './discovery.js';
export type * from './application-workflow.js';
export type * from './application-assets.js';
export type * from './discovery.js';
import type { ApplicationFactsPreview } from '../../profile/src/application-facts.js';
import type { ApplicationQueueState, ApplicationQueueStartInput } from './application-queue.js';
import type { SensitiveIdentityAPI } from './sensitive-identity.js';
export type * from './sensitive-identity.js';
export type * from './application-queue.js';

export type RecruitmentType = 'campus' | 'internship' | 'experienced' | 'unknown';
export type ApplicationStatus = 'needs-review' | 'saved' | 'applied' | 'assessment' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
export type CareerCollection = 'educations' | 'internships' | 'projects' | 'publications';
export interface CareerSourceInput {
  id: string; kind: 'manual' | 'resume' | 'legacy'; label: string;
  text: string; fileName?: string; fileHash?: string;
}
export interface CareerSource extends CareerSourceInput { createdAt: string; }
export interface CareerEvidence {
  field: string; sourceId: string; quote: string; location: string; originalValue: string;
}
export interface CareerRecordInput {
  id: string; evidence: CareerEvidence[]; sourceNote: string;
}
export interface EducationInput extends CareerRecordInput {
  school: string; schoolEn: string; degree: string; major: string; majorEn: string;
  startDate: string; endDate: string; description: string;
}
export interface InternshipInput extends CareerRecordInput {
  organization: string; role: string; startDate: string; endDate: string;
  current: boolean; description: string; technologies: string[];
}
export interface ProjectInput extends CareerRecordInput {
  name: string; role: string; startDate: string; endDate: string;
  ongoing: boolean; description: string; technologies: string[]; url: string;
}
export interface PublicationInput extends CareerRecordInput {
  title: string; authors: string; venue: string; publicationDate: string;
  status: 'published' | 'accepted' | 'preprint' | 'submitted' | 'in-progress'; doi: string; url: string;
}
export interface CareerRecordState {
  revision: number; confirmation: 'pending' | 'confirmed';
  confirmedAt: string | null; confirmedRevision: number | null;
}
export type EducationRecord = EducationInput & CareerRecordState;
export type InternshipRecord = InternshipInput & CareerRecordState;
export type ProjectRecord = ProjectInput & CareerRecordState;
export type PublicationRecord = PublicationInput & CareerRecordState;
export interface CareerInput {
  schemaVersion: 1; sources: CareerSourceInput[];
  educations: EducationInput[]; internships: InternshipInput[];
  projects: ProjectInput[]; publications: PublicationInput[];
  primaryEducationId: string | null;
}
export interface CareerHistory extends CareerInput {
  sources: CareerSource[]; educations: EducationRecord[]; internships: InternshipRecord[];
  projects: ProjectRecord[]; publications: PublicationRecord[];
}
export interface ProfileInput {
  fullName: string; fullNameEn: string; email: string; phone: string;
  school: string; schoolEn: string; degree: string; major: string; majorEn: string;
  graduationMonth: string; skills: string[]; cities: string[]; targetRoles: string[];
  acceptedRecruitmentTypes?: Array<'campus'|'internship'|'experienced'>;
  resumeText: string;
  career?: CareerInput;
}
export interface Profile extends ProfileInput { version: number; updatedAt: string; career?: CareerHistory; }
export interface MatchResult {
  score: number; reasons: string[]; concerns: string[]; eligible: 'likely' | 'review' | 'unsuitable';
  profileVersion: number;
}
export interface JobInput {
  id?: string; company: string; title: string; city: string; type: RecruitmentType;
  description: string; requirements: string; url: string; sourceId: string; sourceName: string;
  observedAt?: string; publishedAt: string | null; deadline: string | null; demo: boolean;
}
export interface Job extends JobInput {
  id: string; observedAt: string; firstSeenAt: string; match: MatchResult;
  detailEvidence?: { url: string; checkedAt: string };
}
export interface ApplicationInput {
  id?: string; jobId?: string; company: string; title: string; url: string;
  status: ApplicationStatus; deadline: string | null; notes: string;
}
export interface Application extends ApplicationInput {
  id: string; createdAt: string; updatedAt: string; demo: boolean;
  history: Array<{ at: string; status: ApplicationStatus; note: string }>;
}
export type SourceCollectionStatus = 'success' | 'partial' | 'failed';
export interface SourceCollectionOptions { maxPages?: number; pageSize?: number; detailLimit?: number; }
export interface PageCollectionOptions extends SourceCollectionOptions { scope?: 'current-page' | 'bounded-list'; }
export interface SourceCollectionReport {
  schemaVersion: 1; status: SourceCollectionStatus;
  query: { keyword: string; pageSize: number | null; maxPages: number; detailLimit: number };
  scope: { mode: 'official-api-pages' | 'browser-list-pages' | 'visible-page'; listURL: string; description: string };
  pagesRequested: number; pagesSucceeded: number; officialTotal: number | null;
  listedCount: number; detailRequested: number; detailSucceeded: number; detailFailed: number;
  stopReason: 'exhausted' | 'empty-page' | 'repeated-page' | 'no-new-items' | 'page-limit' | 'request-failed' | 'invalid-response' | 'aborted' | 'pagination-unavailable' | 'scope-changed' | 'current-page';
  errors: Array<{ stage: 'list' | 'detail'; pageIndex?: number; jobId?: string; code: string; message: string }>;
  detailResults?: Array<{ jobURL: string; status: 'success' | 'failed' }>;
  newCount?: number; updatedCount?: number;
}
export interface SourceCollectionResult { jobs: JobInput[]; report: SourceCollectionReport; }
export interface SourceRun {
  id: string; sourceId: string; sourceName: string; status: SourceCollectionStatus;
  count: number; observedAt: string; error?: string; report?: SourceCollectionReport;
}
export interface AppSettings { showDemo: boolean; }
export interface AppState {
  profile: Profile; jobs: Job[]; applications: Application[]; sourceRuns: SourceRun[]; settings: AppSettings;
}
export interface SourceDefinition {
  id: string; name: string; company: string; url: string; type: RecruitmentType;
  mode: 'public-api' | 'browser'; description: string;
}

export interface BrowserBounds { x: number; y: number; width: number; height: number; }
export interface BrowserState {
  url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean;
  visible: boolean; error?: string; zoomPercent?: 80 | 90 | 100;
}
/** Local UI can request a previously observed field, never a selector or coordinates. */
export interface ApplicationFieldLocationInput {
  kind: 'ordinary' | 'career'; planId: string; fieldId?: string; groupId?: string; fieldKey?: string;
}
export interface ApplicationFieldLocationResult {
  status: 'located' | 'stale' | 'ambiguous' | 'unsupported' | 'blocked'; message: string;
}
export interface FieldObservation {
  id: string; index: number; label: string; type: string; value: string; required: boolean;
  /** Observed radio/checkbox state; never an instruction to toggle it. */
  checked?: boolean;
  editable: boolean; options: Array<{ label: string; value: string }>; bounds: BrowserBounds;
  signature: string; section?: string;
  /** A narrow, host-observed ARIA single-select relationship, never model supplied. */
  customSelect?: CustomSelectBinding;
}
export interface CustomSelectBinding {
  kind: 'aria-single-select' | 'local-single-select'; relationship: 'controls' | 'owns' | 'sibling'; popupId: string;
  valueSource: 'input-value' | 'aria-valuetext';
}
export interface FormObservation {
  id: string; url: string; title: string; observedAt: string; signature: string; fields: FieldObservation[];
}
export interface FillItem {
  /** Host-observed read-only metadata, never provided by a model as input permission. */
  required?: boolean; type?: string; fieldSignature?: string;
  fieldId: string; label: string; value: string; currentValue: string;
  /** Host verified this select's current real option is a placeholder. */
  currentValueIsPlaceholder?: boolean;
  status: 'ready' | 'skip' | 'review'; reason: string; profileKey?: keyof ProfileInput;
}
export interface FillPlan {
  id: string; url: string; title: string; profileVersion: number; observationId: string;
  createdAt: string; items: FillItem[];
  recognition?: { mode: 'model' | 'rules' | 'fallback'; modelId?: string; mappedCount: number; message: string;
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }; httpStatus?: number };
}
export interface FillResult {
  recoveredCount?:number; recoveryAttempted?:boolean;
  retryCount?: number;
  planId: string; verified: Array<{ fieldId: string; label: string }>;
  unresolved: Array<{ fieldId: string; label: string; reason: string }>;
}
export interface CapturedPage { url: string; title: string; text: string; }
export interface ActionRecord {
  id: string; planId: string; status: 'intent' | 'verified' | 'partial' | 'unknown';
  createdAt: string; updatedAt: string; payload: unknown; result?: unknown;
}
export interface ResumeEvidence {
  field: keyof ProfileInput | 'link'; value: string; quote: string; source: string;
}
export interface ResumeImport {
  cancelled: boolean; fileName?: string; text?: string; suggested?: Partial<ProfileInput>;
  evidence?: ResumeEvidence[]; warnings?: string[];
  career?: CareerInput;
}
export interface ModelConfig {
  mode: 'demo' | 'live'; provider: string; modelId: string; apiKey: string; baseURL?: string;
}
export interface ModelStatus { mode: 'demo' | 'live'; provider: string; modelId: string; configured: boolean; }
export type AgentEvent = RuntimeEvent;
export type AgentRunResult = RunResult;
export type AppEvent =
  | {type:'job-matching';state:JobMatchingState}
  | { type: 'application-queue'; state: ApplicationQueueState }
  | { type: 'form-retry'; kind: 'ordinary' | 'career'; label: string; attempt: number; maxAttempts: number }
  | { type: 'application-workflow'; state: ApplicationWorkflowState }
  | { type: 'application-assets'; state: ApplicationAssetsState }
  | { type: 'discovery'; state: DiscoveryState }
  | { type: 'telemetry'; state: TelemetryState }
  | { type: 'state'; state: AppState }
  | { type: 'browser'; state: BrowserState }
  | { type: 'form-preview'; plan: FillPlan }
  | { type: 'agent'; event: AgentEvent }
  | { type: 'model'; status: ModelStatus }
  | { type: 'navigate'; page: 'apply' | 'dashboard' | 'browser' | 'jobs' | 'applications' | 'profile' | 'agent' | 'telemetry' }
  | { type: 'error'; message: string };

export interface OfferAPI extends ApplicationWorkflowAPI, ApplicationAssetsAPI, DiscoveryAPI, SensitiveIdentityAPI {
  queueState(): Promise<ApplicationQueueState>;
  enqueueApplications(input: ApplicationQueueStartInput): Promise<ApplicationQueueState>;
  startApplicationQueue(): Promise<ApplicationQueueState>;
  cancelApplicationQueue(): Promise<ApplicationQueueState>;
  reviewQueuedApplication(id: string): Promise<void>;
  closeQueuedApplication(id: string): Promise<ApplicationQueueState>;
  importApplicationFacts(): Promise<{ cancelled: boolean; fileName?: string; preview?: ApplicationFactsPreview }>;
  applyApplicationFactsImport(previewId: string, selectedCandidateIds: string[], expectedVersion: number): Promise<ProfileInput>;
  exportApplicationFactsTemplate(): Promise<{ cancelled: boolean; path?: string }>;
  selectApplicationWorkflow(workflowId: string): Promise<void>;
  telemetryState(): Promise<TelemetryState>;
  beginMeasurement(input: Omit<TelemetryBeginInput, 'scenarioKey' | 'source'> & { scenarioKey?: string }): Promise<TelemetryRun>;
  finishMeasurement(input: TelemetryFinishInput): Promise<TelemetryRun>;
  reviewMeasurement(input: TelemetryReviewInput): Promise<TelemetryRun>;
  exportTelemetry(): Promise<{ cancelled: boolean; path?: string }>;
  importApplyDock(): Promise<{ cancelled: boolean; state?: AppState; addedFields?: number; conflictCount?: number; warnings?: string[] }>;
  getState(): Promise<AppState>;
  saveProfile(profile: ProfileInput, expectedVersion?: number): Promise<AppState>;
  confirmCareerRecord(collection: CareerCollection, recordId: string, expectedVersion: number, expectedRevision: number): Promise<AppState>;
  importResume(): Promise<ResumeImport>;
  saveJob(job: JobInput): Promise<AppState>;
  deleteJob(id: string): Promise<AppState>;
  saveApplication(input: ApplicationInput): Promise<AppState>;
  trackJob(jobId: string): Promise<AppState>;
  deleteApplication(id: string): Promise<AppState>;
  loadDemo(): Promise<AppState>;
  clearDemo(): Promise<AppState>;
  exportData(): Promise<{ cancelled: boolean; path?: string }>;
  getSources(): Promise<SourceDefinition[]>;
  refreshSource(sourceId: string, query?: string, options?: SourceCollectionOptions): Promise<AppState>;
  browserNavigate(url: string): Promise<BrowserState>;
  browserBack(): Promise<BrowserState>;
  browserForward(): Promise<BrowserState>;
  browserReload(): Promise<BrowserState>;
  browserZoom(percent: 80 | 90 | 100): Promise<BrowserState>;
  locateApplicationField(input: ApplicationFieldLocationInput): Promise<ApplicationFieldLocationResult>;
  locateWorkflowIssue(input: { workflowId: string; issueId: string }): Promise<ApplicationFieldLocationResult>;
  refreshApplicationAttention(): Promise<ApplicationWorkflowState>;
  setFieldCompanionMotion(input: { enabled: boolean; reducedMotion: boolean }): Promise<void>;
  browserBounds(bounds: BrowserBounds, visible: boolean): Promise<void>;
  browserState(): Promise<BrowserState>;
  capturePage(): Promise<CapturedPage>;
  collectPageJobs(options?: PageCollectionOptions): Promise<AppState>;
  prepareFill(options?: { useModel?: boolean; scope?: 'contacts' }): Promise<FillPlan>;
  fillApproved(planId: string, fieldIds: string[]): Promise<FillResult>;
  prepareCareerFill(options?: CareerFillOptions): Promise<CareerFillPreview>;
  runCareerFill(planId: string): Promise<CareerFillOutcome>;
  cancelCareerFill(): Promise<void>;
  openTestForm(): Promise<BrowserState>;
  jobMatchingState?(): Promise<JobMatchingState>;
  matchSavedJobs?(input: JobMatchingRequest): Promise<JobMatchingState>;
  cancelJobMatching?(): Promise<void>;
  modelStatus(): Promise<ModelStatus>;
  configureModel(config: ModelConfig): Promise<ModelStatus>;
  runAgent(input: string): Promise<AgentRunResult>;
  cancelAgent(): Promise<void>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
