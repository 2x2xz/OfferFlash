import type { TelemetryComparison, TelemetryRun } from './contracts.js';

/** Paired, user-reviewed observations; never estimates a missing manual baseline. */
export function compareTelemetryRuns(agent: TelemetryRun, manual: TelemetryRun): TelemetryComparison {
  const reject = (reason: string): TelemetryComparison => ({ comparable: false, reason });
  if (agent.mode !== 'agent' || manual.mode !== 'manual') return reject('需要一轮 Agent 和一轮人工记录。');
  if (agent.source !== 'production' || manual.source !== 'production') return reject('演示或测试记录不能用于实际效率比较。');
  if (agent.scenarioKey !== manual.scenarioKey) return reject('请选择同一个任务场景。');
  if (!agent.expectedFields || agent.expectedFields !== manual.expectedFields) return reject('两轮必须使用相同且大于零的目标字段数。');
  if (!agent.reviewed || !manual.reviewed) return reject('请先分别复核两轮结果。');
  if (!agent.cleanStartConfirmed || !manual.cleanStartConfirmed) return reject('请确认两轮从相同的空白起点开始。');
  if (agent.verifiedFields < agent.expectedFields || manual.verifiedFields < agent.expectedFields) return reject('两轮都核实全部目标字段后才能比较。');
  if (![agent, manual].every(run => ['completed', 'partial'].includes(run.status)
    && run.endedAt && run.reviewedAt && Number.isFinite(Date.parse(run.reviewedAt))
    && typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs >= 0
    && typeof run.totalDurationMs === 'number' && Number.isFinite(run.totalDurationMs) && run.totalDurationMs >= run.durationMs && run.totalDurationMs > 0)) {
    return reject('两轮都需要在本次运行中完成核对，并保留包含核对和修正的总耗时。');
  }
  return { comparable: true, reason: '同任务、相同目标字段且已人工复核的配对结果。',
    agentRunId: agent.id, manualRunId: manual.id, agentDurationMs: agent.totalDurationMs!, manualDurationMs: manual.totalDurationMs!,
    timeSavedPercent: (manual.totalDurationMs! - agent.totalDurationMs!) / manual.totalDurationMs! * 100 };
}
