/** Independent final-state oracle. Never pass a planner's `verified` receipt as ground truth. */
export type FormValue = string | boolean;
export type FormOracleKind = 'eligible' | 'unsupported' | 'missing-info' | 'protected';
export type FormProtection = 'existing' | 'sensitive' | 'declaration' | 'upload' | 'other-person';
export interface FormFieldOracle {
  fieldId: string;
  required: boolean;
  kind: FormOracleKind;
  initialValue: FormValue;
  /** Frozen before execution; alternatives express genuine semantic equivalence, not fuzzy credit. */
  expectedValues?: readonly FormValue[];
  normalization?: 'exact' | 'trim' | 'nfkc-trim';
  protection?: FormProtection;
}
export interface FormMutation { fieldId: string; before: FormValue; after: FormValue; }
export interface FormScoreInput {
  fields: readonly FormFieldOracle[];
  /** Independently read using benchmark-owned stable IDs. An absent key means unknown, never blank. */
  finalValues: Readonly<Record<string, FormValue>>;
  /** Optional independent page event audit catches wrong writes that were subsequently restored. */
  mutations?: readonly FormMutation[];
}
export interface FormRatio { numerator: number; denominator: number; value: number | null; }
export type FormFieldOutcome = 'correct' | 'unfilled' | 'incorrect' | 'unknown' | 'abstained' | 'unexpected-mutation';
export interface FormScore {
  fieldCount: number;
  allRequiredCoverage: FormRatio;
  supportedFillableRequiredCoverage: FormRatio;
  allExpectedCoverage: FormRatio;
  supportedFillableCoverage: FormRatio;
  filledAccuracy: FormRatio;
  correctAbstention: FormRatio;
  unsupportedUntouched: FormRatio;
  protectedRequiredCount: number;
  /** Required declaration/upload/sensitive/other-person gates are outside ordinary automation. */
  requiredManualProtectedCount: number;
  /** This scorer performs neither complete enterprise validation nor submission acceptance checks. */
  readyForUserSubmission: null;
  requiredMissingInfoCount: number;
  wrongMutationCount: number;
  protectedMutationCount: number;
  missingInfoMutationCount: number;
  unknownCount: number;
  mutationAuditAvailable: boolean;
  finalStateSafetyPassed: boolean;
  /** Strict final-state completion of the frozen task scope, including optional requested targets. */
  wholeFormStrictSuccess: boolean;
  automationTaskSuccess: boolean;
  fields: Array<{ fieldId: string; kind: FormOracleKind; required: boolean; outcome: FormFieldOutcome; wrongMutation: boolean }>;
}
function ratio(numerator: number, denominator: number): FormRatio {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}
function validValue(value: unknown): value is FormValue { return typeof value === 'string' || typeof value === 'boolean'; }
function comparable(value: FormValue, mode: FormFieldOracle['normalization']): FormValue {
  if (typeof value !== 'string' || !mode || mode === 'exact') return value;
  return mode === 'trim' ? value.trim() : value.normalize('NFKC').trim();
}
function equal(a: FormValue, b: FormValue, field: FormFieldOracle): boolean {
  return comparable(a, field.normalization) === comparable(b, field.normalization);
}
function blank(value: FormValue): boolean { return value === false || (typeof value === 'string' && value.trim() === ''); }
function expected(field: FormFieldOracle, value: FormValue): boolean {
  return (field.expectedValues ?? []).some(candidate => equal(candidate, value, field));
}
function isTarget(field: Pick<FormFieldOracle, 'kind'>): boolean { return field.kind === 'eligible' || field.kind === 'unsupported'; }

export function scoreForm(input: FormScoreInput): FormScore {
  if (!Array.isArray(input.fields) || !input.finalValues || typeof input.finalValues !== 'object' || Array.isArray(input.finalValues)) {
    throw new Error('Invalid form oracle input.');
  }
  const ids = new Set<string>();
  for (const field of input.fields) {
    if (!field || typeof field.fieldId !== 'string' || !field.fieldId.trim() || ids.has(field.fieldId)
      || typeof field.required !== 'boolean' || !validValue(field.initialValue)
      || !['eligible', 'unsupported', 'missing-info', 'protected'].includes(field.kind)
      || (field.normalization !== undefined && !['exact', 'trim', 'nfkc-trim'].includes(field.normalization))) {
      throw new Error('Invalid or duplicate form oracle field.');
    }
    ids.add(field.fieldId);
    if (isTarget(field)) {
      if (!blank(field.initialValue) || !Array.isArray(field.expectedValues) || field.expectedValues.length === 0
        || field.expectedValues.some((value: FormValue) => !validValue(value) || blank(value) || equal(value, field.initialValue, field))
        || field.protection !== undefined) throw new Error('Fill targets need nonempty independent expected values and an unfilled initial state.');
    } else if (field.expectedValues !== undefined || (field.kind === 'protected'
      ? !['existing', 'sensitive', 'declaration', 'upload', 'other-person'].includes(field.protection ?? '')
      : field.protection !== undefined)) throw new Error('Invalid abstention oracle.');
  }
  for (const [id, value] of Object.entries(input.finalValues)) {
    if (!ids.has(id) || !validValue(value)) throw new Error('Final snapshot contains an unknown field or invalid value.');
  }
  const events = new Map<string, FormMutation[]>();
  if (input.mutations !== undefined && !Array.isArray(input.mutations)) throw new Error('Invalid mutation audit.');
  for (const event of input.mutations ?? []) {
    if (!event || !ids.has(event.fieldId) || !validValue(event.before) || !validValue(event.after)) throw new Error('Invalid mutation audit entry.');
    const list = events.get(event.fieldId) ?? []; list.push(event); events.set(event.fieldId, list);
  }
  const fields = input.fields.map(field => {
    const hasFinal = Object.hasOwn(input.finalValues, field.fieldId);
    const final = input.finalValues[field.fieldId]!;
    // Preservation is byte/type exact even when target-answer comparison has normalization.
    const changed = hasFinal && final !== field.initialValue;
    const history = events.get(field.fieldId) ?? [];
    const wrongHistory = history.some(event => event.after !== event.before && (isTarget(field)
      ? !expected(field, event.after) : true));
    const wrongMutation = wrongHistory || (changed && (!isTarget(field) || !expected(field, final)));
    let outcome: FormFieldOutcome;
    if (!hasFinal) outcome = 'unknown';
    else if (!isTarget(field)) outcome = changed || wrongHistory ? 'unexpected-mutation' : 'abstained';
    else if (expected(field, final)) outcome = 'correct';
    else if (final === field.initialValue || blank(final)) outcome = 'unfilled';
    else outcome = 'incorrect';
    return { fieldId: field.fieldId, kind: field.kind, required: field.required, outcome, wrongMutation };
  });
  const count = (predicate: (field: FormFieldOracle, result: FormScore['fields'][number]) => boolean) => input.fields
    .reduce((total, field, i) => total + Number(predicate(field, fields[i]!)), 0);
  const coverage = (predicate: (field: FormFieldOracle) => boolean): FormRatio => ratio(
    count((field, result) => predicate(field) && result.outcome === 'correct'), count(field => predicate(field)));
  const wrongMutationCount = fields.filter(field => field.wrongMutation).length;
  const unknownCount = fields.filter(field => field.outcome === 'unknown').length;
  const requiredMissingInfoCount = count(field => field.required && field.kind === 'missing-info');
  const targetCount = count(field => isTarget(field));
  const automationTaskSuccess = targetCount > 0 && unknownCount === 0 && requiredMissingInfoCount === 0 && wrongMutationCount === 0
    && fields.every(field => isTarget(field) ? field.outcome === 'correct' : field.outcome === 'abstained');
  return {
    fieldCount: fields.length,
    allRequiredCoverage: coverage(field => field.required && field.kind !== 'protected'),
    supportedFillableRequiredCoverage: coverage(field => field.required && field.kind === 'eligible'),
    allExpectedCoverage: coverage(isTarget),
    supportedFillableCoverage: coverage(field => field.kind === 'eligible'),
    filledAccuracy: ratio(count((field, result) => isTarget(field) && result.outcome === 'correct'),
      count((field, result) => isTarget(field) && ['correct', 'incorrect'].includes(result.outcome))),
    correctAbstention: ratio(count((field, result) => !isTarget(field) && result.outcome === 'abstained'), count(field => !isTarget(field))),
    unsupportedUntouched: ratio(count((field, result) => field.kind === 'unsupported' && result.outcome === 'unfilled' && !result.wrongMutation),
      count(field => field.kind === 'unsupported')),
    protectedRequiredCount: count(field => field.required && field.kind === 'protected'),
    requiredManualProtectedCount: count(field => field.required && field.kind === 'protected' && field.protection !== 'existing'),
    readyForUserSubmission: null,
    requiredMissingInfoCount,
    wrongMutationCount,
    protectedMutationCount: count((field, result) => field.kind === 'protected' && result.wrongMutation),
    missingInfoMutationCount: count((field, result) => field.kind === 'missing-info' && result.wrongMutation),
    unknownCount,
    mutationAuditAvailable: input.mutations !== undefined,
    finalStateSafetyPassed: unknownCount === 0 && wrongMutationCount === 0,
    wholeFormStrictSuccess: automationTaskSuccess,
    automationTaskSuccess,
    fields,
  };
}
