import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Briefcase, CalendarDays, Check, Crosshair, FileCheck2, Flag, MessageSquare, Trophy } from 'lucide-react';
import { buildApplicationAgenda } from '../../../packages/domain/src/agenda.js';
import { deriveApplyFlow } from '../../../packages/ui/src/apply-flow.js';
import { summarizeMissionProgress } from '../../../packages/ui/src/mission-progress.js';
import { Button, Badge } from './components.js';
import { useWorkspace } from './context.js';
import { MissionSprite } from './PixelArt.js';
import { MissionWeeklyCard } from './MissionProgress.js';

export function MissionHome() {
  const { state, navigate, openApplication, openBrowser } = useWorkspace();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer); }, []);
  const flow = deriveApplyFlow(state, now);
  const agenda = buildApplicationAgenda(state, { days: 7, includeUndated: true, limit: 3 }, now);
  const applications = state.applications.filter(item => !item.demo);
  const progress = summarizeMissionProgress(state.applications, now);
  const stats = [
    { label: '已记录投递', english: 'APPLICATIONS', value: progress.totalRecorded, icon: Flag, tone: 'accent', note: '累计首次投递记录' },
    { label: '面试进行中', english: 'INTERVIEWS', value: applications.filter(item => item.status === 'interview').length, icon: MessageSquare, tone: 'cyan', note: '当前面试阶段' },
    { label: '收到的 Offer', english: 'OFFERS', value: applications.filter(item => item.status === 'offer').length, icon: Trophy, tone: 'amber', note: '你的阶段性成果' },
    { label: '近期申请事项', english: 'NEXT ACTIONS', value: agenda.total, icon: CalendarDays, tone: 'muted', note: '含待确认及等待企业' },
  ];
  return <div className="page mission-home" data-testid="mission-home">
    <section className="mission-hero"><div className="mission-hero-copy"><div className="mission-kicker"><span />CAREER OPERATING SYSTEM <span className="mission-kicker-index">/ 01</span></div><h2>让每一步，<br />都离 <em>Offer</em> 更近。</h2><p>从发现机会到记录投递，把你的下一步变得清晰。<br />现在，开始一场属于你的职业探索。</p><div className="mission-hero-actions"><Button onClick={() => navigate('apply')}>开始新的申请<ArrowUpRight size={16} /></Button><Button variant="ghost" onClick={() => navigate('applications')}>查看申请进度<ArrowRight size={15} /></Button></div><div className="mission-hero-foot"><span>LOCAL FIRST</span><span>资料在本机 · 每一步由你掌控</span></div></div><MissionSprite /></section>
    <div className="mission-stats">{stats.map(item => <section className={`mission-stat tone-${item.tone}`} key={item.english}><div className="mission-stat-top"><span>{item.english}</span><item.icon size={17} /></div><strong>{String(item.value).padStart(2, '0')}</strong><div className="mission-stat-bottom"><h3>{item.label}</h3><span>{item.note}</span></div></section>)}</div>
    <div className="mission-grid"><section className="card quest-card" data-dashboard-section="agenda" data-agenda-total={agenda.total}><div className="mission-section-heading"><div><span className="pixel-label">MISSION QUEUE</span><h2>下一步，做什么</h2></div><button type="button" className="text-link" onClick={() => navigate('applications')}>全部事项<ArrowUpRight size={14} /></button></div>
      {agenda.items.length ? <div className="quest-list">{agenda.items.map((item, index) => <button type="button" className="quest-row" key={item.id} data-application-id={item.id} data-waiting-on={item.waitingOn} data-urgency={item.urgency} onClick={() => { const record = state.applications.find(record => record.id === item.id); if (record) openApplication(record); }}><span className="quest-number">0{index + 1}</span><div className="quest-copy"><strong>{item.company} · {item.title}</strong><span>{item.nextStep}</span></div><div className="quest-state"><Badge tone={item.waitingOn === 'user' ? 'green' : 'muted'}>{item.waitingOn === 'user' ? '由你处理' : '等待企业'}</Badge><small>{item.date ?? '日期待确认'}</small></div><ArrowUpRight size={15} /></button>)}</div> : <div className="mission-empty-queue"><div className="quest-empty-icon"><Crosshair size={25} /></div><h3>下一个机会，等你出发</h3><p>保存心仪岗位、确认资料，申请事项会在这里汇总。</p><Button variant="secondary" onClick={() => navigate(flow.profileReady ? 'apply' : 'profile')}>{flow.profileReady ? '挑选推荐岗位' : '完善申请资料'}<ArrowRight size={14} /></Button></div>}
      <div className="mission-section-foot"><span>{agenda.today} — {agenda.rangeEnd}</span><span>上海日期 · {agenda.total} 项</span></div></section>
      <MissionWeeklyCard state={state} />
    </div>
    <section className="card mission-opportunities" data-dashboard-section="recommended"><div className="mission-section-heading"><div><span className="pixel-label">NEXT OPPORTUNITIES</span><h2>岗位库精选</h2></div><button type="button" className="text-link" onClick={() => navigate('apply')}>去找新岗位<ArrowUpRight size={14} /></button></div>
      {flow.recommended.length ? <div className="mission-job-list">{flow.recommended.slice(0, 3).map(job => <button type="button" className="mission-job-row" key={job.id} data-job-id={job.id} data-match-eligibility={job.match.eligible} onClick={() => void openBrowser(job.url)}><span className="mission-company-avatar">{job.company.slice(0, 1)}</span><div><strong>{job.title}</strong><span>{job.company} · {job.city || '城市待确认'}</span></div><Badge tone={job.match.eligible === 'likely' ? 'green' : 'amber'}>{job.match.eligible === 'likely' ? '条件较匹配' : '有条件待核对'}</Badge><ArrowUpRight size={16} /></button>)}</div> : <div className="mission-empty-opportunities"><Briefcase size={20} /><span>{flow.profileReady ? '当前岗位库暂无匹配候选，去发现新的机会。' : '确认简历资料后，在这里查看符合已知条件的岗位。'}</span><Button variant="ghost" onClick={() => navigate(flow.profileReady ? 'apply' : 'profile')}>{flow.profileReady ? '发现岗位' : '查看资料'}<ArrowRight size={14} /></Button></div>}
    </section>
    <footer className="mission-page-footer"><span><FileCheck2 size={12} />以保存的申请记录为准，企业接收情况请核对官网。</span><span>BUILT FOR YOUR NEXT CHAPTER <Check size={12} /></span></footer>
  </div>;
}
