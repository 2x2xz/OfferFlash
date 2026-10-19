"""Independent score counts, BM25, cosine and RRF replay from archived real responses; no API."""
import json, math, re, unicodedata, collections
from pathlib import Path
p=Path('.backups/qualification-retrieval-v2-20261019');run=p/'formal-final-r2';data=json.loads((p/'annotated-corpus.json').read_text());report=json.loads((run/'report.json').read_text());contexts={x['queryId']:x for x in json.loads((p/'replay-context.json').read_text())};jobs={j['id']:j for j in data['jobs']};qrels={(q['queryId'],q['jobId']):q for q in data['qrels']};vectors={}
for a in report['embeddingAttempts']:
 req=json.loads((run/a['requestFile']).read_text());res=json.loads((run/a['responseFile']).read_text())
 for row in res['data']:vectors[req['input'][row['index']]]=row['embedding']
aliases=[['大模型','llm','large language model'],['智能体','agent'],['强化学习','reinforcement learning','rl'],['检索增强','rag','retrieval augmented'],['计算机视觉','computer vision'],['后端','后台','backend'],['数据分析','data analysis'],['目标检测','object detection']]
def tok(text):
 s=unicodedata.normalize('NFKC',text).lower()
 for group in aliases:
  if any(bool(re.search(r'(?:^|[^a-z])'+w+r'(?:$|[^a-z])',s))if re.fullmatch('[a-z ]+',w)else w in s for w in group):s+=' '+' '.join(group)
 out=[]
 for part in re.findall(r'[\u3400-\u9fff\uf900-\ufaff]+|[a-z0-9]+(?:[+#.-][a-z0-9+#]+)*',s):
  if re.search(r'[\u3400-\u9fff\uf900-\ufaff]',part):out.extend([part]if len(part)==1 else[part[i:i+2]for i in range(len(part)-1)])
  else:out.append(part)
 return collections.Counter(out)
def lexical(ids,query):
 terms=tok(query);docs={id:tok('\n'.join([jobs[id]['title']]*3+[jobs[id]['description'],jobs[id]['requirements']]))for id in ids};lengths={id:sum(v.values())for id,v in docs.items()};avg=sum(lengths.values())/(len(ids)or 1)or 1;df={t:sum(t in d for d in docs.values())for t in terms};scores={}
 for id,doc in docs.items():
  score=0
  for t,qtf in terms.items():
   tf=doc.get(t,0)
   if tf:score+=math.log(1+(len(ids)-df[t]+.5)/(df[t]+.5))*tf*2.2/(tf+1.2*(.25+.75*lengths[id]/avg))*(1+math.log(qtf))
  scores[id]=score
 return sorted(ids,key=lambda id:(-scores[id],id))
def text(j):return f"岗位：{j['title']}\n工作职责：{j['description']}\n任职要求：{j['requirements']}"[:6000]
def cosine(a,b):return sum(x*y for x,y in zip(a,b))/math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
score_rows=0
for row in report['rows']:
 gold=[qrels[row['queryId'],id]for id in row['ranking']];good=sum(q['relevance']>=2 and q['eligibility']=='eligible'for q in gold);bad=sum(q['relevance']<2 or q['eligibility']=='ineligible'for q in gold)
 assert [good,bad,len(gold)-good-bad]==[row['score'][k]for k in ['confirmedSuitableCount','confirmedUnsuitableCount','suitabilityUnknownCount']]
 assert sum(q['relevance']>=2 for q in gold)==row['diagnostics']['semanticRelevant']
 for k in [5,10,20]:
  positive=[q for q in data['qrels']if q['queryId']==row['queryId']and q['relevance']>=2 and q['eligibility']!='ineligible'];assert sum(q['jobId']in row['candidateIds'][:k]for q in positive)==row['diagnostics']['retrieval'][str(k)]['recalled']
 score_rows+=1
for queryId,c in contexts.items():
 ids=c['eligibleIds'];lex=lexical(ids,c['query']['lexical']);v=vectors[c['query']['dense']];dense=sorted(ids,key=lambda id:(-cosine(vectors[text(jobs[id])],v),id));rr={id:0 for id in ids}
 for ranking in [lex,dense]:
  for i,id in enumerate(ranking):rr[id]+=1/(60+i+1)
 hybrid=sorted(ids,key=lambda id:(-rr[id],id))
 for arm,ranking in [('lexical',lex),('semantic',dense),('hybrid',hybrid)]:
  row=next(r for r in report['rows']if r['queryId']==queryId and r['arm']==arm);assert ranking==row['fullRanking'],(queryId,arm)
a=Path('docs/expanded-job-retrieval-audit.json');out=json.loads(a.read_text());out.update(independentPythonScoreRows=score_rows,independentBm25CosineRrfRows=len(contexts)*3,independentRetrievalCutoffs=[5,10,20]);a.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':True,'independentScoreRows':score_rows,'independentRetrievalRows':len(contexts)*3}))
