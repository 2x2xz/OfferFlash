import type {JobMatchingState} from '../../../packages/shared/src/job-matching.js';
import {cachedJobMatching,rememberJobMatching,currentJobMatching,modelMatchedJobs} from '../../../packages/ui/src/job-matching.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowRight, CheckCircle2, FileText, Globe, MapPin, Settings2, Sparkles, Upload } from 'lucide-react';
import { deriveApplyFlow } from '../../../packages/ui/src/apply-flow.js';
import { captureApplyListBrowse, restoreApplyListBrowse, restoredApplyListScroll, type ApplyListBrowseState } from '../../../packages/ui/src/apply-list.js';
import { Badge, Button, EmptyState } from './components.js';
import { useWorkspace } from './context.js';
import { dateLabel, recruitmentLabels, statusLabels } from './helpers.js';
import { cachedDiscoveryCandidateIds, DiscoveryPanel } from './DiscoveryPanel.js';

export function ApplyFlow({ browseMemory }: { browseMemory: RefObject<ApplyListBrowseState | undefined> }) {
  const { api, setState, state, model, navigate, startResumeImport, openBrowser, openModel, agentBusy, notify } = useWorkspace();
  const [matching,setMatching]=useState<JobMatchingState|undefined>(()=>cachedJobMatching(api));
  const modelJobs=modelMatchedJobs(state,matching),activeMatching=currentJobMatching(state,matching);
  const matchingBusy=matching?.status==='running';
  const [matchIntent,setMatchIntent]=useState('');
  useEffect(()=>{let alive=true,eventSeen=false;const accept=(value:JobMatchingState)=>{if(alive){rememberJobMatching(api,value);setMatching(value);}};
    const off=api.onEvent(event=>{if(event.type==='job-matching'){eventSeen=true;accept(event.state);}});
    void api.jobMatchingState?.().then(value=>{if(!eventSeen)accept(value);}).catch(()=>{});return()=>{alive=false;off();};},[api]);
  async function requestMatching(jobIds?:string[]){
    if(model.mode!=='live'||!model.configured){openModel();return;}
    if(!api.matchSavedJobs)return;
    try{const result=await api.matchSavedJobs({expectedVersion:state.profile.version,includeCareerDetails:true,...(jobIds?{jobIds}:{}),...(matchIntent.trim()?{intent:matchIntent.trim()}:{} )});rememberJobMatching(api,result);setMatching(result);}
    catch(error){notify(error instanceof Error?error.message:'本轮匹配未完成，请稍后再试。',true);}
  }
  const [now, setNow] = useState(() => new Date());
  const [currentCandidateIds, setCurrentCandidateIds] = useState<string[]>(() => cachedDiscoveryCandidateIds(api, state.jobs));
  const rememberCandidates = useCallback((ids: string[]) => setCurrentCandidateIds(previous =>
    JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids), []);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer); }, []);
  const flow = deriveApplyFlow(state, now);
  const featured = modelJobs??flow.recommended.filter(job => !currentCandidateIds.includes(job.id)).slice(0, 6);
  const jobIds = featured.map(job => job.id);
  const listKey = JSON.stringify(jobIds);
  const [browse, setBrowse] = useState(() => restoreApplyListBrowse(browseMemory.current, jobIds));
  // A changed recommendation list must be reconciled before displaying or restoring it.
  if (JSON.stringify(browse.jobIds) !== listKey) setBrowse(restoreApplyListBrowse(browseMemory.current, jobIds));
  const browseRef = useRef(browse); browseRef.current = browse;
  const pageRef = useRef<HTMLDivElement>(null);
  const limit = Math.min(6, browse.visibleCount);
  useLayoutEffect(() => {
    const page = pageRef.current; const root = page?.closest<HTMLElement>('.page-scroll');
    if (!page || !root) return;
    const anchor = browse.anchor && [...page.querySelectorAll<HTMLElement>('[data-apply-job-id]')].find(card => card.dataset.applyJobId === browse.anchor!.jobId);
    root.scrollTop = restoredApplyListScroll(browse, root.scrollTop, anchor ? anchor.getBoundingClientRect().top - root.getBoundingClientRect().top : undefined);
    browseMemory.current = { ...browse, scrollTop: root.scrollTop };
    // The bounded library preview retains its scroll position and surviving job anchor.
  }, [listKey, browseMemory]);
  useLayoutEffect(() => {
    const page = pageRef.current; const root = page?.closest<HTMLElement>('.page-scroll');
    if (!page || !root) return;
    const remember = () => {
      const rootTop = root.getBoundingClientRect().top;
      const cards = [...page.querySelectorAll<HTMLElement>('[data-apply-job-id]')].map(card => {
        const rect = card.getBoundingClientRect(); return { jobId: card.dataset.applyJobId!, top: rect.top - rootTop, bottom: rect.bottom - rootTop };
      });
      browseMemory.current = captureApplyListBrowse(browseRef.current, root.scrollTop, cards);
    };
    remember(); root.addEventListener('scroll', remember, { passive: true });
    return () => { remember(); root.removeEventListener('scroll', remember); };
  }, [browseMemory]);
  const online = model.mode === 'live' && model.configured;
  return <div ref={pageRef} className={`page apply-start ${flow.profileReady ? 'resume-ready' : ''}`} data-testid="apply-start">
    <div className="apply-heading"><span className="apply-eyebrow">找新岗位 → 打开网申 → 自动填写</span><h2>{flow.profileReady ? '找新岗位，继续你的申请' : '先准备简历，再找新岗位'}</h2>{!flow.profileReady && <p>上传并确认简历，用你的经历查找公开招聘岗位，进入网申后自动填写。</p>}</div>
    <DiscoveryPanel api={api} jobs={state.jobs} applications={state.applications} onTrack={async job => { setState(await api.trackJob(job.id)); }} onApply={job => void openBrowser(job.url)} onViewLibrary={() => navigate('jobs')} onCandidatesChange={rememberCandidates} onOpenSource={url => void openBrowser(url)} onComplete={async result => { setState(await api.getState()); if(online&&result.jobs.length)await requestMatching([...new Set(result.report.sources.flatMap(source=>source.jobIds))]); }} hideCandidates={modelJobs!==undefined} disabled={agentBusy||matchingBusy} />
    <ol className="apply-steps" aria-label="申请步骤"><li className={flow.profileReady ? 'complete' : 'active'}><span>{flow.profileReady ? <CheckCircle2 size={17} /> : '1'}</span><div><strong>确认简历</strong><small>{flow.profileReady ? '沿用你已保存的资料' : '上传一次，核对资料'}</small></div></li><li className={flow.profileReady ? 'active' : ''}><span>2</span><div><strong>查找公开岗位</strong><small>也可从岗位库继续申请</small></div></li><li><span>3</span><div><strong>自动填写</strong><small>点击浏览器顶部按钮</small></div></li></ol>
    <section className="card apply-resume-card"><span className="apply-card-icon"><FileText size={23} /></span><div className="grow"><h3>{flow.hasSavedProfile ? `${state.profile.fullName || '你的'}简历资料已保存${flow.profileReady ? '，可查找新机会' : ''}` : '先把简历交给 OfferFlash'}</h3><p>{flow.hasSavedProfile ? [state.profile.school, state.profile.degree, state.profile.major, state.profile.graduationMonth && `${state.profile.graduationMonth} 毕业`].filter(Boolean).join(' · ') || '已保存的基础资料将用于岗位匹配和表单填写。' : '支持 PDF、DOCX、TXT 和 Markdown。导入后核对候选内容，再用于匹配与填写。'}</p>{flow.pendingCount > 0 && <p className="apply-review-note">{flow.pendingCount} 条经历待确认{flow.awaitingAllConfirmation ? '，请先到资料页逐条核对并选择默认教育。' : '；不影响查看推荐，未确认内容不会自动填写。'}</p>}</div><div className="apply-card-actions"><Button variant={flow.profileReady ? 'secondary' : 'primary'} data-testid="resume-upload" onClick={startResumeImport}><Upload size={15} />{flow.hasSavedProfile ? '更新简历' : '上传简历'}</Button>{flow.hasSavedProfile && <Button variant="ghost" onClick={() => navigate('profile')}>{flow.profileReady ? '查看资料' : '查看 / 核对资料'}</Button>}</div></section>
    <div className={`apply-model-strip ${online ? 'configured' : ''}`}><Sparkles size={16} /><div className="grow"><strong>{online ? `自动填写模型：${model.modelId}` : '已适配的网申可直接自动填写'}</strong><span>{online ? '进入申请表后，点击浏览器顶部“自动填写”。' : '已适配页面无需 Key；其他页面可选配模型识别。'}</span></div><Button variant="secondary" className="button-small" onClick={openModel}><Settings2 size={14} />{online ? '模型设置' : '模型设置（可选）'}</Button></div>
    <section className="apply-recommendations" aria-label="岗位库精选" data-testid="library-featured" data-library-total={flow.libraryCount} data-featured-limit="6"><label className="small" style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>想找什么岗位<input aria-label="想找的岗位方向" placeholder={state.profile.targetRoles.join('、')||'例如：大模型应用、Agent开发、算法实习'} value={matchIntent} onChange={event=>setMatchIntent(event.target.value)} maxLength={300} disabled={matchingBusy||agentBusy} style={{flex:1}} /></label><div className="apply-section-heading"><div><h3>{modelJobs!==undefined?'按简历匹配的岗位':'从岗位库继续申请'}</h3><p>{activeMatching?.status==='completed'?activeMatching.message:`以下来自已保存的岗位库，并非本轮新搜索 · 精选最多 6 条 · 库内共 ${flow.libraryCount} 条`}</p>{activeMatching?.status==='completed'&&<p className="small muted">{activeMatching.modelId} · 本轮 {activeMatching.requests} 次模型请求 · {activeMatching.usage?.totalTokens??'未知'} token{activeMatching.retrieval&&(activeMatching.retrieval.warning?' · 语义请求未完成，用量未知':` · 检索 ${activeMatching.retrieval.scannedCount} 条 · 向量 ${activeMatching.retrieval.embeddingRequests} 次请求 / ${activeMatching.retrieval.embeddingInputTokens} token`)}</p>}<p className="small muted">岗位匹配当前使用百炼北京qwen-flash，读取已确认的技能及经历说明，不读取联系方式字段或简历原文件；先检索整个岗位库，再将最相关的20条交给模型重排；不将岗位分数当作录用概率。</p>{matching&&matching.status!=='completed'&&<p role="status">{matching.message}</p>}</div>{matchingBusy?<Button variant="secondary" className="button-small" onClick={()=>void api.cancelJobMatching?.()}>停止匹配</Button>:typeof api.matchSavedJobs==='function'&&<Button variant="secondary" className="button-small" data-testid="match-profile-jobs" disabled={agentBusy||!flow.profileReady||!flow.libraryCount} onClick={()=>void requestMatching()}><Sparkles size={13}/>按简历匹配</Button>}<Button variant="ghost" className="button-small" onClick={() => navigate('jobs')}>查看岗位库<ArrowRight size={13} /></Button></div>
      {!flow.profileReady ? <div className="card"><EmptyState icon={<FileText size={24} />} title={flow.awaitingAllConfirmation ? '先核对导入的经历，再给你推荐' : '保存简历后，推荐会出现在这里'} description={flow.awaitingAllConfirmation ? '到资料页保存草稿，逐条确认经历，并明确选择默认教育。不会把未确认内容当成你的真实条件。' : '无需先使用聊天。上传、核对并保存资料后，系统会自动匹配当前岗位库。'} action={<Button onClick={flow.awaitingAllConfirmation ? () => navigate('profile') : startResumeImport}>{flow.awaitingAllConfirmation ? '继续核对简历' : '上传简历'}</Button>} /></div> : featured.length ? <div className="job-grid apply-job-grid">{featured.slice(0, limit).map(job => {
        const tracked = state.applications.find(item => item.jobId === job.id);
        return <article className="card apply-job-card" data-testid={`recommended-job-${job.id}`} data-apply-job-id={job.id} key={job.id}><div className="apply-job-heading"><div className="grow"><h4>{job.title}</h4><p>{job.company}</p></div><Badge tone={job.match.eligible === 'likely' ? 'green' : 'amber'}>{job.match.eligible === 'likely' ? '条件较匹配' : '部分条件待核对'}</Badge></div><div className="job-tags"><span className="job-location small muted"><MapPin size={12} />{job.city || '城市待确认'}</span><Badge>{recruitmentLabels[job.type]}</Badge>{tracked && <Badge>{statusLabels[tracked.status]}</Badge>}</div><div className="apply-job-reasons">{activeMatching?.proofs?.[job.id]&&<><p><CheckCircle2 size={12}/>经历依据：{activeMatching.proofs[job.id]!.cvQuote}</p><p><CheckCircle2 size={12}/>岗位职责：{activeMatching.proofs[job.id]!.jobQuote}</p></>}{job.match.reasons.slice(0, 3).map(reason => <p key={reason}><CheckCircle2 size={12} />{reason}</p>)}{!job.match.reasons.length && <p>现有条件不足，请先核对官网职责和要求。</p>}</div>{job.match.concerns.length > 0 && <details className="apply-job-concerns"><summary>需要核对 {job.match.concerns.length} 项</summary>{job.match.concerns.map(item => <p key={item}>{item}</p>)}</details>}<div className="apply-job-bottom"><small>{job.sourceName || '已保存来源'}{job.deadline ? ` · 截止 ${dateLabel(job.deadline)}` : ' · 截止日期待确认'}</small><Button disabled={!job.url.trim()} onClick={() => void openBrowser(job.url)}>去网申<ArrowRight size={14} /></Button></div>{!job.url.trim() && <p className="apply-review-note">该记录未提供官网链接，请在“岗位库”中补充。</p>}</article>;
      })}</div> : <div className="card"><EmptyState compact icon={<Globe size={20} />} title={modelJobs!==undefined?'本轮没有筛出可推荐岗位':flow.recommended.length ? '本轮候选已在上方列出' : flow.libraryCount ? '岗位库暂时没有可精选的岗位' : '还没有保存岗位'} description={modelJobs!==undefined?'不会为了凑数推荐。可以补充确认资料，或在岗位库查看其它候选。':flow.recommended.length ? '其余已保存记录可在岗位库查看和管理。' : flow.libraryCount ? '精选按已知条件和日期筛选；你保存的全部条目仍可在岗位库中查看。' : '从上方查找新岗位，或到岗位库管理手动录入的机会。'} action={<Button variant="secondary" onClick={() => navigate('jobs')}>查看岗位库</Button>} /></div>}
    </section><p className="apply-bottom-note">进入企业网站后由你登录。点击自动填写仅填写已确认资料、保留网页已有值；最后的提交按钮由你点击。</p>
  </div>;
}
