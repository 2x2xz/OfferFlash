import type { SourceCollectionReport, SourceRun } from '../../../packages/shared/src/contracts.js';
import { Badge } from './components.js';
import { dateLabel } from './helpers.js';

const stopLabels: Record<SourceCollectionReport['stopReason'], string> = {
  exhausted: '来源表示列表已读完',
  'empty-page': '下一页没有返回岗位',
  'repeated-page': '下一页重复，已停止',
  'no-new-items': '未发现新条目，已停止',
  'page-limit': '已达到本次页数上限',
  'request-failed': '请求未完成',
  'invalid-response': '返回内容无法核实',
  aborted: '本次采集已停止',
  'pagination-unavailable': '没有找到可核实的下一页入口',
  'scope-changed': '页面离开本次采集范围',
  'current-page': '仅采集当前已加载页面',
};
const modeLabels: Record<SourceCollectionReport['scope']['mode'], string> = {
  'official-api-pages': '官方接口列表',
  'browser-list-pages': '官网列表翻页',
  'visible-page': '当前网页',
};

export function collectionRunMessage(run: SourceRun): string {
  return run.status === 'failed' ? `本次采集失败：${run.error ?? '请查看采集报告'}`
    : run.status === 'partial' ? `已保存 ${run.count} 条，采集范围或详情尚未完整`
    : run.report ? `已保存 ${run.count} 条岗位，本次范围已完成` : `已保存 ${run.count} 条岗位`;
}

export function CollectionReport({ run, compact = false }: { run: SourceRun; compact?: boolean }) {
  const report = run.report;
  const status = run.status === 'success' ? report ? '本次范围完成' : '采集成功（旧记录）' : run.status === 'partial' ? '部分完成' : '采集失败';
  return <section className={`collection-report ${compact ? 'collection-report-compact' : ''}`} data-source-run-id={run.id} data-collection-status={run.status} aria-label="采集范围报告">
    <div className="collection-report-heading"><strong>采集报告</strong><Badge tone={run.status === 'success' ? 'green' : run.status === 'partial' ? 'amber' : 'red'}>{status}</Badge></div>
    <div className="collection-report-time">{dateLabel(run.observedAt, true)} · 保存 {run.count} 条</div>
    {report ? <>
      <p className="collection-report-scope">{modeLabels[report.scope.mode]} · {report.scope.description}</p>
      <div className="collection-report-counts">
        <span>列表 {report.pagesSucceeded}/{report.pagesRequested} 页</span>
        <span>列出 {report.listedCount} 条</span>
        <span>详情 {report.detailSucceeded}/{report.detailRequested} 条</span>
        {report.detailFailed > 0 && <span>详情待处理 {report.detailFailed} 条</span>}
        {report.newCount !== undefined && <span>首次发现 {report.newCount} 条</span>}
        {report.updatedCount !== undefined && <span>内容更新 {report.updatedCount} 条</span>}
      </div>
      <p className="collection-report-stop">停止原因：{stopLabels[report.stopReason]}</p>
      <details className="collection-report-details"><summary>查看本次范围与问题</summary><dl>
        <div><dt>列表入口</dt><dd>{report.scope.listURL}</dd></div>
        <div><dt>{report.scope.mode === 'official-api-pages' ? '查询筛选词' : '输入词记录'}</dt><dd>{report.query.keyword || '未指定'}{report.scope.mode !== 'official-api-pages' && '（实际范围以官网页面已设置的筛选为准）'}</dd></div>
        <div><dt>本次上限</dt><dd>{report.query.maxPages} 页 · {report.query.detailLimit} 条详情{report.query.pageSize !== null ? ` · 每页 ${report.query.pageSize} 条` : ''}</dd></div>
        <div><dt>来源总数</dt><dd>{report.officialTotal === null ? '来源未提供' : `${report.officialTotal} 条（本次列表响应）`}</dd></div>
      </dl>{report.detailResults && report.detailResults.length > 0 && <div className="collection-detail-results"><strong>逐条详情结果</strong><ul>{report.detailResults.map((item, index) => <li key={`${item.jobURL}-${index}`}><Badge tone={item.status === 'success' ? 'green' : 'amber'}>{item.status === 'success' ? '详情已读取' : '详情待处理'}</Badge><span>{item.jobURL}</span></li>)}</ul></div>}{report.errors.length > 0 ? <ul>{report.errors.map((item, index) => <li key={`${item.stage}-${item.pageIndex ?? item.jobId ?? index}-${index}`}>{item.stage === 'list' ? `列表${item.pageIndex !== undefined ? `第 ${item.pageIndex} 页` : ''}` : '岗位详情'}：{item.message}</li>)}</ul> : <p>本次范围没有记录到请求错误。</p>}</details>
      <p className="collection-report-note">首次发现是本地第一次收录；官网发布日期单独保留。本次报告只覆盖上述入口与页数。</p>
    </> : <p className="collection-report-note">这是旧版采集记录，没有列表页数与详情范围报告。{run.error ? ` ${run.error}` : ''}</p>}
  </section>;
}
