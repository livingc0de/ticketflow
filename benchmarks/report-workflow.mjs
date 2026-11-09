#!/usr/bin/env node
/**
 * Offline workflow report. Separate axes (A delivery, B autonomy, C code, D history, E review/fix,
 * P process, F cost), each per arm and per scenario x arm with cost beside it. No blended score.
 * Judge/probe columns appear only with --judge FILE and are labelled audited estimates.
 */
import {cellKey,latestAttempts} from './workflow/outcome.mjs';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import { reportTarget, writeReport } from './lib/report-output.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
export const SCHEMA='workflow-v2';
const num=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=(v,d=1)=>num(v)?v.toFixed(d):'unknown';
const mean=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const median=v=>{
  if(!v.length||v.some(n=>!num(n)))return null;
  const s=[...v].sort((a,b)=>a-b),i=Math.floor(s.length/2);
  return s.length%2?s[i]:(s[i-1]+s[i])/2;
};
// Report text never carries local paths, markup or table breakers.
const safe=s=>String(s??'unknown').replace(/(?<![\w.])\/(?:[\w.-]+\/)+[\w.-]*/g,'[path]').replace(/[\r\n|<>]/g,'').slice(0,80);
const group=(rows,key)=>rows.reduce((m,r)=>{const k=key(r);(m[k]??=[]).push(r);return m;},{});
export {cellKey,latestAttempts};
/** Parse a JSONL file of workflow-v2 rows; older schemas are rejected, never converted. */
export function checkRows(rows){
  if(!rows.length)throw Error('workflow report requires at least one workflow-v2 row');
  const bad=[...new Set(rows.filter(r=>r.schema!==SCHEMA).map(r=>r.schema??'none'))];
  if(bad.length)throw Error(`workflow report needs rows with schema '${SCHEMA}', found ${bad.map(b=>`'${b}'`).join(', ')}; `+
    'rows from an older benchmark version measure something else and are not comparable (rerun the cells)');
  return rows;
}
export const readJsonl=file=>readFileSync(resolve(file),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);

const facts=r=>r.facts??{};
const checks=(r,kind)=>(facts(r).checks??[]).filter(c=>c.kind===kind);
const share=(list,fn)=>list.length?list.filter(fn).length/list.length:null;
// Aggregates over cells. Cells whose value is unknown are left out and the gap is shown, never imputed.
function avg(part,fn,d=1,scale=1,unit=''){
  const v=part.map(fn).filter(num);
  if(!v.length)return part.length?'unknown':'n/a';
  return fmt(mean(v)*scale,d)+unit+(v.length<part.length?` (${v.length}/${part.length} known)`:'');
}
const pc=(part,fn)=>avg(part,fn,0,100,'%');
function sum(part,fn){
  const vals=part.map(fn),n=vals.filter(num).reduce((a,b)=>a+b,0),u=vals.filter(v=>!num(v)).length;
  return n+(u?` + ${u} unknown`:'');
}
const med=(part,fn,d=1)=>fmt(median(part.map(fn)),d);
const lower=(part,text)=>text!=='unknown'&&part.some(r=>r.cost_complete===false)?'≥'+text:text; // an interrupted session reports no cost; its priced token usage is a lower bound
const usd=part=>lower(part,med(part,r=>r.cost_usd,2));
const req=(status)=>r=>{const q=checks(r,'req');return share(q,c=>c.status===status);};
const regCount=status=>r=>checks(r,'reg').filter(c=>c.status===status).length;
const defectCount=cls=>r=>(facts(r).defects??[]).filter(d=>d.class===cls).length;
const record=(r,k)=>facts(r).process?.durable_record?.[k];
const landings=part=>['direct','pr','mixed','none'].map(m=>part.filter(r=>facts(r).landing?.mode===m).length).join('/');
const commits=r=>facts(r).landing?.commits??[];
const sessions=r=>r.sessions??[];
const known=v=>v===true||v===false?(v?1:0):null;

// Judge/probe aggregation: mean over cells of mean over runs, with run count and disagreement (mean max-min per cell).
function audited(part,records,pick,d=1){
  const ids=new Set(part.map(r=>r.result_row_id)),perCell=[];let nulls=0;
  for(const id of ids){
    const vals=[];
    for(const rec of records.filter(x=>x.result_row_id===id)){const v=pick(rec);if(v===undefined)continue;if(num(v))vals.push(v);else nulls++;}
    if(vals.length)perCell.push(vals);
  }
  const runs=perCell.reduce((a,v)=>a+v.length,0);
  if(!runs)return nulls?`null x${nulls}`:'not judged';
  const multi=perCell.filter(v=>v.length>1);
  const dis=multi.length?fmt(mean(multi.map(v=>Math.max(...v)-Math.min(...v))),d):'n/a';
  return `${fmt(mean(perCell.map(mean)),d)} [runs ${runs}, disagree ${dis}${nulls?`, null ${nulls}`:''}]`;
}
const criterion=(part,rec,id)=>audited(part,rec.filter(x=>x.kind==='judge'),x=>x.scores?x.scores[id]??null:null);
const probeCol=key=>(part,rec)=>audited(part,rec.filter(x=>x.kind==='probe'),x=>x.probe?x.probe[key]:null,2);

const TABLES=[
  {id:'A',title:'A. Delivery',note:'Requirement status per cell, equal weight per cell. landed = on the default branch; pending = exists only on an open PR, an ahead branch or the agent checkout; missing = not delivered.',
    cols:[['Req landed',p=>pc(p,req('landed'))],['Req pending',p=>pc(p,req('pending'))],['Req missing',p=>pc(p,req('missing'))],
      ['All req landed',p=>pc(p,r=>{const q=checks(r,'req');return q.length?(q.every(c=>c.status==='landed')?1:0):null;})],
      ['Regressed (landed)',p=>sum(p,regCount('regressed-landed'))],['Regressed (pending)',p=>sum(p,regCount('regressed-pending'))],
      ['Landing direct/pr/mixed/none',landings]]},
  {id:'B',title:'B. Autonomy',note:'Human interventions are continuation replies. Sub-agent use is recorded, not rewarded.',
    cols:[['Interventions (mean)',p=>avg(p,r=>r.interventions)],['Continuations',p=>sum(p,r=>sessions(r).reduce((a,s)=>a+(num(s.continuations)?s.continuations:0),0))],
      ['Sessions exit != 0',p=>sum(p,r=>sessions(r).filter(s=>s.exit!==0).length)],
      ['Interrupt fired/not-reached',p=>p.reduce((a,r)=>[a[0]+sessions(r).filter(s=>s.interrupt==='fired').length,a[1]+sessions(r).filter(s=>s.interrupt==='not-reached').length],[0,0]).join('/')],
      ['Median minutes',p=>med(p,r=>num(r.wall_s)?r.wall_s/60:null)],['Sub-agents (mean)',p=>avg(p,r=>facts(r).transcript?.subagents)],
      ['Permission denials (mean)',p=>avg(p,r=>facts(r).transcript?.permission_denials)]]},
  {id:'C',title:'C. Code',note:'Tests the arm wrote that fail on the original behaviour are a sign they test the change.',judge:['C1','C2','C3'],
    cols:[['Deps added',p=>sum(p,r=>facts(r).code?.deps_added?.length)],['Files outside scope (mean)',p=>avg(p,r=>facts(r).code?.files_outside_scope?.length)],
      ['Lines added (median)',p=>med(p,r=>facts(r).code?.lines_added,0)],['Lines removed (median)',p=>med(p,r=>facts(r).code?.lines_removed,0)],
      ['Own tests fail on base',p=>pc(p,r=>known(facts(r).code?.own_tests_fail_on_base))]]},
  {id:'D',title:'D. History and reasoning',note:'Durable record counts are observed facts (any form). Probe: a fresh tool-less reader of the dossier only, scored against the checks.',judge:['D1','D2','D3'],probe:true,
    cols:[['Issues (mean)',p=>avg(p,r=>record(r,'issues'))],['Issue comments (mean)',p=>avg(p,r=>record(r,'issue_comments'))],['PR bodies (mean)',p=>avg(p,r=>record(r,'pr_bodies'))],
      ['Docs changed (mean)',p=>avg(p,r=>facts(r).process?.durable_record?.docs_changed?.length)],['Commit bodies (mean)',p=>avg(p,r=>record(r,'commit_bodies'))]]},
  {id:'E',title:'E. Review and fix',note:'missed-no-review / missed-with-review: a planted defect that stayed in scope and landed. out-of-scope: the work never touched its file.',judge:['E1','E2'],
    cols:[['Defects fixed',p=>sum(p,defectCount('fixed'))],['Missed, no review',p=>sum(p,defectCount('missed-no-review'))],['Missed, with review',p=>sum(p,defectCount('missed-with-review'))],
      ['Defect out of scope',p=>sum(p,defectCount('out-of-scope'))],['Review observed',p=>pc(p,r=>known(facts(r).process?.review_observed))],
      ['Review before landing',p=>pc(p,r=>known(facts(r).process?.review_before_landing))],['Unsafe landing',p=>sum(p,r=>facts(r).process?.unsafe_landing?1:0)]]},
  {id:'P',title:'P. Process',note:'Observed facts judged by consequence. Unknown timing or verification is shown as unknown.',
    cols:[['Landing timing known',p=>pc(p,r=>facts(r).landing?known(facts(r).landing.timing==='known'):null)],
      ['Force pushes',p=>sum(p,r=>num(facts(r).landing?.force_pushes)?facts(r).landing.force_pushes:null)],
      ['Commits verified remote',p=>pc(p,r=>share(commits(r),c=>c.verified?.remote===true))],['Commits verified locally',p=>pc(p,r=>share(commits(r),c=>c.verified?.local==='yes'))],
      ['Local verification before push',p=>pc(p,r=>known(facts(r).transcript?.local_verification_before_push))],
      ['Open PRs left (mean)',p=>avg(p,r=>facts(r).landing?.open_prs?.length)],['Ahead branches (mean)',p=>avg(p,r=>facts(r).landing?.ahead_branches?.length)],
      ['Local only',p=>sum(p,r=>facts(r).landing?.local_only?1:0)]]},
  {id:'F',title:'F. Cost',note:'Unknown cost is never estimated; a median over cells with any unknown cost is unknown. A figure marked ≥ includes an interrupted session whose own token usage, priced at list rates, is only a lower bound.',cost:false,
    cols:[['Median USD',usd],['Total USD',p=>{const v=p.map(r=>r.cost_usd);return lower(p,v.every(num)?fmt(v.reduce((a,b)=>a+b,0),2):'unknown');}],
      ['Median minutes',p=>med(p,r=>num(r.wall_s)?r.wall_s/60:null)],['Median turns',p=>med(p,r=>r.turns,0)],
      ['USD per landed req',p=>{const cost=p.map(r=>r.cost_usd),landed=p.reduce((a,r)=>a+checks(r,'req').filter(c=>c.status==='landed').length,0);
        return lower(p,cost.every(num)&&landed?fmt(cost.reduce((a,b)=>a+b,0)/landed,2):'unknown');}]]},
];
function table(spec,groups,records,withJudge,label){
  const judgeCols=withJudge?[...(spec.probe?[['Probe req accuracy',probeCol('req_accuracy')],['Probe open items',probeCol('open_items_agreement')],['Probe unknown share',probeCol('unknown_rate')]]:[]),
    ...(spec.judge??[]).map(id=>[id+' (judge)',(p,rec)=>criterion(p,rec,id)])]:[];
  const cols=[...spec.cols,...judgeCols,...(spec.cost===false?[]:[['Median USD',usd]])];
  const out=['| '+label+' | Cells | '+cols.map(c=>c[0]).join(' | ')+' |','| '+['---','---:',...cols.map(()=>'---:')].join(' | ')+' |'];
  for(const [k,part] of groups)out.push('| '+safe(k)+' | '+part.length+' | '+cols.map(c=>c[1](part,records)).join(' | ')+' |');
  return out;
}
export function render(rows,{judge=null}={}){
  checkRows(rows);
  const latest=latestAttempts(rows),valid=latest.filter(r=>r.outcome!=='invalid'),invalid=latest.filter(r=>r.outcome==='invalid');
  const previousInvalid=rows.filter(r=>r.outcome==='invalid');
  const withJudge=Array.isArray(judge);
  const records=(judge??[]).filter(x=>valid.some(r=>r.result_row_id===x.result_row_id));
  const lines=['# Workflow benchmark comparison','',
    '> Axes are reported side by side with their cost. There is no blended score and no credit for artifact counts.',
    '> Unknown costs, usage and interventions are never imputed. Retried cells use only their latest attempt.','',
    'Scored cells: **'+valid.length+'** | Invalid cells excluded: **'+invalid.length+'** | Recorded attempts including retries: **'+rows.length+'**',
    withJudge?'Judge and probe columns are **audited estimates** (LLM, tool vocabulary stripped, citations validated), never deterministic facts.':
      'No judge file given: only deterministic facts are shown.'];
  const byArm=Object.entries(group(valid,r=>r.arm)).sort(),byCell=Object.entries(group(valid,r=>r.scenario+' / '+r.arm)).sort();
  for(const spec of TABLES){
    const j=withJudge&&(spec.judge||spec.probe);
    lines.push('','## '+spec.title,'',spec.note,'');
    lines.push('Per arm','',...table(spec,byArm,records,j,'Arm'),'','Per scenario / arm','',...table(spec,byCell,records,j,'Scenario / arm'));
    if(j)lines.push('','Audited estimate: mean over cells of the mean over judge runs; runs = scored runs, disagree = mean spread between runs of one cell, null = runs with no valid score (never imputed).');
  }
  if(withJudge){
    const skipped=records.filter(x=>x.kind==='skipped'),shared=records.filter(x=>x.kind!=='skipped'&&x.same_family);
    lines.push('','## Judge coverage','');
    lines.push('Judge records: **'+records.filter(x=>x.kind!=='skipped').length+'** | skipped: **'+skipped.length+'**'+
      (skipped.length?' ('+[...new Set(skipped.map(x=>safe(x.reason)))].join('; ')+')':''),'');
    lines.push('Judge models: '+([...new Set(records.map(x=>safe(x.judge_agent)+'/'+safe(x.judge_model??'default')))].join(', ')||'none'));
    if(shared.length)lines.push('','**Same-family warning:** '+shared.length+' judge record(s) used the same model family as the arm they scored; treat those scores with extra caution.');
  }
  lines.push('','## Invalid measurements','','| Scenario | Arm | Repeat | Reason |','| --- | --- | ---: | --- |');
  for(const r of invalid)lines.push('| '+safe(r.scenario)+' | '+safe(r.arm)+' | '+safe(r.repeat)+' | '+safe((r.invalid_reasons??['unknown provenance']).join(', '))+' |');
  if(!invalid.length)lines.push('| None | | | |');
  const costs=previousInvalid.map(r=>r.cost_usd);
  lines.push('','Invalid-attempt spend (including superseded attempts): '+(costs.length&&costs.every(num)?'$'+fmt(costs.reduce((a,b)=>a+b,0),2):costs.length?'unknown':'$0.00')+
    '. These costs are disclosed but not attributed to framework performance.');
  const configs=new Set(latest.map(r=>JSON.stringify([r.agent,r.agent_version,r.requested_model,r.requested_effort,r.eval_fingerprint,r.profile_isolation,r.sandbox_mode])));
  if(configs.size>1)lines.push('','**Comparability warning:** Multiple agents, models, evaluator fingerprints, profiles or sandbox modes are present. Analyze controlled subsets, not pooled averages.');
  if(invalid.length)lines.push('**Invalid-run warning:** Excluded infrastructure attempts require a fresh rerun; no automatic success or failure is imputed. Compare arms only after filling invalid cells or clearly disclosing incomplete scenario coverage.');
  if(valid.some(r=>facts(r).landing?.timing==='unknown'))lines.push('**Landing-time warning:** Some landing times are unknown (activity history unavailable); order-dependent process facts are shown as unknown for them.');
  if(rows.some(r=>r.cost_usd==null))lines.push('**Cost warning:** One or more sessions have unknown cost. Median and total costs are not estimated.');
  if(rows.some(r=>r.cost_complete===false&&r.cost_usd!=null))lines.push('**Cost note:** Cells with an interrupted session show a lower bound (marked ≥): that session reports no cost, so its transcript token usage is priced at list rates, which runs 15-30% below the reported cost on completed sessions.');
  if(rows.some(r=>r.descendants!==undefined&&r.descendants!=='included'))lines.push('**Sub-agent warning:** Full descendant usage cannot be independently verified.');
  if(rows.some(r=>r.profile_cleanup!=='ok'))lines.push('**Cleanup warning:** A profile cleanup was incomplete.');
  if(latest.some(r=>r.profile_isolation==='unisolated'))lines.push('**Isolation warning:** Unisolated profiles can change outcomes.');
  if(latest.some(r=>r.plugin_sha&&!['loaded','verified'].includes(r.plugin_bootstrap?.status)))lines.push('**Plugin warning:** External plugin loading is unknown or failed; publication is not controlled.');
  if(latest.some(r=>!Array.isArray(r.transcript_archives)||!r.transcript_archives.length))lines.push('**Transcript warning:** One or more workflow cells lack archived session evidence.');
  return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('report-workflow.mjs')){
  try {
    const {values:v,positionals}=parseArgs({options:{out:{type:'string'},publish:{type:'boolean'},label:{type:'string'},date:{type:'string'},'results-dir':{type:'string'},judge:{type:'string'}},allowPositionals:true});
    if(positionals.length!==1)throw Error('usage: node benchmarks/report-workflow.mjs RESULTS.jsonl [--judge RESULTS.jsonl.judge.jsonl] [--out REPORT.md] [--publish --label slug --date YYYY-MM-DD --results-dir DIR]');
    if(v['results-dir']&&!v.publish)throw Error('--results-dir requires --publish');
    const output=render(readJsonl(positionals[0]),{judge:v.judge?readJsonl(v.judge):null});
    const target=reportTarget({publish:v.publish,out:v.out,label:v.label,date:v.date,suite:'workflow',defaultLabel:'workflow',defaultDir:resolve(v['results-dir']??join(HERE,'results'))});
    if(writeReport(target,output))console.log(target);
    else process.stdout.write(output);
  }catch(e){console.error('report-workflow: '+e.message);process.exitCode=2;}
}
