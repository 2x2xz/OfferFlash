import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { JobInput, Profile } from '../packages/shared/src/contracts.js';
import { constraintKinds, type ConstraintKind, type RankingJudgment } from '../packages/evaluation/src/ranking-scoring.js';

interface Persona {
  id: string; profile: Profile;
  evaluationPreferences: { region: string; acceptedRecruitmentTypes: string[]; fullTimeExperienceYears: number };
}
interface AuthoredJob {
  id: string; split: 'dev' | 'test'; employerGroup: string; templateFamily: string; tags: string[];
  job: JobInput; labelFacts: { region: string; sourceAuthenticity: string };
}
interface AuthoredJudgment extends RankingJudgment { personaId: string; rationale: string; }
interface Dataset {
  schemaVersion: number; suiteId: string; asOf: string; labelProvenance: string; humanGold: boolean;
  annotationProtocol: { independentHumanReview: boolean; modelInputProjection: string; eligibilityDimensions: string[]; sourceAuditDimensions: string[] };
  personas: Persona[]; jobs: AuthoredJob[]; qrels: AuthoredJudgment[];
}
const bytes = await readFile(new URL('../benchmarks/offerflash-v1/matching.json', import.meta.url));
const dataset = JSON.parse(bytes.toString('utf8')) as Dataset;
const judgment = (personaId: string, jobId: string) => {
  const result = dataset.qrels.find(row => row.personaId === personaId && row.jobId === jobId);
  assert.ok(result, `Missing authored judgment ${personaId}/${jobId}`);
  return result;
};

test('matching fixture freezes provenance, time, and the authored artifact before evaluation', () => {
  assert.equal(dataset.schemaVersion, 1);
  assert.equal(dataset.suiteId, 'offerflash-matching-v1');
  assert.equal(dataset.asOf, '2026-10-19T00:00:00Z');
  assert.equal(dataset.labelProvenance, 'authored-synthetic-diagnostic');
  assert.equal(dataset.humanGold, false);
  assert.equal(dataset.annotationProtocol.independentHumanReview, false);
  assert.match(dataset.annotationProtocol.modelInputProjection, /禁止传入 qrels、labelFacts/);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '30f355870d513d6f9103fbc5cf7869376c2a8132d6f0213ce90568e2e94fb5b5',
    'Changing frozen data requires a reviewed dataset version and an explicit new artifact hash, never edits to improve a run score');
});

test('six fictional personas have complete profile DTOs, reserved contacts, and confirmed authored evidence', () => {
  assert.deepEqual(dataset.personas.map(row => row.id), ['llm-2027', 'cv-2027', 'nlp-2026', 'backend-2027', 'rl-phd-2027', 'data-2027']);
  for (const { id, profile, evaluationPreferences } of dataset.personas) {
    for (const key of ['fullName', 'fullNameEn', 'email', 'phone', 'school', 'schoolEn', 'degree', 'major', 'majorEn', 'graduationMonth', 'resumeText', 'updatedAt'] as const) assert.equal(typeof profile[key], 'string');
    assert.match(profile.fullName, /^虚构候选人/);
    assert.equal(profile.email, `${id}@example.invalid`);
    assert.equal(profile.phone, '');
    assert.equal(profile.version, 1);
    assert.equal(profile.updatedAt, dataset.asOf);
    assert.ok(profile.skills.length > 0 && profile.cities.length > 0 && profile.targetRoles.length > 0);
    assert.equal(profile.graduationMonth, id === 'nlp-2026' ? '2026-07' : '2027-07');
    assert.deepEqual(evaluationPreferences.acceptedRecruitmentTypes, ['campus']);
    assert.equal(evaluationPreferences.region, 'mainland');
    assert.equal(evaluationPreferences.fullTimeExperienceYears, 0);
    const career = profile.career!;
    assert.equal(career.schemaVersion, 1);
    assert.equal(career.sources.length, 1);
    assert.equal(career.educations.length, 1);
    assert.equal(career.projects.length, 1);
    assert.equal(career.primaryEducationId, career.educations[0]!.id);
    for (const record of [...career.educations, ...career.projects]) {
      assert.equal(record.confirmation, 'confirmed');
      assert.equal(record.confirmedRevision, record.revision);
      assert.equal(record.confirmedAt, dataset.asOf);
      assert.ok(record.evidence.length > 0);
      assert.ok(record.evidence.every(item => career.sources.some(source => source.id === item.sourceId)));
    }
    assert.equal(new URL(career.projects[0]!.url).hostname, 'projects.example.invalid');
  }
});

test('36 independent jobs, employer groups and authored template families are isolated across splits', () => {
  assert.equal(dataset.jobs.length, 36);
  assert.equal(new Set(dataset.jobs.map(row => row.id)).size, 36);
  assert.equal(new Set(dataset.jobs.map(row => row.job.url)).size, 36);
  assert.equal(new Set(dataset.jobs.map(row => `${row.job.title}\n${row.job.description}\n${row.job.requirements}`)).size, 36);
  const groups = new Map<string, string>(), families = new Map<string, string>();
  for (const row of dataset.jobs) {
    assert.equal(row.job.id, row.id);
    assert.equal(row.job.demo, true);
    assert.match(row.job.company, /^虚构/);
    assert.equal(row.job.observedAt, dataset.asOf);
    assert.equal(new URL(row.job.url).hostname, 'careers.example.invalid');
    assert.equal(row.labelFacts.sourceAuthenticity, 'synthetic-not-official');
    for (const [map, group] of [[groups, row.employerGroup], [families, row.templateFamily]] as const) {
      if (map.has(group)) assert.equal(map.get(group), row.split, `${group} leaked between dev and test`);
      else map.set(group, row.split);
    }
    assert.ok(row.job.description.length > 20 && row.job.requirements.length > 15);
  }
  assert.equal(dataset.jobs.filter(row => row.split === 'dev').length, 18);
  assert.equal(dataset.jobs.filter(row => row.split === 'test').length, 18);
  assert.equal(groups.size, 12);
  assert.equal(families.size, 12);
});

test('all 216 persona-job pairs have explicit graded labels, rationales, and every constraint dimension', () => {
  assert.equal(dataset.qrels.length, 216);
  const keys = new Set<string>();
  for (const row of dataset.qrels) {
    const key = `${row.personaId}/${row.jobId}`;
    assert.ok(!keys.has(key)); keys.add(key);
    assert.ok(dataset.personas.some(persona => persona.id === row.personaId));
    assert.ok(dataset.jobs.some(job => job.id === row.jobId));
    assert.ok([0, 1, 2, 3].includes(row.relevance!));
    assert.ok(['eligible', 'ineligible', 'unknown'].includes(row.eligibility));
    assert.deepEqual(Object.keys(row.constraints!).sort(), [...constraintKinds].sort());
    assert.ok(Object.values(row.constraints!).every(value => ['pass', 'violation', 'unknown'].includes(value!)));
    assert.equal(row.constraints!['source-origin'], 'unknown');
    assert.equal(row.constraints!['source-freshness'], 'unknown');
    assert.match(row.rationale, /语义：.+。资格：.+。来源为原创虚构/);
    const statuses = dataset.annotationProtocol.eligibilityDimensions.map(kind => row.constraints![kind as ConstraintKind]);
    assert.equal(row.eligibility, statuses.includes('violation') ? 'ineligible' : statuses.includes('unknown') ? 'unknown' : 'eligible');
  }
  for (const persona of dataset.personas) for (const job of dataset.jobs) assert.ok(keys.has(`${persona.id}/${job.id}`));
});

test('hard negatives retain semantic matches while location, graduation, degree and deadline can fail', () => {
  const overseas = dataset.jobs.filter(row => row.tags.includes('overseas-hard-negative'));
  assert.equal(overseas.length, 3);
  for (const job of overseas) for (const persona of dataset.personas) {
    const row = judgment(persona.id, job.id);
    assert.equal(row.constraints!.region, 'violation');
    assert.equal(row.eligibility, 'ineligible');
  }
  for (const [personaId, jobId] of [['llm-2027', 'dev-10'], ['cv-2027', 'dev-11'], ['rl-phd-2027', 'dev-12'], ['llm-2027', 'dev-13'], ['cv-2027', 'test-02'], ['data-2027', 'test-08'], ['data-2027', 'test-12']]) {
    const row = judgment(personaId!, jobId!);
    assert.equal(row.relevance, 3);
    assert.equal(row.eligibility, 'ineligible');
  }
  assert.equal(judgment('nlp-2026', 'dev-18').constraints!.graduation, 'violation');
  assert.equal(judgment('nlp-2026', 'dev-18').constraints!.degree, 'violation');
  assert.equal(judgment('llm-2027', 'test-01').constraints!.graduation, 'pass');
  assert.equal(judgment('cv-2027', 'test-02').constraints!.graduation, 'violation');
});

test('preferred credentials, negated skills, uncertain fields and day-boundary dates are separate diagnostic cases', () => {
  assert.equal(judgment('data-2027', 'test-06').constraints!.degree, 'pass', 'master preferred does not exclude bachelor');
  assert.equal(judgment('rl-phd-2027', 'test-05').relevance, 3);
  assert.equal(judgment('llm-2027', 'dev-17').relevance, 0, 'negated RAG/Python are not core requirements');
  assert.equal(judgment('nlp-2026', 'test-13').relevance, 0, 'negated Java/text classification are not a positive NLP match');
  for (const id of ['dev-16', 'test-14']) assert.ok(dataset.qrels.filter(row => row.jobId === id).every(row => row.relevance === 0));
  assert.equal(judgment('llm-2027', 'dev-09').constraints!.city, 'unknown');
  assert.equal(judgment('llm-2027', 'test-10').eligibility, 'unknown');
  assert.equal(judgment('backend-2027', 'test-17').constraints!['recruitment-type'], 'unknown');
  assert.equal(judgment('backend-2027', 'test-11').constraints!.deadline, 'pass', 'date-only deadline remains open throughout frozen Shanghai date');
  assert.equal(judgment('data-2027', 'test-12').constraints!.deadline, 'violation');
  for (const persona of dataset.personas) assert.equal(judgment(persona.id, 'dev-14').constraints!['recruitment-type'], 'violation');
});
