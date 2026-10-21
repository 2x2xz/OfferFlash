import type { Profile } from '../../shared/src/contracts.js';
import {withConfirmedEducation} from '../../profile/src/career-input.js';
import {conditionalNameReview} from './field-review.js';
import {confirmedPersonalProfile} from '../../profile/src/personal-input.js';

export interface ApplicationFact {ref:string;record:string;kind:string;label:string;value:string;sourceRecordId?:string;sourceRevision?:number;}
/** Confirmed host facts. Only the separate professional projection exposes
 * ordinary career values; private identity/contact values remain host-only. */
export function applicationFacts(profile:Profile):ApplicationFact[]{
  const facts:ApplicationFact[]=[];const base=withConfirmedEducation(profile);
  const add=(record:string,kind:string,label:string,value:unknown,sourceRecordId?:string,sourceRevision?:number)=>{if(typeof value==='string'&&value.trim())facts.push({ref:'fact-'+facts.length,record,kind,label,value:value.trim(),...(sourceRecordId?{sourceRecordId}:{}),...(sourceRevision?{sourceRevision}:{})});};
  for(const [key,label] of Object.entries({fullName:'完整姓名',fullNameEn:'英文全名',email:'本人邮箱',phone:'本人手机'}))add('contact',key,label,(base as any)[key]);
  add('contact','birthDate','本人已明确保存的完整出生日期',profile.birthDate);
  add('personal','skills','已确认掌握的技能',profile.skills.join('、'));
  const career=profile.career;
  const keys:Record<string,Record<string,string>>={education:{school:'学校',schoolEn:'英文学校',college:'学院 / 院系',major:'专业',majorEn:'英文专业',degree:'学历',majorCategory:'已确认专业类别',schoolCategory:'已确认学校类别',studyMode:'已确认学习形式',startDate:'开始年月',endDate:'结束年月',description:'教育描述'},
    internship:{organization:'单位名称',role:'职位名称',startDate:'开始年月',endDate:'结束年月',description:'实习内容'},
    project:{name:'项目名称',role:'项目角色',startDate:'开始年月',endDate:'结束年月',description:'项目描述',url:'项目链接'},
    publication:{title:'论文标题',authors:'作者',venue:'期刊会议',publicationDate:'发表日期',doi:'DOI',url:'论文链接'}};
  if(career){for(const [type,records] of [['education',career.educations],['internship',career.internships],['project',career.projects],['publication',career.publications]] as const){
    const confirmed=records.filter(r=>r.confirmation==='confirmed'&&r.confirmedRevision===r.revision&&!!r.confirmedAt);
    const ordered=type==='education'?[...confirmed].sort((a,b)=>Number(b.id===career.primaryEducationId)-Number(a.id===career.primaryEducationId)):confirmed;
    ordered.forEach((record,i)=>{for(const [key,label]of Object.entries(keys[type]!))add(type+'-'+(i+1),key,label,(record as any)[key],record.id,record.revision);
      if('technologies' in record)add(type+'-'+(i+1),'technologies','该经历实际使用的技术与工具',record.technologies.join('、'),record.id,record.revision);
      if((type==='internship'&&(record as any).current===true||type==='project'&&(record as any).ongoing===true)&&!(record as any).endDate)add(type+'-'+(i+1),'endDate','结束时间至今','至今',record.id);});
  }
   const confirmed=career.educations.filter(r=>r.confirmation==='confirmed'&&r.confirmedRevision===r.revision&&!!r.confirmedAt),primary=confirmed.find(r=>r.id===career.primaryEducationId);
   const rank=(s:string)=>optionMatchesFact(s,'博士')?3:optionMatchesFact(s,'硕士')?2:optionMatchesFact(s,'本科')?1:0;
   const ranked=confirmed.length>0&&confirmed.every(record=>rank(record.degree)>0),highest=ranked?Math.max(...confirmed.map(record=>rank(record.degree))):0;
   const highestRecords=confirmed.filter(record=>highest>0&&rank(record.degree)===highest);
   // Highest qualification follows the confirmed records, even when no default
   // education is selected. A graduation date still needs one explicit source.
   if(highestRecords.length)add('summary','degree','已确认最高学历',highestRecords[0]!.degree);
   const graduation=primary??(highestRecords.length===1?highestRecords[0]:undefined);
   if(graduation)add('summary','endDate','已确认毕业年月',graduation.endDate,graduation.id,graduation.revision);
  }else for(const [key,label]of Object.entries(keys.education!))add('education-1',key,label,(base as any)[key]);
  const personal=confirmedPersonalProfile(profile);
  if(personal){
    const languageKeys={language:'语种',examName:'语言考试名称',score:'语言考试成绩',certificateName:'语言证书',selfAssessment:'本人自评掌握程度',listeningSpeaking:'本人明确提供的听说水平',readingWriting:'本人明确提供的读写水平'};
    personal.languages.forEach((item,index)=>{for(const [key,label]of Object.entries(languageKeys))add('language-'+(index+1),key,label,(item as any)[key],item.id,personal.revision);});
    personal.software.forEach((item,index)=>{for(const [key,label]of Object.entries({name:'软件 / 工具名称',proficiency:'本人明确提供的软件水平',description:'软件实际使用说明'}))add('software-'+(index+1),key==='name'?'softwareName':key,label,(item as any)[key],item.id,personal.revision);});
    personal.awards.forEach((item,index)=>{for(const [key,label]of Object.entries({name:'真实荣誉名称',issuer:'颁发机构',date:'获奖日期',description:'荣誉说明'}))add('award-'+(index+1),key==='name'?'awardName':key,label,(item as any)[key],item.id,personal.revision);});
    add('personal','selfEvaluation','本人确认的自我评价原文',personal.selfEvaluation,'personal',personal.revision);
    add('personal','languagesSummary','已确认语言能力汇总',personal.languages.map(item=>[item.language,item.examName,item.score,item.certificateName,item.selfAssessment&&'掌握程度：'+item.selfAssessment].filter(Boolean).join('；')).join('\n'),'personal',personal.revision);
    add('personal','softwareSummary','已确认软件与工具汇总',personal.software.map(item=>[item.name,item.proficiency,item.description].filter(Boolean).join('；')).join('\n'),'personal',personal.revision);
    add('personal','awardsSummary','已确认真实荣誉汇总',personal.awards.map(item=>[item.name,item.issuer,item.date,item.description].filter(Boolean).join('；')).join('\n'),'personal',personal.revision);
  }
  return facts;
}
const unsafe=/密码|验证码|身份证|护照|薪资|薪酬|国籍|签证|紧急联系|推荐码|内推码|邀请码|referral.?code|invitation.?code|推荐人|证明人|父亲|母亲|配偶|直属领导|现任上司|声明|协议|同意|password|captcha|passport|salary|citizenship|visa|emergency|referee|reference|supervisor|manager.?name|name.{0,20}manager|consent|agreement/i;
const domains:Record<string,RegExp>={fullName:/姓名|完整名字|\bfull.?name\b|^name$/i,fullNameEn:/英文.*名|english.*name/i,email:/邮箱|邮件|e.?mail/i,phone:/手机|电话|phone|mobile|telephone/i,
  school:/学校|院校|university|school|college|institution/i,schoolEn:/英文.*学校|school.*english/i,college:/学院|院系|faculty|department|school.of|college.of/i,major:/专业|major|field.of.study/i,majorEn:/英文.*专业|major.*english/i,degree:/学历|学位|degree|qualification/i,
  organization:/单位名称|公司名称|实习单位|employer|company|organization/i,role:/^项目职责$|职位|职务|角色|position|role|job.title/i,
  name:/项目名称|project.name|project.title/i,description:/描述|内容|职责|description|responsibilit/i,
  startDate:/开始|起始|start|from/i,endDate:/结束|终止|截止|end|until|^to$/i,
  majorCategory:/专业(?:大)?类|专业类型|专业类别|学科门类|major.*categor|subject.*(?:categor|family)|discipline.*categor/i,schoolCategory:/学校类别|学校类型|院校类型|school.*(?:categor|type)|institution.*type/i,studyMode:/学习形式|学习方式|study.*mode|attendance.*type/i,
  language:/语种|语言类型|语言名称|^language(?:\s*\/|$)|language.name/i,examName:/考试名称|语言考试|exam(?:ination)?.*name|test.name/i,score:/考试成绩|考试分数|雅思成绩|托福成绩|(?:exam|test).*score/i,certificateName:/证书名称|语言证书|certificate.name/i,selfAssessment:/掌握程度|熟练程度|语言水平|proficiency|fluency|overall.level/i,listeningSpeaking:/听说|listening.*speaking/i,readingWriting:/读写|reading.*writing/i,
  softwareName:/软件名称|工具名称|software.name|tool.name/i,proficiency:/掌握程度|熟练程度|proficiency|fluency|level/i,awardName:/荣誉名称|奖项名称|奖学金名称|award.name|honou?r.name/i,issuer:/颁发|授予|issuer|awarding/i,date:/获奖日期|获奖时间|award.date/i,
  technologies:/技术与工具|技术栈|technolog|tool.stack/i,skills:/专业技能|技术技能|技能特长|technical.skills/i,
  selfEvaluation:/自我评价|自我介绍|个人评价|个人简介|self.?evaluation|self.?assessment|personal.statement|about.me/i,languagesSummary:/^语言能力$|^外语能力$|language.skills|language.abilit/i,softwareSummary:/熟用软件|熟悉软件|常用软件|software.skills|software.tools/i,awardsSummary:/所获荣誉|荣誉奖项|获奖情况|awards|honou?rs/i,
  title:/论文|标题|名称|publication|paper|title/i,authors:/作者|author/i,venue:/期刊|会议|venue|journal|conference/i,publicationDate:/发表|发布|publication|publish/i,doi:/doi/i,url:/链接|网址|作品|github|url|website|portfolio/i};
export function protectedApplicationField(field:{label:string;section?:string;type:string}):boolean{return unsafe.test(field.label+' '+(field.section??''))||!!conditionalNameReview({label:field.label,section:field.section??''} as any);}
export function factFitsField(fact:ApplicationFact,field:{label:string;section?:string;type:string}):boolean{
  const label=field.label.replace(/[*✱＊:：]/g,'').trim(),shortLabel=label.split(/[（(]/u)[0]!.trim(),context=label+' '+(field.section??'');
  if(fact.record==='contact'&&fact.sourceRecordId==='application-setup'){
    if(/紧急|家属|家庭|父亲|母亲|配偶|证明人|推荐人|亲属信息|emergency|family|spouse|parent|referee/i.test(field.section??''))return false;
    const captions:Record<string,RegExp>={applicationHometown:/^籍贯$/,applicationPolitics:/^政治面貌$/,applicationTransfer:/^是否接受岗位调剂$/,applicationSource:/^获取招聘信息来源$/,applicationSourceDetail:/^请填写具体来源$/,applicationInterview:/^(?:校招)?面试(?:站点|地点|方式)$/,applicationRelatives:/^是否有亲属在本公司$/};
    if(captions[fact.kind])return captions[fact.kind]!.test(shortLabel)&&['text','combobox','select'].includes(field.type);
  }
  if(fact.record.startsWith('internship-')&&/工作经历|work\s+experience|employment/i.test(field.section??'')&&!/实习|internship/i.test(field.section??''))return false;
  if(fact.kind==='birthDate')return fact.record==='contact'&&/^(?:出生日期|生日|date.of.birth|birth.date)(?:\s*\/.*)?$/i.test(label)&&!/(?:紧急|他人|家属|父|母|emergency|relative)/i.test(context)&&['text','date','combobox'].includes(field.type);
  if(protectedApplicationField(field))return false;
  if(fact.record==='summary'){
    if(/教育|实习|工作经历|项目|论文|education|internship|employment|project|publication/i.test(field.section??''))return false;
    return fact.kind==='degree'&&/^(?:当前最高学历|最高学历|highest\s+(?:degree|qualification))(?:\s*\/.*)?$/i.test(shortLabel)
      ||fact.kind==='endDate'&&/^(?:毕业时间|graduation\s+date)(?:\s*\/.*)?(?:\s*·\s*[年月])?$/i.test(shortLabel)&&!['checkbox','radio'].includes(field.type);
  }
  if(field.type==='checkbox')return fact.kind==='endDate'&&(fact.value==='至今'||/^\d{4}-\d{2}(?:-\d{2})?$/.test(fact.value))&&/^(?:至今|present)(?:\s*\/\s*(?:至今|present))?$/i.test(label)&&(fact.record.startsWith('internship-')&&/实习|internship|work.experience|employment/i.test(field.section??'')||fact.record.startsWith('project-')&&/项目|project/i.test(field.section??''));
  if(fact.kind==='endDate'&&fact.value==='至今')return field.type==='combobox'&&/结束|截止|end|until/i.test(label)&&(fact.record.startsWith('internship-')&&/实习|internship/i.test(field.section??'')||fact.record.startsWith('project-')&&/项目|project/i.test(field.section??''));
  if(!domains[fact.kind]?.test(label))return false;
  if(fact.kind==='description'&&/^项目职责$/i.test(label))return false;
  if(['major','majorEn'].includes(fact.kind)&&/类型|类别|大类|门类|category|categor|family/i.test(label))return false;
  if(['school','schoolEn'].includes(fact.kind)&&/学院名称|所属学院|院系|faculty|department|school.of|college.of/i.test(label))return false;
  if(fact.kind==='school'&&/英文|english/i.test(label)||fact.kind==='major'&&/英文|english/i.test(label))return false;
  if(['school','schoolEn','college','major','majorEn'].includes(fact.kind)&&/排名|成绩|gpa|ranking|rank|score/i.test(label))return false;
  if(field.type==='email'&&fact.kind!=='email'||field.type==='tel'&&fact.kind!=='phone'||['date','month'].includes(field.type)&&!['startDate','endDate','publicationDate'].includes(fact.kind))return false;
  if(['fullName','fullNameEn'].includes(fact.kind)&&/公司|单位|项目|学校|专业|company|employer|organization|school|university|project|first.?name|last.?name|given.?name|surname|family.?name|preferred.?name|nickname/i.test(label))return false;
  if(fact.kind==='fullName'&&/英文|english/i.test(label))return false;
  if(fact.record==='contact')return !/实习|项目|论文|internship|project|publication|education/i.test(field.section??'');
  if(fact.record==='personal')return !/教育|实习|项目|论文|education|internship|employment|project|publication/i.test(field.section??'');
  const type=fact.record.replace(/-\d+$/,'');
  const expected=type==='education'?/教育|学历|education/i:type==='internship'?/实习|工作经历|internship|work.experience|employment/i:type==='project'?/项目|project/i:type==='language'?/语言|外语|language/i:type==='software'?/软件|工具|software|tools/i:type==='award'?/荣誉|获奖|奖项|awards?|honou?r/i:/论文|出版|publication/i;
  if(!expected.test(field.section??''))return false;
  return true;
}
export function optionMatchesFact(label:string,value:string):boolean{
  const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s*：:]/g,'');
  if(norm(label)===norm(value))return true;
  const aliases=[['硕士','研究生','硕士研究生','master','masters',"master's"],['本科','学士','bachelor',"bachelor's"],['博士','phd','doctorate']];
  return aliases.some(group=>group.includes(norm(label))&&group.includes(norm(value)));
}
/** A site's bilingual display is not an empty search input or a generated translation. */
export function displayedFactMatches(fact:Pick<ApplicationFact,'kind'|'value'>,displayed:string):boolean{
  if(displayed.trim()===fact.value.trim())return true;
  if(['birthDate','startDate','endDate','publicationDate','date'].includes(fact.kind)&&/^\d{4}-\d{2}(?:-\d{2})?$/.test(fact.value)){
    const date=/^(\d{4})[年/.-](\d{1,2})(?:[月/.-](\d{1,2}))?[月日]?$/.exec(displayed.trim());
    if(date&&[date[1],date[2]!.padStart(2,'0'),...(date[3]?[date[3].padStart(2,'0')]:[])].join('-')===fact.value)return true;
  }
  if(fact.kind==='degree'&&optionMatchesFact(displayed,fact.value))return true;
  const pair=/^(.+?)\s*\/\s*([A-Za-z][\s\S]*)$/u.exec(displayed.trim());
  if(!pair||!/[\u3400-\u9fff]/u.test(pair[1]!))return false;
  if(fact.kind==='degree')return optionMatchesFact(pair[1]!,fact.value)&&optionMatchesFact(pair[2]!,fact.value);
  return ['school','major','college'].includes(fact.kind)&&pair[1]!.normalize('NFKC').trim()===fact.value.normalize('NFKC').trim();
}
