/** Offline-only report generation. Independently implemented for OfferAgent. */
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { compareEvaluationReports, renderEvaluationHtml, summarizeEvaluationReport } from '../packages/agent/src/evaluation-report.js';

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    console.log('node --import tsx scripts/report-agent-evaluation.ts --input=report.json --output=report.html [--baseline=baseline.json]\n仅离线读取报告。旧或缺失报告会生成不完整证据页面；退出 2 表示不完整或不可直接比较。');
    return;
  }
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--(input|output|baseline)=(.+)$/.exec(arg);
    if (!match || flags.has(match[1]!)) throw new Error(`未知、重复或空参数：${arg}`);
    flags.set(match[1]!, match[2]!);
  }
  if (!flags.has('input') || !flags.has('output')) throw new Error('请提供 --input=report.json 与 --output=report.html。');
  const input = await realpath(resolve(flags.get('input')!));
  const baselineFile = flags.has('baseline') ? await realpath(resolve(flags.get('baseline')!)) : undefined;
  const output = resolve(flags.get('output')!);
  if (extname(output).toLowerCase() !== '.html') throw new Error('输出必须是 .html 报告，不能覆盖 JSON 输入。');
  let existingOutput: string | undefined;
  try { existingOutput = await realpath(output); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if ([input, baselineFile].includes(existingOutput ?? output)) throw new Error('报告输出不能覆盖输入或基准文件。');
  const summary = summarizeEvaluationReport(JSON.parse(await readFile(input, 'utf8')));
  const baseline = baselineFile ? summarizeEvaluationReport(JSON.parse(await readFile(baselineFile, 'utf8'))) : undefined;
  const comparison = baseline ? compareEvaluationReports(baseline, summary) : undefined;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderEvaluationHtml(summary, comparison, baseline), { mode: 0o600 });
  console.log(JSON.stringify({ output, complete: summary.complete, counts: summary.counts,
    toolContractPassRate: summary.toolContractPassRate, comparable: comparison?.comparable ?? null, modelQualityClaim: false }));
  if (!summary.complete || comparison && !comparison.comparable) process.exitCode = 2;
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : '报告生成失败。'); process.exitCode = 1; }
