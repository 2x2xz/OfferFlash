import type { JobInput, MatchResult, Profile } from "../../shared/src/contracts.js";
import { getConfirmedPrimaryEducation, withConfirmedEducation } from "../../profile/src/career-input.js";

function mentions(text: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return /^[a-z0-9+.# -]+$/i.test(term)
    ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text)
    : text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

const aliases: Record<string, string[]> = {
  "大模型": ["大模型", "大型语言模型", "large language model", "LLM"],
  "算法": ["算法", "algorithm", "machine learning"],
  "ai": ["AI", "人工智能", "artificial intelligence"],
  "llm": ["LLM", "大模型", "大型语言模型", "large language model"],
  "强化学习": ["强化学习", "reinforcement learning", "RL"],
  "rag": ["RAG", "检索增强", "retrieval augmented"],
};

function matched(text: string, terms: string[]): string[] {
  return terms.filter(term => (aliases[term.toLocaleLowerCase()] ?? [term]).some(alias => mentions(text, alias)));
}

function degreeLevel(degree: string): number {
  if (/博士|ph\.?d|doctor/i.test(degree)) return 4;
  if (/硕士|master/i.test(degree)) return 3;
  if (/本科|学士|bachelor/i.test(degree)) return 2;
  if (/专科|大专|associate/i.test(degree)) return 1;
  return 0;
}

function singleRequiredDegree(text: string): number {
  if (/博士(?:研究生)?(?:学历|学位|(?:及|或)?以上)|(?:要求|需|须|学历[：:]?)[^\n。；]{0,10}博士|ph\.?d\.?\s+(?:required|degree)|doctoral\s+degree/i.test(text)) return 4;
  if (/硕士(?:研究生)?(?:学历|学位|(?:及|或)?以上)|(?:要求|需|须|学历[：:]?)[^\n。；]{0,10}硕士|master['’]?s?\s+(?:degree|or above|required)/i.test(text)) return 3;
  if (/本科(?:学历|学位|(?:及|或)?以上)|bachelor['’]?s?\s+(?:degree|or above|required)/i.test(text)) return 2;
  return 0;
}

const degreeMention = /本科|学士|硕士|博士|\b(?:ph\.?d\.?|doctorate|doctoral|master['’]?s?|bachelor['’]?s?)\b/i;
const nonMandatoryDegree = /优先|加分|可选|非必[须需]|不(?:强制)?要求|不需要|不必|无需|无须|不是必[须需]|学历不限|学位不限|\b(?:preferred|preferable|optional|desirable)\b|\ba plus\b|\bnot\s+(?:required|mandatory|necessary|essential)\b|\b(?:do(?:es)? not|don't|doesn't)\s+require\b|\bno\s+(?:(?:master['’]?s?|bachelor['’]?s?|ph\.?d\.?)\s+)?degree\s+(?:is\s+)?required\b/i;

function degreeLevels(text: string): number[] {
  const tokens = text.match(/本科|学士|硕士|博士|\b(?:ph\.?d\.?|doctorate|doctoral|master['’]?s?|bachelor['’]?s?)\b/gi) ?? [];
  return [...new Set(tokens.map(degreeLevel))];
}

/** A page can contain team biographies as well as qualifications. Only select explicit requirement clauses. */
function descriptionDegreeRequirements(description: string): string {
  const selected: string[] = [];
  let requirementSection = false;
  const requirementHeading = /任职要求|岗位要求|招聘要求|职位要求|任职资格|申请条件|基本条件|学历要求|学位要求|\b(?:qualifications|requirements)\b/i;
  const otherHeading = /^\s*(?:岗位职责|工作职责|工作内容|公司介绍|团队介绍|关于我们|福利待遇|responsibilities|about (?:us|the team)|benefits)\s*(?:[:：]|$)/i;
  for (const line of description.split(/\n/)) {
    for (const clause of line.split(/[。；;]/).map(value => value.trim()).filter(Boolean)) {
      if (otherHeading.test(clause)) requirementSection = false;
      if (requirementHeading.test(clause)) requirementSection = true;
      if (degreeMention.test(clause) && (requirementSection || /学历\s*[:：]|学位\s*[:：]|要求|需要|需具备|须具备|必须|\b(?:required|requires?|must|minimum)\b/i.test(clause))) selected.push(clause);
    }
  }
  return selected.join("；");
}

function degreeRequirement(text: string): { minimum: number; review: boolean; evidence: string } {
  const allClauses: string[] = [];
  for (const clause of text.split(/[\n。；;，,]|但是|不过|但|\b(?:but|and)\b/i).map(value => value.trim()).filter(Boolean)) {
    // A trailing standalone modifier still qualifies the preceding credential: "Master's degree, preferred".
    if (/^(?:优先(?:考虑)?|加分|可选|preferred|optional|not required)[.)）\s]*$/i.test(clause) && allClauses.length > 0) allClauses[allClauses.length - 1] += ` ${clause}`;
    else allClauses.push(clause);
  }
  // A rejection of lower degrees is not an alternative admission route.
  const admissionClauses=allClauses.filter(clause=>! /^(?:不接受|不接收|不允许|不认可|排除|不支持|不得以|不得用|cannot substitute|do not accept)/i.test(clause));
  const degreeClauses = admissionClauses.filter(clause => degreeMention.test(clause));
  const evidence = degreeClauses.join("；").slice(0, 240);
  const result = (minimum: number, review = false) => ({ minimum, review, evidence });
  // A relaxation may be in the next clause. A mixed mandatory/preferred clause needs review rather than a highest-degree gate.
  if (degreeClauses.length > 0 && (/也可|可考虑|放宽|视情况|不[作做]硬性|同等(?:研究|科研|工作)?能力|equivalent experience|equivalent qualifications|may be waived|exceptions? apply/i.test(text) ||
      degreeClauses.some(clause => nonMandatoryDegree.test(clause) && degreeLevels(clause).length > 1) && !degreeClauses.some(clause=>!nonMandatoryDegree.test(clause)&&singleRequiredDegree(clause)>0))) return result(0, true);
  const clauses = admissionClauses.filter(clause => !nonMandatoryDegree.test(clause));
  const mandatory = clauses.join("；");
  const alternatives = [...mandatory.matchAll(
    /((?:本科|学士|硕士|博士)(?:研究生|高年级|大[一二三四五])?(?:学历|学位)?(?:\s*(?:或者|或是|或|\/|、|以及|和|与|及)\s*(?:优秀)?(?:本科|学士|硕士|博士)(?:研究生)?(?:学历|学位)?)+)/g,
  )];
  const levels = degreeLevels(mandatory);
  if (alternatives.length === 1) {
    const span = alternatives[0]![1]!;
    const listed = span.match(/本科|学士|硕士|博士/g) ?? [];
    const outside = mandatory.replace(span, "");
    // A separate degree clause can describe a different track; don't collapse it into one hard gate.
    if (degreeMention.test(outside)) return result(0, true);
    return result(Math.min(...listed.map(degreeLevel)));
  }
  if (levels.length > 1 || alternatives.length > 1) return result(0, true);
  const bare=clauses.find(clause=>/^\s*(?:[0-9]+[.、)）]\s*)?(?:本科|学士|硕士|博士)(?:研究生)?(?:\s*(?:在读|在校|毕业|及以上|或以上|学历|学位)|\s*$)/.test(clause));
  const contextual=clauses.find(clause=>/(?:专业|方向|获得|持有|具备|面向|招聘)[^。；]{0,16}(?:本科|学士|硕士|博士)/.test(clause)&&!/(?:团队成员|同事|导师|领导|合作伙伴)/.test(clause));
  return result(singleRequiredDegree(mandatory)|| (bare?degreeLevel(bare):contextual&&levels.length===1?levels[0]!:0));
}

function graduationRequirement(text: string): { years: string[]; review: boolean } {
  // Short years are normalized only when explicitly suffixed with 届. Never infer them from arbitrary numbers.
  const cohort = /(?<!\d)((?:20\d{2}|[2-4]\d)(?:\s*届)?(?:\s*(?:[/、,，—-]|或者|或|和|及|至|到|[~～])\s*(?:20\d{2}|[2-4]\d)(?:\s*届)?)*)\s*届/g;
  let review = /届(?:毕业生)?\s*(?:优先|为佳)|优先(?:考虑|接收)?[^。；\n]{0,12}(?:20\d{2}|[2-4]\d)届|不限届|届数不限|毕业年份不限|非\s*(?:20\d{2}|[2-4]\d)\s*届|除[^\n。；]{0,25}届|其他届[^。；\n]{0,12}(?:也可|可投)/.test(text);
  const years = new Set<string>();
  for(const match of text.matchAll(cohort)){
    if(/第\s*$/.test(text.slice(Math.max(0,match.index!-3),match.index)))continue;
    const span=match[1]!,listed=(span.match(/20\d{2}|(?<!\d)[2-4]\d(?!\d)/g)??[]).map(v=>v.length===2?'20'+v:v);
    if(/[-—~～至到]/.test(span)){
      const first=Number(listed[0]),last=Number(listed[1]);
      if(listed.length!==2||last<first||last-first>10){review=true;continue;}
      for(let year=first;year<=last;year++)years.add(String(year));
    }else for(const year of listed)years.add(year);
  }
  return {years:[...years],review};
}

function graduationWindows(text: string): { windows: Array<{ start: string; end: string }>; review: boolean } {
  const windows: Array<{ start: string; end: string }> = [];
  let review = false;
  const ranges = text.matchAll(
    /(20\d{2})\s*(?:年|[./-])\s*(\d{1,2})\s*月?(?:\s*(?:\d{1,2}\s*日|[./-]\d{1,2}(?=\s*[-—~～至到])))?\s*[-—~～至到]\s*(20\d{2})\s*(?:年|[./-])\s*(\d{1,2})\s*月?(?:\s*(?:\d{1,2}\s*日|[./-]\d{1,2}(?=\D|$)))?/g,
  );
  for (const range of ranges) {
    const before = text.slice(Math.max(0, range.index - 30), range.index);
    const after = text.slice(range.index + range[0].length, range.index + range[0].length + 30);
    const otherPeriod = /(?:截止(?:日期|时间|期间)?|申请(?:日期|时间|期间)|投递(?:日期|时间|期间)|工作(?:周期|时间|期间)|实习(?:周期|时间|期间)|项目(?:周期|时间)|到岗(?:日期|时间)|入职(?:日期|时间)|deadline)\s*[:：为是在（(]*$/i.test(before);
    const graduationContext = /毕业(?:时间|日期|范围|区间|窗口|于)?\s*(?:必须|需要|须)?\s*[:：为是在于介（(]*$/.test(before) ||
      /^\s*[）)]?\s*(?:期间|之间|范围内|内)?\s*毕业/.test(after);
    if (otherPeriod || !graduationContext) continue;
    const startMonth = Number(range[2]), endMonth = Number(range[4]);
    const start = `${range[1]}-${String(startMonth).padStart(2, "0")}`;
    const end = `${range[3]}-${String(endMonth).padStart(2, "0")}`;
    if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12 || start > end ||
        /不接受|不接收|排除|除外|非\s*$/.test(before) || /^\s*(?:期间|之间|内)?\s*毕业[^。；\n]{0,8}优先/.test(after)) {
      review = true;
      continue;
    }
    windows.push({ start, end });
  }
  // Explicit inclusive one-sided graduation bounds, never an application/work deadline.
  for(const bound of text.matchAll(/毕业(?:时间|日期)?\s*[:：]?\s*(?:于|在|为)?\s*(20\d{2})\s*(?:年|[./-])\s*(\d{1,2})\s*月?\s*(及以后|及之后|及以上|及以前|及之前|以后|之后|以前|之前)/g)){
    const month=Number(bound[2]),value=`${bound[1]}-${String(month).padStart(2,'0')}`;
    if(month<1||month>12){review=true;continue;}
    const inclusive=bound[3]!.startsWith('及'),before=/前/.test(bound[3]!);const date=new Date(Date.UTC(Number(bound[1]),month-1+(inclusive?0:before?-1:1),1));const adjusted=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
    if(before)windows.push({start:'0000-01',end:inclusive?value:adjusted});else windows.push({start:inclusive?value:adjusted,end:'9999-12'});
  }
  for(const yearly of text.matchAll(/(?<!\d)(20\d{2})\s*年\s*(及以后|及之后|及以上|及以前|及之前)?\s*毕业/g)){
    const year=yearly[1]!,direction=yearly[2];
    windows.push(direction?/前/.test(direction)?{start:'0000-01',end:year+'-12'}:{start:year+'-01',end:'9999-12'}:{start:year+'-01',end:year+'-12'});
  }
  // An explicitly described graduation range with unsupported notation is uncertainty, not a cohort-only gate.
  if (windows.length === 0 && (
    /毕业(?:时间|日期|范围|区间|窗口)[^。；\n]{0,80}20\d{2}[^。；\n]{0,40}[-—~～至到][^。；\n]{0,40}20\d{2}/.test(text) ||
    /20\d{2}[^。；\n]{0,40}[-—~～至到][^。；\n]{0,40}20\d{2}[^。；\n]{0,25}(?:期间|之间)?毕业/.test(text)
  )) review = true;
  return { windows, review };
}

function dateInShanghai(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface EducationConstraint {status:'pass'|'violation'|'unknown';message:string;evidence:string;}
/** Source-grounded degree/cohort check shared with matchJob; unknown is never an affirmative pass. */
export function assessEducationEligibility(original:Profile,job:JobInput,now=new Date()):{degree:EducationConstraint;graduation:EducationConstraint}{
  const profile=withConfirmedEducation(original),q=degreeRequirement(job.requirements.trim()||descriptionDegreeRequirements(job.description)),evidence=q.evidence,suffix=evidence?`（原文：${evidence}）`:'';
  const degree:EducationConstraint={status:'unknown',message:'',evidence};
  if(q.review)degree.message=`学历要求包含多条或有条件的说明，需要人工确认，未作为硬性排除条件${suffix}`;
  else if(q.minimum>0){const actual=degreeLevel(profile.degree);degree.status=actual===0?'unknown':actual<q.minimum?'violation':'pass';degree.message=actual===0?`岗位有明确学历要求，你的学历需确认${suffix}`:actual<q.minimum?`已填写学历低于岗位明确要求${suffix}`:`已填写学历满足岗位明确要求${suffix}`;}
  const requirementCohort=graduationRequirement(job.requirements),fullText=`${job.title}\n${job.description}\n${job.requirements}`;
  // Explicit requirements override headings; a campus label is a fallback, not a second contradictory cohort.
  const cohort=requirementCohort.years.length||requirementCohort.review?requirementCohort:graduationRequirement(fullText),window=graduationWindows(fullText),month=/^\d{4}-\d{2}$/.test(profile.graduationMonth)?profile.graduationMonth:'',year=month.slice(0,4)||getConfirmedPrimaryEducation(profile)?.endDate.slice(0,4)||'';
  const graduation:EducationConstraint={status:'unknown',message:'',evidence:job.requirements.slice(0,500)};
  if(window.review)graduation.message='毕业年月范围包含例外或无法完整解析，需要人工确认，未作为硬性排除条件';
  else if(window.windows.length){const fits=window.windows.some(w=>month>=w.start&&month<=w.end);graduation.status=!month?'unknown':fits?'pass':'violation';graduation.message=!month?'岗位明确限定毕业年月范围，你的毕业时间需确认':fits?'已填写毕业年月符合岗位明确毕业窗口；未仅按届数标签排除':`岗位要求 ${window.windows.map(w=>`${w.start} 至 ${w.end}`).join(' 或 ')} 期间毕业，你的毕业月份不在明确范围内`;}
  else if(cohort.review)graduation.message='毕业届数包含优先、例外或难以解析的范围，需要人工确认，未作为硬性排除条件';
  else if(cohort.years.length){const fits=cohort.years.includes(year);graduation.status=!year?'unknown':fits?'pass':'violation';graduation.message=!year?'岗位明确限定毕业届数，你的毕业时间需确认':fits?'已填写毕业年份符合岗位明确届数':`岗位面向 ${cohort.years.join('/')} 届，与你的毕业年份不一致`;}
  else if(job.type==='campus')graduation.message='岗位未明确毕业届数，需要在官网核对校招资格';
  const inSchool=job.requirements.split(/[。；;，,\n]/).some(c=>/在读|在校生/.test(c)&&! /不要求|无需|优先|可选/.test(c));
  const currentMonth=dateInShanghai(now).slice(0,7);
  if(inSchool&&month&&month<currentMonth){graduation.status='violation';graduation.message='岗位明确要求在读/在校，已确认毕业月份已过，不能当作仍在读';}
  else if(inSchool&&graduation.status==='unknown'&&!graduation.message){const ed=getConfirmedPrimaryEducation(profile);if(ed?.startDate&&ed.startDate<=currentMonth&&month>currentMonth){graduation.status='pass';graduation.message='已确认教育起止月份覆盖当前时间，符合明确在读条件';}else graduation.message='岗位要求在读/在校，当前学籍状态需确认';}
  return{degree,graduation};
}

/** Deterministic ranking rules, not an offer probability or an LLM judgment. */
export function isJobDeadlineExpired(deadline: string | null, now = new Date()): boolean {
  return !!deadline && (deadline.includes("T") ? Date.parse(deadline) < now.getTime() : deadline < dateInShanghai(now));
}

export function matchJob(profile: Profile, job: JobInput, now = new Date()): MatchResult {
  profile = withConfirmedEducation(profile);
  const reasons: string[] = [], concerns: string[] = [];
  let score = 0, unsuitable = false;
  const text = `${job.title}\n${job.description}\n${job.requirements}`;

  if(profile.acceptedRecruitmentTypes?.length&&job.type!=='unknown'&&!profile.acceptedRecruitmentTypes.includes(job.type)){
    unsuitable=true;concerns.push('岗位招聘类型不符合你明确保存的校招/实习/社招偏好');
  }
  if (job.type === "experienced" && !profile.acceptedRecruitmentTypes?.includes('experienced')) {
    concerns.push("来源标记为社招，不符合当前校招筛选方向");
    unsuitable = true;
  } else if (job.type === "campus") {
    score += 20;
    reasons.push("来源明确标记为校园招聘");
  } else if (job.type === "internship") {
    concerns.push("这是实习岗位，是否满足秋招目标需要确认");
    score += 10;
  } else {
    concerns.push("招聘类型未明确，需要确认是否接收应届生");
  }

  if (profile.version === 0) concerns.push("个人资料尚未保存确认，无法判断你的完整条件");
  if (profile.cities.length > 0) {
    const cities = profile.cities.filter(city => job.city.includes(city));
    if (cities.length > 0) { score += 25; reasons.push(`意向城市匹配：${cities.join("、")}`); }
    else if (!job.city || /待定|待确认|未提供|未注明|未知|全国|多地|不限|等\s*(?:\d+|多|若干)\s*个?\s*(?:城市|地点|地区)/.test(job.city)) concerns.push("岗位城市需进一步确认");
    else { unsuitable = true; concerns.push(`岗位城市 ${job.city} 不在你的意向城市中`); }
  }

  const roles = matched(text, profile.targetRoles);
  if (roles.length > 0) { score += 30; reasons.push(`方向关键词匹配：${roles.join("、")}`); }
  else if (profile.targetRoles.length > 0) concerns.push("未找到你的目标方向关键词，请人工核对岗位职责");
  const skills = matched(text, profile.skills);
  if (skills.length > 0) {
    score += Math.round(25 * skills.length / profile.skills.length);
    reasons.push(`已确认技能命中：${skills.join("、")}`);
  } else if (profile.skills.length === 0) concerns.push("尚未填写技能，技能匹配未计分");
  else concerns.push("岗位文本未命中已填写技能，不代表你没有相关能力");

  const education=assessEducationEligibility(profile,job,now);
  for(const dimension of [education.degree,education.graduation]){
    if(dimension.status==='violation')unsuitable=true;
    if(dimension.message)(dimension.status==='pass'?reasons:concerns).push(dimension.message);
  }

  if (job.deadline) {
    const expired = isJobDeadlineExpired(job.deadline, now);
    if (expired) { unsuitable = true; concerns.push("岗位截止日期已过，需核实是否仍接受申请"); }
  } else concerns.push("来源未提供截止日期");
  if (job.publishedAt === null) concerns.push("来源未提供发布日期，采集时间不等于发布时间");
  if (job.demo) concerns.push("虚构演示岗位，不代表真实招聘机会");

  return {
    score: unsuitable ? Math.min(score, 20) : Math.min(score, 100), reasons, concerns,
    eligible: unsuitable ? "unsuitable" : concerns.length > 0 ? "review" : "likely",
    profileVersion: profile.version,
  };
}
