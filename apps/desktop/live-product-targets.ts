import type { FillItem, FillPlan } from '../../packages/shared/src/contracts.js';

export const LIVE_CONTACT_VALUES = {
  fullName: 'OfferAgent Validation', fullNameEn: 'OfferAgent Validation',
  email: 'offeragent-validation@example.invalid', phone: '2025550100',
} as const;
export type ContactCategory = 'name' | 'email' | 'phone';
export interface LiveProductTarget {
  id: string; company: string; title: string; url: string;
  expectedContactCategories: readonly ContactCategory[];
  expectedManualContactLabels?: readonly string[];
}
/** Deliberate public-page catalog. Adding a page requires source review, never an arbitrary URL. */
export const LIVE_PRODUCT_TARGETS: readonly LiveProductTarget[] = [
  { id: 'portcast-senior', company: 'Portcast', title: 'Senior Machine Learning Engineer',
    url: 'https://jobs.lever.co/portcast/d206930c-1ecd-41fe-b603-b28ad98a5ea4/apply', expectedContactCategories: ['name', 'email', 'phone'] },
  { id: 'portcast-intern', company: 'Portcast', title: 'Data Analyst Intern',
    url: 'https://jobs.lever.co/portcast/f18cc64e-c34a-416c-b213-62a39906260e/apply', expectedContactCategories: ['name', 'email', 'phone'] },
  { id: 'resourcifi-prompt', company: 'Resourcifi', title: 'AI Prompt Engineer',
    url: 'https://www.resourcifi.com/careers/ai-prompt-engineer/', expectedContactCategories: ['name', 'email', 'phone'] },
  { id: 'verantos-greenhouse', company: 'Verantos', title: 'Public Greenhouse application',
    url: 'https://job-boards.greenhouse.io/verantos/jobs/6132688004', expectedContactCategories: ['email', 'phone'],
    expectedManualContactLabels: ['First Name', 'Last Name'] },
  { id: 'oakslab-ashby', company: 'OAK’S LAB', title: 'Public Ashby application',
    url: 'https://jobs.ashbyhq.com/oakslab/3fb1bab3-5182-4866-bc17-9b18199f4468/application', expectedContactCategories: ['name', 'email'] },
];
export class LiveProductCheckError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'LiveProductCheckError'; }
}
export function requireLiveCheck(condition: unknown, code: string): asserts condition {
  if (!condition) throw new LiveProductCheckError(code);
}
export function resolveLiveProductTarget(url: string, caseId?: string): LiveProductTarget {
  const target = LIVE_PRODUCT_TARGETS.find(candidate => candidate.url === url && (!caseId || candidate.id === caseId));
  requireLiveCheck(target, 'EXPLICIT_KNOWN_TARGET_REQUIRED');
  return target;
}
export interface LiveReadField {
  index: number; label: string; type: string; value: string;
  identity?: string; section?: string; editable?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  metadata?: { id: string; name: string; autocomplete: string; formIndex: number; formId: string; formName: string; formAction: string;
    nativeValid: boolean; validationMessage: string; ariaInvalid: string; errorText: string };
}
export interface LiveReadFields { url: string; title: string; fields: LiveReadField[]; viewport?: { width: number; height: number } }
export function contactCategory(label: string): ContactCategory | undefined {
  const clean = label.replace(/[*✱∗＊✳※:：]/g, '').replace(/\s+/g, ' ').trim();
  if (/^(?:(?:your|applicant|candidate)\s+)?(?:full\s*name|name)$/i.test(clean)) return 'name';
  if (/^(?:your\s+)?e[ -]?mail(?:\s+address)?$/i.test(clean)) return 'email';
  if (/^(?:your\s+)?(?:phone|mobile|telephone)(?:\s+(?:number|no\.?))?$/i.test(clean)) return 'phone';
  return undefined;
}
function keyCategory(key: string | undefined): ContactCategory | undefined {
  return key === 'fullName' || key === 'fullNameEn' ? 'name' : key === 'email' || key === 'phone' ? key : undefined;
}
/** An independent testing guard: reject any unsafe plan before invoking production writes.
 * Missing supported contacts remain a measured failure, rather than blocking safe partial work. */
export function validateLiveContactSelection(plan: FillPlan | undefined, fieldIds: unknown,
  before: LiveReadFields | undefined, target: LiveProductTarget): FillItem[] {
  requireLiveCheck(plan && before && plan.url === before.url, 'CURRENT_OBSERVED_PLAN_REQUIRED');
  requireLiveCheck(Array.isArray(fieldIds) && fieldIds.length > 0
    && fieldIds.length <= target.expectedContactCategories.length
    && fieldIds.every(id => typeof id === 'string') && new Set(fieldIds).size === fieldIds.length, 'BOUNDED_UNIQUE_CONTACT_SELECTION_REQUIRED');
  const chosen: FillItem[] = [];
  const categories = new Set<ContactCategory>();
  const forms = new Set<number>();
  for (const id of fieldIds as string[]) {
    const item = plan.items.find(candidate => candidate.fieldId === id);
    const field = before.fields.find(candidate => `field-${candidate.index}` === id);
    requireLiveCheck(item && field && item.status === 'ready' && item.currentValue === '' && field.value === ''
      && field.editable !== false && ['text', 'email', 'tel'].includes(field.type), 'ONLY_BLANK_NATIVE_CONTACT_FIELDS_ALLOWED');
    const category = contactCategory(field.label);
    requireLiveCheck(category && keyCategory(item.profileKey) === category
      && target.expectedContactCategories.includes(category), 'EXPLICIT_CONTACT_SEMANTICS_REQUIRED');
    requireLiveCheck(!categories.has(category), 'DUPLICATE_CONTACT_CATEGORY_REJECTED');
    requireLiveCheck(Object.hasOwn(LIVE_CONTACT_VALUES, item.profileKey ?? '')
      && item.value === LIVE_CONTACT_VALUES[item.profileKey as keyof typeof LIVE_CONTACT_VALUES], 'SYNTHETIC_CONTACT_VALUE_REQUIRED');
    categories.add(category);
    if (field.metadata) forms.add(field.metadata.formIndex);
    chosen.push(item);
  }
  requireLiveCheck(forms.size <= 1, 'CROSS_FORM_CONTACT_SELECTION_REJECTED');
  return chosen;
}
