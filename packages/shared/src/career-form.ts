/** Public, local-UI DTOs. These never expose the host's private browser snapshot. */
export type CareerFillCollection = 'educations' | 'internships' | 'projects';
export interface CareerFillBinding {
  collection: CareerFillCollection;
  recordId: string;
  revision: number;
  profileVersion: number;
  groupId: string;
  groupSignature: string;
}
export interface CareerFillOptions {
  profileVersion: number;
  selectedRecordIds?: Partial<Record<CareerFillCollection, string[]>>;
  bindings?: CareerFillBinding[];
  preserveGroupIds?: string[];
}
export interface CareerFillField {
  id: string;
  key: string;
  type: string;
  value: string;
  editable: boolean;
  required?: boolean;
  supportsUntilNow?: boolean;
  signature?: string;
}
export interface CareerFillPageGroup {
  id: string;
  collection: CareerFillCollection;
  signature: string;
  fields: CareerFillField[];
}
export interface CareerFillPreviewItem {
  fieldId: string;
  key: string;
  value: string;
  currentValue: string;
  status: 'ready' | 'skip' | 'review';
  reason: string;
  required?: boolean | null;
}
export interface CareerFillPreviewStep {
  kind: 'fill-group' | 'add-then-reobserve';
  collection: CareerFillCollection;
  recordId: string;
  groupId?: string;
  items?: CareerFillPreviewItem[];
}
export interface CareerFillIssue {
  collection: CareerFillCollection;
  recordId?: string;
  reason: string;
}
export interface CareerFillPreview {
  planId: string;
  url: string;
  profileVersion: number;
  groups: CareerFillPageGroup[];
  bindings: CareerFillBinding[];
  selectedRecordIds: Partial<Record<CareerFillCollection, string[]>>;
  preserveGroupIds: string[];
  steps: CareerFillPreviewStep[];
  issues: CareerFillIssue[];
}
export interface CareerFillPending {
  collection: CareerFillCollection;
  recordId?: string;
  groupId?: string;
  fieldId?: string;
  key?: string;
  /** null means the site did not establish requiredness; a section notice is not a required field. */
  required: boolean | null;
  scope?: 'field' | 'section';
  label?: string;
  type?: string;
  reasonCode?: 'missing-profile' | 'unsupported-field' | 'needs-review' | 'not-yet-filled' | 'verification-failed' | 'unbound-record';
  reason: string;
}
export interface CareerFillOutcome {
  retryCount?: number;
  status: 'completed' | 'partial' | 'stopped';
  addedCount: number;
  verifiedCount: number;
  pending: CareerFillPending[];
  stopReason?: string;
  /** Only a fixed, locally produced browser guard message; never a raw page/provider error. */
  failureMessage?: string;
  bindings: CareerFillBinding[];
}
