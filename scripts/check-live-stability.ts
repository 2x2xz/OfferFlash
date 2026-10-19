import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { contactCategory, LIVE_CONTACT_VALUES, LIVE_PRODUCT_TARGETS,
  type LiveProductTarget } from '../apps/desktop/live-product-targets.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHILD_TIMEOUT_MS = 150_000, KILL_GRACE_MS = 10_000;
const frozenCaseIds = ['portcast-senior', 'portcast-intern', 'resourcifi-prompt', 'verantos-greenhouse', 'oakslab-ashby'];
const usageKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const object = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
class CheckError extends Error { constructor(readonly code: string) { super(code); } }
const requireCheck = (condition: unknown, code: string): void => { if (!condition) throw new CheckError(code); };

function argumentsForRun(args: string[]) {
  let rounds = 3, outputDir: string | undefined, executable: string | undefined;
  const seen = new Set<string>();
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return { help: true as const, rounds };
    const match = arg.match(/^--(rounds|output-dir|executable)=(.+)$/u);
    requireCheck(match && !seen.has(match[1]!), 'INVALID_OR_DUPLICATE_ARGUMENT');
    const key = match![1]!, value = match![2]!; seen.add(key);
    if (key === 'rounds') { requireCheck(/^[1-3]$/u.test(value), 'ROUNDS_MUST_BE_ONE_TO_THREE'); rounds = Number(value); }
    else { requireCheck(isAbsolute(value) && !/[\r\n\u0000]/u.test(value), 'ABSOLUTE_LOCAL_PATH_REQUIRED');
      if (key === 'output-dir') outputDir = value; else executable = value; }
  }
  return { help: false as const, rounds, outputDir, executable };
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function treeFiles(root: string, roots: string[]): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = [];
  const walk = async (path: string): Promise<void> => {
    const stat = await lstat(path);
    requireCheck(!stat.isSymbolicLink(), 'SOURCE_SYMLINK_REQUIRES_REVIEW');
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) if (name !== '.DS_Store') await walk(join(path, name));
    } else if (stat.isFile()) files.push({ path: relative(root, path), sha256: await fileHash(path) });
  };
  for (const path of roots) await walk(join(root, path));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function baseline(executable: string, runtimeRoot: string) {
  const [sourceFiles, runtimeFiles, executableSha256] = await Promise.all([
    treeFiles(projectRoot, ['apps', 'packages', 'prompts', 'skills', 'scripts', 'package.json', 'package-lock.json']),
    treeFiles(runtimeRoot, ['dist', 'prompts', 'skills', 'apps/desktop/main.cjs', 'apps/desktop/preload.cjs', 'package.json', 'package-lock.json']),
    fileHash(executable),
  ]);
  let gitCommit: string | null = null;
  try { const result = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeout: 5000 });
    if (/^[a-f0-9]{40}\s*$/u.test(result.stdout)) gitCommit = result.stdout.trim(); } catch { /* Hashes remain authoritative. */ }
  const sourceSha256 = digest(JSON.stringify(sourceFiles)), runtimeSha256 = digest(JSON.stringify(runtimeFiles));
  return { gitCommit, sourceSha256, runtimeSha256, executableSha256,
    sourceFiles, runtimeFiles, effectiveSha256: digest(JSON.stringify([sourceSha256, runtimeSha256, executableSha256])) };
}

async function dedicatedKey(signal: AbortSignal, supplied: string): Promise<string> {
  let value = supplied; supplied = '';
  if (!value) {
    requireCheck(process.stdin.isTTY && typeof process.stdin.setRawMode === 'function', 'DEDICATED_KEY_ENV_OR_TTY_REQUIRED');
    const input = process.stdin, wasRaw = Boolean(input.isRaw);
    process.stderr.write('专用测试 API Key（不回显，Enter 开始；Ctrl+C 退出）：');
    value = await new Promise<string>((resolveKey, reject) => {
      let key = '', finished = false;
      const finish = (error?: CheckError) => {
        if (finished) return; finished = true;
        input.removeListener('data', onData); signal.removeEventListener('abort', onAbort);
        input.setRawMode(wasRaw); input.pause(); process.stderr.write('\n');
        const result = key; key = ''; error ? reject(error) : resolveKey(result);
      };
      const onAbort = () => finish(new CheckError('INTERRUPTED'));
      const onData = (chunk: Buffer | string) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\u0003' || char === '\u001a') { finish(new CheckError('INTERRUPTED')); return; }
          if (char === '\r' || char === '\n') { finish(); return; }
          if (char === '\u007f' || char === '\b') key = key.slice(0, -1);
          else if (char >= ' ' && char <= '~') key += char;
          if (key.length > 4096) { finish(new CheckError('INVALID_DEDICATED_KEY')); return; }
        }
      };
      input.setRawMode(true); input.on('data', onData); signal.addEventListener('abort', onAbort, { once: true }); input.resume();
      if (signal.aborted) onAbort();
    });
  }
  requireCheck(value.length > 8 && value.length <= 4096 && !/\s/u.test(value), 'INVALID_DEDICATED_KEY');
  return value;
}

/** Redact across stream boundaries before any child output reaches disk. */
function redactor(secret: string, emit: (text: string) => void) {
  const decoder = new StringDecoder('utf8'); let pending = '', key = secret;
  const flush = (final = false) => {
    if (key) pending = pending.split(key).join('[REDACTED]');
    const length = final ? pending.length : Math.max(0, pending.length - key.length + 1);
    if (length) { emit(pending.slice(0, length)); pending = pending.slice(length); }
    if (final) key = '';
  };
  return { write(chunk: Buffer) { pending += decoder.write(chunk); flush(); }, end() { pending += decoder.end(); flush(true); } };
}

function assessReport(report: Record<string, any>, target: LiveProductTarget): string[] {
  const failed: string[] = [], check = (ok: unknown, code: string) => { if (!ok) failed.push(code); };
  const expected = target.expectedContactCategories, n = expected.length;
  const selected = Array.isArray(report.selected) ? report.selected : [];
  const ids = selected.map((item: any) => item.fieldId);
  const sameSet = (values: unknown) => Array.isArray(values) && values.length === n
    && values.every(value => typeof value === 'string') && new Set(values).size === n && ids.every((id: string) => values.includes(id));
  check(report.ok === true && report.status === 'production-ui-live-contact-fill-verified', 'CHILD_NOT_VERIFIED');
  check(report.caseId === target.id && report.applicationURL === target.url && report.finalURL === target.url && report.mode === 'live-fill', 'TARGET_OR_MODE_MISMATCH');
  check(report.realProviderApi === true && report.productionUI === true && report.productionWorker === true && report.sharedModelHelper === true
    && report.modelRequestCount === 1 && report.prepareCallCount === 1 && report.fillCallCount === 1
    && report.recognition?.mode === 'model' && report.recognition?.httpStatus === 200
    && count(report.recognition?.usage?.totalTokens) !== null && report.recognition.usage.totalTokens > 0, 'REAL_API_EVIDENCE_MISSING');
  check(report.model?.modelId === 'qwen-flash' && report.model?.endpointOrigin === 'https://dashscope.aliyuncs.com', 'MODEL_CONFIGURATION_CHANGED');
  check(selected.length === n && report.selectedCount === n && new Set(ids).size === n
    && expected.every(category => selected.filter((item: any) => contactCategory(String(item.label)) === category).length === 1), 'EXPECTED_SELECTION_INCOMPLETE');
  const planItems = Array.isArray(report.plan?.items) ? report.plan.items : [];
  for (const item of selected) {
    const plan = planItems.find((candidate: any) => candidate.fieldId === item.fieldId);
    const category = contactCategory(String(item.label));
    const key = item.profileKey as keyof typeof LIVE_CONTACT_VALUES;
    const allowedKey = category === 'name' ? key === 'fullName' || key === 'fullNameEn' : key === category;
    check(allowedKey && Object.hasOwn(LIVE_CONTACT_VALUES, key) && plan?.value === LIVE_CONTACT_VALUES[key]
      && plan?.status === 'ready' && plan?.currentValue === '', 'UNAPPROVED_CONTACT_PLAN');
    for (const [phase, fieldSource] of [['before', report.before], ['immediate', report.afterImmediate], ['settled', report.after]] as const) {
      const field = fieldSource?.fields?.find((value: any) => `field-${value.index}` === item.fieldId);
      check(field && ['text', 'email', 'tel'].includes(field.type)
        && field.value === (phase === 'before' ? '' : LIVE_CONTACT_VALUES[key]), `INDEPENDENT_${phase.toUpperCase()}_VALUE_MISMATCH`);
    }
  }
  check(sameSet(report.verified?.map((item: any) => item.fieldId)) && Array.isArray(report.unresolved) && report.unresolved.length === 0, 'PRODUCTION_VERIFICATION_INCOMPLETE');
  check(sameSet(report.independentValueChecks?.map((item: any) => item.fieldId))
    && report.independentValueChecks.every((item: any) => item.exactMatch === true && item.missingOrBlank === false && item.wrongNonemptyValue === false)
    && report.wrongNonemptyValueCount === 0 && report.settledValuesStable === true && report.settledRereadDelayMs >= 1000, 'INDEPENDENT_REREAD_INCOMPLETE');
  check(Array.isArray(report.expectedContactCoverage) && report.expectedContactCoverage.length === n
    && expected.every(category => report.expectedContactCoverage.filter((entry: any) => entry.category === category
      && entry.observedFieldIds?.length === 1 && entry.selectedFieldIds?.length === 1 && entry.independentlyExactFieldIds?.length === 1
      && entry.observedFieldIds[0] === entry.selectedFieldIds[0] && entry.selectedFieldIds[0] === entry.independentlyExactFieldIds[0]).length === 1), 'CONTACT_COVERAGE_INCOMPLETE');
  check(report.nonselectedUnchanged === true && report.consentAndAttachmentsUnchanged === true
    && report.nativeViewportStable === true && report.ui?.browserNoticeOutsideNativeArea === true
    && report.profileUnchanged === true && report.applicationsUnchanged === true && report.submitted === false && report.attachmentsUploaded === false, 'PROTECTED_STATE_NOT_VERIFIED');
  check(report.testValuesOnly === true && report.privateResumeOrDatabaseUsed === false && report.apiKeyPersisted === false
    && report.apiKeySentToRenderer === false && report.apiKeyEnvironmentRemoved === true && report.enterprisePageHasAppBridge === false
    && report.ui?.samePlan === true && report.ui?.filledAndVerified === true && report.ui?.needsUserVisible === true
    && report.ui?.noNode === true && report.ui?.keyFieldsEmpty === true, 'ISOLATION_NOT_VERIFIED');
  return [...new Set(failed)];
}

async function runChild(executable: string, packaged: boolean, caseDir: string, target: LiveProductTarget,
  apiKey: string, signal: AbortSignal, setStop: (stop?: () => void) => void) {
  const dataDir = join(caseDir, 'data'); await mkdir(dataDir, { mode: 0o700 });
  const before = new Set(await readdir(dataDir));
  const stdoutPath = join(caseDir, 'stdout.log'), stderrPath = join(caseDir, 'stderr.log');
  const stdout = await open(stdoutPath, 'wx', 0o600), stderr = await open(stderrPath, 'wx', 0o600);
  let tail = '', pendingWrites = Promise.resolve(), logFailed = false;
  const queue = (file: typeof stdout, text: string) => { pendingWrites = pendingWrites.then(async () => { await file.appendFile(text); }).catch(() => { logFailed = true; }); };
  const out = redactor(apiKey, text => { tail = (tail + text).slice(-65_536); queue(stdout, text); });
  const err = redactor(apiKey, text => queue(stderr, text));
  let timedOut = false, terminated = false, spawnError: string | null = null;
  let childExit: number | null = null, childSignal: NodeJS.Signals | null = null;
  try {
    const args = [...(packaged ? [] : [join(projectRoot, 'apps/desktop/main.cjs')]), '--live-product-check',
      `--live-case=${target.id}`, `--live-form-url=${target.url}`];
    const env: NodeJS.ProcessEnv = { ...process.env, OFFERAGENT_LIVE_FORM_API_KEY: apiKey, OFFERAGENT_TEST_DATA_DIR: dataDir };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    const child = spawn(executable, args, { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    delete env.OFFERAGENT_LIVE_FORM_API_KEY;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (terminated || child.exitCode !== null || child.signalCode !== null) return;
      terminated = true; child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, KILL_GRACE_MS);
    };
    setStop(stop); const timer = setTimeout(() => { timedOut = true; stop(); }, CHILD_TIMEOUT_MS);
    const abort = () => stop(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) stop();
    child.stdout.on('data', chunk => out.write(chunk)); child.stderr.on('data', chunk => err.write(chunk));
    child.on('error', error => { const code = (error as NodeJS.ErrnoException).code;
      spawnError = code && ['ENOENT', 'EACCES', 'ENOEXEC', 'EMFILE', 'ENOMEM'].includes(code) ? code : 'SPAWN_ERROR'; });
    await new Promise<void>(finish => child.once('close', (code, closedSignal) => { childExit = code; childSignal = closedSignal; finish(); }));
    clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', abort);
  } finally {
    setStop(); out.end(); err.end(); await pendingWrites; await stdout.close(); await stderr.close(); apiKey = '';
  }
  const newDirs = (await readdir(dataDir)).filter(name => !before.has(name) && /^live-product-[A-Za-z0-9]+$/u.test(name));
  const reports: string[] = [];
  for (const name of newDirs) {
    const path = join(dataDir, name, 'report.json');
    try { if (!(await lstat(join(dataDir, name))).isSymbolicLink() && (await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink()) reports.push(path); } catch { /* Missing remains unknown. */ }
  }
  let announced: string | null = null;
  for (const line of tail.trim().split(/\r?\n/u).reverse()) {
    try { const value = JSON.parse(line); if (object(value) && typeof value.report === 'string' && typeof value.ok === 'boolean') { announced = value.report; break; } } catch { /* Not a result line. */ }
  }
  const reportPath = reports.length === 1 && (!announced || resolve(announced) === reports[0]) ? reports[0]! : null;
  const failures: string[] = [];
  if (timedOut) failures.push('CHILD_TIMEOUT'); if (signal.aborted) failures.push('INTERRUPTED');
  if (spawnError) failures.push('CHILD_SPAWN_FAILED'); if (childExit !== 0 || childSignal) failures.push('CHILD_EXIT_NOT_CLEAN');
  if (logFailed) failures.push('LOG_WRITE_FAILED');
  let source: Record<string, any> | null = null, reportSha256: string | null = null;
  if (!reportPath) failures.push(reports.length > 1 ? 'AMBIGUOUS_REPORT' : 'MISSING_REPORT');
  else {
    try {
      requireCheck((await lstat(reportPath)).size <= 4_194_304, 'REPORT_TOO_LARGE');
      const raw = await readFile(reportPath); reportSha256 = digest(raw);
      const parsed: unknown = JSON.parse(raw.toString('utf8')); requireCheck(object(parsed), 'INVALID_REPORT'); source = parsed as Record<string, any>;
      failures.push(...assessReport(source, target));
    } catch (error) { failures.push(error instanceof CheckError ? error.code : 'UNREADABLE_REPORT'); }
  }
  return { ok: failures.length === 0, childExit, childSignal, timedOut, terminated, spawnError,
    sourceReport: reportPath ? { path: reportPath, sha256: reportSha256 } : null, reportFoundCount: reports.length,
    logs: { stdout: stdoutPath, stderr: stderrPath }, failureCodes: [...new Set(failures)],
    reportedOk: typeof source?.ok === 'boolean' ? source.ok : null,
    failurePhase: typeof source?.failurePhase === 'string' && /^[a-z-]{1,100}$/u.test(source.failurePhase) ? source.failurePhase : null,
    failureCode: typeof source?.failureCode === 'string' && /^[A-Z_0-9]{1,100}$/u.test(source.failureCode) ? source.failureCode : null,
    modelRequestCount: count(source?.modelRequestCount), httpStatus: count(source?.recognition?.httpStatus),
    usage: object(source?.recognition?.usage) ? Object.fromEntries(usageKeys.map(key => [key, count(source!.recognition.usage[key])])) : null,
    selectedCount: count(source?.selectedCount), verifiedCount: Array.isArray(source?.verified) ? source.verified.length : null,
    independentlyExactCount: Array.isArray(source?.independentValueChecks) ? source.independentValueChecks.filter((value: any) => value.exactMatch === true).length : null,
    expectedSupportedContactCount: target.expectedContactCategories.length };
}

async function main(): Promise<void> {
  let suite: Record<string, any> | undefined, reportPath: string | null = null,
    apiKey = process.env.OFFERAGENT_LIVE_FORM_API_KEY ?? '', activeStop: (() => void) | undefined;
  // Remove it before even the read-only Git provenance subprocess is started.
  delete process.env.OFFERAGENT_LIVE_FORM_API_KEY;
  let lastRound: number | null = null, lastCase: string | null = null;
  const abort = new AbortController(), interrupt = () => { abort.abort(); activeStop?.(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const persist = async () => {
    if (!suite || !reportPath) return;
    suite.missing = suite.planned.filter((item: any) => item.status !== 'completed').map((item: any) => ({ round: item.round, caseId: item.caseId, status: item.status }));
    const json = JSON.stringify(suite, null, 2), temporary = `${reportPath}.tmp`;
    await writeFile(temporary, apiKey ? json.split(apiKey).join('[REDACTED]') : json, { mode: 0o600 }); await rename(temporary, reportPath);
  };
  try {
    const options = argumentsForRun(process.argv.slice(2));
    if (options.help) { delete process.env.OFFERAGENT_LIVE_FORM_API_KEY;
      process.stdout.write('Usage: node --import tsx scripts/check-live-stability.ts [--rounds=1..3] [--output-dir=/absolute/empty-directory] [--executable=/absolute/Packaged.app/Contents/MacOS/OfferAgent]\nDefault: three development rounds, five fixed public pages per round; no retry, attachment or submission.\nDedicated OFFERAGENT_LIVE_FORM_API_KEY or an interactive no-echo TTY is required. No build is performed.\n'); return; }
    requireCheck(LIVE_PRODUCT_TARGETS.length === 5 && frozenCaseIds.every((id, index) => LIVE_PRODUCT_TARGETS[index]?.id === id), 'FIXED_FIVE_CASE_CATALOG_REQUIRED');
    let outputDir: string;
    if (options.outputDir) {
      outputDir = resolve(options.outputDir); await mkdir(outputDir, { recursive: true, mode: 0o700 });
      requireCheck(!(await lstat(outputDir)).isSymbolicLink() && (await readdir(outputDir)).length === 0, 'EMPTY_NONSYMLINK_OUTPUT_DIRECTORY_REQUIRED');
      outputDir = await realpath(outputDir);
    } else outputDir = await mkdtemp(join(tmpdir(), 'offeragent-live-stability-'));
    reportPath = join(outputDir, 'suite-report.json');
    suite = { schemaVersion: 1, startedAt: now(), completedAt: null, status: 'configuration',
      mode: options.executable ? 'packaged' : 'development', requestedRounds: options.rounds, maximumAttempts: options.rounds * 5,
      childTimeoutMs: CHILD_TIMEOUT_MS, killGraceMs: KILL_GRACE_MS, automaticRetries: false, stopOnFirstFailure: true,
      scope: 'ordinary supported applicant contact fields only; synthetic values; no attachment upload or application submission',
      excludedClaims: ['whole-form completion', 'split-name data', 'custom widget coverage', 'domestic recruitment login', 'application accepted', 'universal stability'],
      developmentGate: 'three consecutive complete five-page rounds on identical source and built code',
      releaseGateClaim: false, developmentGateSatisfied: false, packagedFivePageRoundPassed: false,
      consecutiveCompleteRounds: 0, completeRounds: [], attempts: [],
      planned: Array.from({ length: options.rounds }, (_, index) => LIVE_PRODUCT_TARGETS.map(target => ({
        round: index + 1, caseId: target.id, url: target.url, expectedContactCategories: [...target.expectedContactCategories], status: 'pending',
      }))).flat(), keyPersisted: false, ordinaryAppCredentialsRead: false };
    await persist();
    const packaged = Boolean(options.executable), executable = options.executable ?? createRequire(import.meta.url)('electron') as string;
    requireCheck(isAbsolute(executable), 'ABSOLUTE_EXECUTABLE_REQUIRED'); await access(executable, 1);
    const runtimeRoot = packaged ? resolve(dirname(executable), '../Resources/app') : projectRoot;
    if (packaged) {
      requireCheck(dirname(executable).endsWith(`${sep}Contents${sep}MacOS`), 'PACKAGED_MACHO_EXECUTABLE_REQUIRED');
      const handle = await open(executable, 'r'); const magic = Buffer.alloc(4);
      try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
      requireCheck(['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic.toString('hex')), 'PACKAGED_MACHO_EXECUTABLE_REQUIRED');
    }
    const initial = await baseline(executable, runtimeRoot); suite.baseline = { executable, runtimeRoot, ...initial };
    suite.catalogSha256 = digest(JSON.stringify(suite.planned.slice(0, 5).map(({ round, status, ...item }: any) => item)));
    await persist(); apiKey = await dedicatedKey(abort.signal, apiKey); suite.status = 'running'; await persist();
    for (let round = 1; round <= options.rounds; round++) {
      for (const target of LIVE_PRODUCT_TARGETS) {
        lastRound = round; lastCase = target.id;
        requireCheck(!abort.signal.aborted, 'INTERRUPTED');
        const before = await baseline(executable, runtimeRoot); requireCheck(before.effectiveSha256 === initial.effectiveSha256, 'SOURCE_OR_BUILD_CHANGED');
        const planned = suite.planned.find((item: any) => item.round === round && item.caseId === target.id);
        const caseDir = join(outputDir, `round-${round}-${target.id}`); await mkdir(caseDir, { mode: 0o700 });
        const attempt: Record<string, any> = { round, caseId: target.id, startedAt: now(), completedAt: null, sourceHashBefore: before.effectiveSha256, status: 'running' };
        planned.status = 'started'; suite.attempts.push(attempt); await persist();
        Object.assign(attempt, await runChild(executable, packaged, caseDir, target, apiKey, abort.signal, stop => { activeStop = stop; }));
        const after = await baseline(executable, runtimeRoot); attempt.sourceHashAfter = after.effectiveSha256;
        if (after.effectiveSha256 !== initial.effectiveSha256) { attempt.ok = false; attempt.failureCodes.push('SOURCE_OR_BUILD_CHANGED'); }
        attempt.completedAt = now(); attempt.status = attempt.ok ? 'passed' : 'failed'; planned.status = 'completed'; await persist();
        if (!attempt.ok) { suite.consecutiveCompleteRounds = 0; throw new CheckError(abort.signal.aborted ? 'INTERRUPTED' : 'CASE_FAILED'); }
      }
      suite.completeRounds.push({ round, completedAt: now(), cases: 5 }); suite.consecutiveCompleteRounds++; await persist();
    }
    suite.status = 'passed'; suite.developmentGateSatisfied = !packaged && suite.consecutiveCompleteRounds >= 3;
    suite.packagedFivePageRoundPassed = packaged && suite.consecutiveCompleteRounds >= 1; process.exitCode = 0;
  } catch (error) {
    if (suite) { suite.status = abort.signal.aborted ? 'interrupted' : suite.status === 'configuration' ? 'configuration-error' : 'failed';
      suite.failureCode = error instanceof CheckError ? error.code : 'RUNNER_ERROR'; suite.consecutiveCompleteRounds = 0; }
    process.exitCode = suite?.status === 'configuration-error' || !suite ? 2 : 1;
  } finally {
    delete process.env.OFFERAGENT_LIVE_FORM_API_KEY;
    if (suite) { suite.completedAt = now(); try { await persist(); } catch { process.exitCode = 1; suite.status = 'report-write-failed'; } }
    apiKey = ''; activeStop = undefined; process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (suite || process.exitCode) process.stdout.write(JSON.stringify({ status: suite?.status ?? 'configuration-error', report: reportPath,
      round: lastRound, caseId: lastCase, consecutiveCompleteRounds: suite?.consecutiveCompleteRounds ?? 0 }) + '\n');
  }
}

await main();
