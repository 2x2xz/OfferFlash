import { createHash } from 'node:crypto';
import { TelemetryStore } from '../../packages/telemetry/src/store.js';
import type { TelemetryBeginInput, TelemetryFinishInput, TelemetryReviewInput, TelemetryRun, TelemetryState, TelemetryStepName, TelemetryTokens } from '../../packages/telemetry/src/contracts.js';

/** Only the trusted host binds runs to a page/profile. No URL or profile value is recorded. */
export class TelemetryHost {
  private outcome: TelemetryFinishInput['status'] = 'completed';
  constructor(readonly store: TelemetryStore, private readonly context: () => Promise<{ url: string; version: number }>,
    private readonly publish: (state: TelemetryState) => void, private readonly fixture: boolean) {}
  state() { return this.store.state(); }
  private update() { try { this.publish(this.state()); } catch { /* A detached renderer cannot change the business operation. */ } }
  async begin(input: Omit<TelemetryBeginInput, 'scenarioKey' | 'source'> & { scenarioKey?: string }): Promise<TelemetryRun> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['mode', 'scenarioKey', 'expectedFields', 'cleanStartConfirmed'].includes(key))) throw new Error('无效计时参数。');
    const current = await this.context();
    const scenarioKey = `form:${createHash('sha256').update(`${current.url}\n${current.version}`).digest('hex').slice(0, 24)}`;
    if (input.scenarioKey !== undefined && input.scenarioKey !== scenarioKey) throw new Error('网页或资料版本与对照任务不同，请回到相同页面和资料后重新开始。');
    const active = this.state().runs.find(run => run.id === this.state().activeRunId);
    if (active && active.scenarioKey !== scenarioKey) throw new Error('请先结束上一页的计时。');
    const result = await this.store.begin({ ...input, scenarioKey, source: this.fixture ? 'fixture' : 'production' });
    this.outcome = 'completed'; this.update(); return result;
  }
  async finish(input: TelemetryFinishInput) {
    if (!input || typeof input.id !== 'string' || Object.keys(input).some(key => !['id', 'status'].includes(key))) throw new Error('无效计时结束参数。');
    const run = this.state().runs.find(item => item.id === input.id);
    const result = await this.store.finish({ ...input, status: run?.mode === 'agent' && input.status === 'completed' ? this.outcome : input.status });
    this.update(); return result;
  }
  async review(input: TelemetryReviewInput) {
    if (!input || Object.keys(input).some(key => !['id', 'expectedFields', 'verifiedFields', 'manualCorrections', 'interventions', 'cleanStartConfirmed'].includes(key))) throw new Error('无效复核参数。');
    const result = await this.store.review(input); this.update(); return result;
  }
  async step<T>(name: TelemetryStepName, fn: () => Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
    try { return await this.store.step(name, fn, attributes); }
    catch (error) { this.outcome = 'failed'; throw error; }
    finally { this.update(); }
  }
  cancel() { if (this.state().activeRunId) this.outcome = 'cancelled'; }
  async counts(verifiedFields: number, pendingFields: number, addedGroups = 0, stopped = false) {
    try { await this.store.addCounts({ verifiedFields, pendingFields, addedGroups }); } catch { /* Passive observer: never repeat a write. */ }
    if (stopped) this.outcome = 'cancelled';
    else if (pendingFields && this.outcome !== 'failed' && this.outcome !== 'cancelled') this.outcome = 'partial';
    this.update();
  }
  async modelCall(usage: TelemetryTokens | undefined, provider: string, modelId: string, fixture = false) {
    try { await this.store.modelCall(usage, { provider, modelId, fixture: fixture || this.fixture }); } catch { /* No model request is retried by an observer. */ } this.update();
  }
}
