import type {UniversalResult} from '../../../packages/browser/src/universal-form.js';

/** Compact display of host-reported counts; does not infer completion or change evidence. */
export function UniversalFillResult({result}:{result:UniversalResult}) {
 const interrupted=!!result.failureCode||result.status==='failed';
 const title=interrupted?'填写已中断':result.status==='cancelled'?'填写已停止':result.status==='completed'?'本轮核对完成':'还有待处理项';
 return <section className="universal-result" data-testid="universal-fill-result" data-status={interrupted?'interrupted':result.status} aria-label="本轮填写结果">
  <header><strong role="status">{title}</strong><span>未提交</span></header>
  <dl className="universal-result-counts"><div><dt>新增核实</dt><dd>{result.verified}</dd></div>{result.alreadyCorrect!==undefined&&<div><dt>原本正确</dt><dd>{result.alreadyCorrect}</dd></div>}<div><dt>待处理</dt><dd>{result.pending}</dd></div></dl>
  {!!result.pendingReview&&<p className="universal-result-review">草稿待核对：{result.pendingReview} 项</p>}
  {!!result.missingRecords&&<p className="universal-result-review">还缺 {result.missingRecords} 段经历</p>}
  <details><summary>查看详情{result.pending?` · 待处理 ${result.pending} 项`:''}</summary>
   {!!result.remaining?.length&&<ul className="universal-result-remaining">{result.remaining.map((item,index)=><li key={index}><strong>{[item.section,item.label].filter(Boolean).join(' · ')}</strong><span>{item.reason}</span></li>)}</ul>}
   {result.performance&&<p className="universal-result-timing">本轮 {(result.performance.totalMs/1000).toFixed(1)} 秒 · 其中模型等待 {(result.performance.modelWaitMs/1000).toFixed(1)} 秒</p>}
   <p className="universal-result-report">{result.message}</p>
  </details>
 </section>;
}
