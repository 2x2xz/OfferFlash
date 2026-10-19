import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { PageCollectionOptions, SourceCollectionOptions, SourceCollectionReport } from './contracts.js';

const exact = { additionalProperties: false } as const;
const count = Type.Integer({ minimum: 0, maximum: 1_000_000 });
export const sourceCollectionStatusSchema = Type.Union(['success', 'partial', 'failed'].map(value => Type.Literal(value)));
export const sourceCollectionOptionsSchema = Type.Object({
  maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  detailLimit: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })),
}, exact);
export const pageCollectionOptionsSchema = Type.Object({
  ...sourceCollectionOptionsSchema.properties,
  scope: Type.Optional(Type.Union([Type.Literal('current-page'), Type.Literal('bounded-list')])),
}, exact);
export const sourceCollectionReportSchema = Type.Object({
  schemaVersion: Type.Literal(1), status: sourceCollectionStatusSchema,
  query: Type.Object({ keyword: Type.String({ maxLength: 200 }), pageSize: Type.Union([Type.Integer({ minimum: 1, maximum: 50 }), Type.Null()]), maxPages: Type.Integer({ minimum: 1, maximum: 10 }), detailLimit: Type.Integer({ minimum: 0, maximum: 50 }) }, exact),
  scope: Type.Object({ mode: Type.Union(['official-api-pages', 'browser-list-pages', 'visible-page'].map(value => Type.Literal(value))), listURL: Type.String({ minLength: 1, maxLength: 4096 }), description: Type.String({ maxLength: 5000 }) }, exact),
  pagesRequested: Type.Integer({ minimum: 0, maximum: 10 }), pagesSucceeded: Type.Integer({ minimum: 0, maximum: 10 }), officialTotal: Type.Union([count, Type.Null()]),
  listedCount: count, detailRequested: Type.Integer({ minimum: 0, maximum: 50 }), detailSucceeded: Type.Integer({ minimum: 0, maximum: 50 }), detailFailed: Type.Integer({ minimum: 0, maximum: 50 }),
  stopReason: Type.Union(['exhausted', 'empty-page', 'repeated-page', 'no-new-items', 'page-limit', 'request-failed', 'invalid-response', 'aborted', 'pagination-unavailable', 'scope-changed', 'current-page'].map(value => Type.Literal(value))),
  errors: Type.Array(Type.Object({ stage: Type.Union([Type.Literal('list'), Type.Literal('detail')]), pageIndex: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })), jobId: Type.Optional(Type.String({ maxLength: 160 })), code: Type.String({ minLength: 1, maxLength: 100 }), message: Type.String({ maxLength: 5000 }) }, exact), { maxItems: 100 }),
  detailResults: Type.Optional(Type.Array(Type.Object({ jobURL: Type.String({ minLength: 1, maxLength: 4096 }), status: Type.Union([Type.Literal('success'), Type.Literal('failed')]) }, exact), { maxItems: 50 })),
  newCount: Type.Optional(count), updatedCount: Type.Optional(count),
}, exact);

export function collectionOptions(value: unknown, page = false): SourceCollectionOptions | PageCollectionOptions {
  const input = value ?? {};
  if (!Value.Check(page ? pageCollectionOptionsSchema : sourceCollectionOptionsSchema, input)) throw new TypeError('采集参数只能包含最多1–10页、每页1–50条、详情0–50条和明确的当前页/列表范围。');
  return structuredClone(input) as PageCollectionOptions;
}

export function validateCollectionReport(value: unknown): SourceCollectionReport {
  if (!Value.Check(sourceCollectionReportSchema, value)) throw new TypeError('采集报告缺少范围、数量、状态或包含非法字段。');
  const report = structuredClone(value) as SourceCollectionReport;
  const url = new URL(report.scope.listURL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('采集范围必须是普通网页地址。');
  if (report.pagesSucceeded > report.pagesRequested || report.pagesRequested > report.query.maxPages || report.detailRequested > report.query.detailLimit || report.detailSucceeded + report.detailFailed !== report.detailRequested) throw new TypeError('采集报告的尝试、成功或预算数量不一致。');
  if ((report.newCount ?? 0) + (report.updatedCount ?? 0) > report.listedCount) throw new TypeError('首次发现与更新数量超过取得的岗位数。');
  if (report.detailResults) {
    if (report.detailResults.length !== report.detailRequested || report.detailResults.filter(item => item.status === 'success').length !== report.detailSucceeded || new Set(report.detailResults.map(item => item.jobURL)).size !== report.detailResults.length) throw new TypeError('逐条详情结果与计数不一致。');
    for (const item of report.detailResults) { const target = new URL(item.jobURL); if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || target.origin !== url.origin) throw new TypeError('详情结果不属于本次来源。'); }
  }
  if (report.status === 'success' && (report.errors.length || !['exhausted', 'empty-page', 'current-page'].includes(report.stopReason))) throw new TypeError('未完成或有错误的采集不能声明成功。');
  if (report.status === 'failed' && (report.listedCount || !report.errors.length)) throw new TypeError('采集失败必须保留原因，已取得岗位应报告部分完成。');
  return report;
}
