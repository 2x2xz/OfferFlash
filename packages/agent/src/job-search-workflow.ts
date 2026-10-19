import { createJobSearchTask } from './job-search-intent.js';
import type { RuntimeWorkflowResult } from '../../runtime/src/runtime.js';

type Host = (name: string, args: unknown, signal?: AbortSignal) => Promise<any>;
/** A bounded business workflow. Pi remains the only model session/loop. */
export function jobSearchWorkflow(input: string, host: Host, options?:{modelMatching?:boolean}) {
  const task = createJobSearchTask(input);
  const explicitGoal=/(?:大模型|智能体|算法|强化学习|计算机视觉|目标检测|数据分析|数据工程|前端|后端|后台|全栈|工程师|开发|研究员|分析师|产品经理|设计师|\b(?:LLM|RAG|Agent|NLP|Java|Python|frontend|backend|engineer|researcher|data science)\b)/i.test(input)?input.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,300):undefined;
  const matchOnline=options?.modelMatching&&!/(?:不要|禁止|不用)(?:再)?联网|离线|\boffline\b|\bno network\b/i.test(input);
  if (!task) return undefined;
  return async ({ signal, progress }: { signal: AbortSignal; progress: (phase: string) => void }): Promise<RuntimeWorkflowResult> => {
    const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, task.deadlineMs);
    try {
      progress('profile');
      const profile = await host('get_profile_summary', {}, controller.signal);
      controller.signal.throwIfAborted();
      if (!profile || !Number.isInteger(profile.version) || profile.version < 1) throw new Error('请先保存求职资料。');
      progress(task.intent === 'fresh' ? task.region === 'overseas' ? 'search-overseas' : 'search-mainland' : 'search-library');
      const result = await host(task.intent === 'fresh' ? 'refresh_jobs' : 'query_jobs', task.intent === 'fresh'
        ? { sourceId: 'profile-discovery', region: task.region, maxPages: 2, pageSize: 20, detailLimit: 10 }
        : { limit: matchOnline?20:6 }, controller.signal);
      let jobs = Array.isArray(result?.jobs) ? result.jobs.filter((job: any) => job && !job.demo && job.match?.eligible !== 'unsuitable').slice(0, 6) : [];
      const fresh = task.intent === 'fresh', report = result?.discovery;
      const actualStatus = fresh ? report?.status ?? result?.sourceRun?.status : result?.coverage === 'local-snapshot' ? 'success' : 'failed';
      const failed = actualStatus === 'failed' || fresh && !(report?.sourcesAttempted > 0);
      const cancelled = signal.aborted || actualStatus === 'cancelled';
      const count = fresh ? result?.sourceRun?.count ?? jobs.length : result?.totalMatched ?? jobs.length;
      const scope = fresh ? task.region === 'overseas' ? '本轮按你明确要求查找海外官网来源' : '本轮国内官网查找' : matchOnline?'本轮检索岗位库，没有新增采集官网岗位':'本轮仅查询岗位库，没有联网';
      const status = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
      let heading = `${scope}：${cancelled ? '已停止，保留已核对部分' : failed ? '来源未完成，不能判断是否有合适岗位' : fresh ? `找到 ${count} 条候选${actualStatus === 'partial' ? '（仅完成部分范围）' : ''}` : `读取 ${count} 条已保存记录，展示 ${jobs.length} 条可核对候选`}。`;
      const details = fresh ? `实际访问 ${report?.sourcesAttempted ?? 0} 个来源；核对完整正文 ${report?.completeDetails ?? 0} 条。${report?.scopeNote ?? '仅已接入的公开官网入口，不代表全网。'}` : '结果来自已保存、导入或之前采集的岗位。';
      let matchingNote='',modelApplied=false;
      if(matchOnline&&status==='completed'){
        const pool=Array.isArray(result?.jobs)?result.jobs.filter((j:any)=>j&&!j.demo&&typeof j.id==='string'):[];
        if(count>0||pool.length){
          progress('match-profile');
          try{const matched=await host('match_profile_jobs',{expectedVersion:profile.version,region:task.region,includeCareerDetails:true,...(explicitGoal?{intent:explicitGoal}:{})},controller.signal);
            controller.signal.throwIfAborted();const displayed=Array.isArray(matched.jobs)?matched.jobs:pool;
            if(matched.status!=='completed'||matched.profileVersion!==profile.version||!Array.isArray(matched.ranking)||matched.ranking.some((id:unknown)=>!displayed.some((j:any)=>j.id===id)))throw Error('Invalid matching snapshot');
            jobs=matched.ranking.map((id:string)=>displayed.find((j:any)=>j.id===id));modelApplied=true;
            heading=`${scope}：从岗位库${matched.retrieval?.scannedCount??count}条记录中检索并重排，模型保留${jobs.length}条。`;matchingNote='模型已比较已确认经历与检索候选的岗位职责，明确硬条件冲突已排除；未知条件仍需核对。'+(matched.retrieval?.warning??'');
          }catch{controller.signal.throwIfAborted();matchingNote='本轮模型匹配未完成，下面仅保留规则候选，不是模型推荐。';}
        }
      }
      const rows = jobs.map((job: any, index: number) => `${index + 1}. ${job.company} · [${job.title}](${job.url}) · ${job.city || '城市待核对'}${job.match?.eligible === 'review' ? ' · 条件待核对' : ''}`);
      const summary = [heading, details, matchingNote, ...rows, jobs.length ? '可以在右侧点“加入待申请”或“去网申”，也可以告诉我“把第一个加入待申请”或“打开第二个网申”。本次未提交申请。' : modelApplied?'本轮没有筛出有足够依据的推荐，不凑数量；其它记录可在岗位库查看。':'没有得到可展示的完整候选；可查看来源报告了解失败或未覆盖范围。'].join('\n\n');
      progress(cancelled ? 'cancelled' : failed ? 'failed' : 'results');
      return { status, summary, context: JSON.stringify({ scope, status: actualStatus, profileVersion: profile.version,
        matchingNote,preferences: { roles: profile.targetRoles, cities: profile.cities }, evidence: report,
        jobs: jobs.map((job: any) => ({ id: job.id, company: job.company, title: job.title, city: job.city, url: job.url, type: job.type, match: job.match })) }) };
    } catch (error) {
      const cancelled = signal.aborted;
      const summary = cancelled ? '本轮查找已停止，未确认完成；已入库的部分可在来源报告中核对。'
        : controller.signal.aborted ? '本轮查找已到时间预算，未确认完整结果；不会在后台无限重试。请查看来源报告。'
          : '本轮岗位查找未完成。请核对已保存的求职资料或来源报告后再试；不会把本地旧岗位冒充新搜索结果。';
      progress(cancelled ? 'cancelled' : 'failed');
      return { status: cancelled ? 'cancelled' : 'failed', summary, context: JSON.stringify({ status: cancelled ? 'cancelled' : 'failed', summary }) };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  };
}
