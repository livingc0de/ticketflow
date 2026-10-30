#!/usr/bin/env node
/** Offline comparison of coding and complete workflow delivery, not framework-specific commands. */
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import { latestAttempts, outcomeOf } from './workflow/outcome.mjs';
import { reportTarget, writeReport } from './lib/report-output.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const median=v=>{
  if(!v.length||v.some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;
  const s=[...v].sort((a,b)=>a-b),i=Math.floor(s.length/2);
  return s.length%2?s[i]:(s[i-1]+s[i])/2;
};
const fmt=(v,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'unknown';
const averageValues=values=>values.length&&values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0)/values.length:null;
const rate=(rows,fn)=>rows.length?fmt(100*rows.filter(fn).length/rows.length,0)+'%':'n/a';
const safe=s=>String(s??'unknown').replace(/[\r\n|<>]/g,'').slice(0,80);
const group=(rows,key)=>rows.reduce((m,r)=>{const k=key(r);(m[k]??=[]).push(r);return m;},{});
export function render(rows){
  if(!rows.length||rows.some(r=>r.suite!=='workflow'||!r.delivery||typeof r.check?.pass!=='boolean'))
    throw Error('workflow report requires valid JSONL workflow records');
  const latest=latestAttempts(rows),valid=latest.filter(r=>outcomeOf(r)!=='invalid');
  const invalid=latest.filter(r=>outcomeOf(r)==='invalid');
  const previousInvalid=rows.filter(r=>outcomeOf(r)==='invalid');
  const lines=['# Full-pipeline workflow comparison','',
    '> Coding correctness and complete delivery are separate. Review evidence and planning artifacts are observable proxies.',
    '> Unknown costs, descendant usage and human interventions must not be imputed.','',
    'Scored cells: **'+valid.length+'** | Invalid cells excluded: **'+invalid.length+
      '** | Recorded attempts including retries: **'+rows.length+'**','',
    'Success and failure count toward arm rates. Invalid measurements do not. Retried cells use only their latest attempt.','',
    '## Outcomes by arm','',
    '| Arm | Valid | Invalid | Coding | Full pipeline | Delivery evidence | Agent completed | Review evidence | Issue tracking evidence | Latest CI | Median minutes | Median USD |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for(const [arm,part] of Object.entries(group(latest,r=>r.arm)).sort()){
    const scored=part.filter(r=>outcomeOf(r)!=='invalid');
    lines.push('| '+safe(arm)+' | '+scored.length+' | '+(part.length-scored.length)+
      ' | '+rate(scored,r=>r.delivery.functionality)+
      ' | '+rate(scored,r=>outcomeOf(r)==='success')+
      ' | '+rate(scored,r=>r.delivery.pipeline)+
      ' | '+rate(scored,r=>r.agent_exit===0)+
      ' | '+rate(scored,r=>r.delivery.steps.review_evidence)+
      ' | '+rate(scored,r=>r.delivery.steps.issue_tracking)+
      ' | '+rate(scored,r=>r.delivery.steps.latest_head_ci)+
      ' | '+fmt(median(scored.map(r=>typeof r.wall_s==='number'?r.wall_s/60:null)))+
      ' | '+fmt(median(scored.map(r=>r.cost_usd)),2)+' |');
  }
  lines.push('','## Workflow evidence by arm','','| Arm | Avg agent-created issues | Avg closed+linked work items | Avg plan artifacts | Avg agent Project changes |',
    '| --- | ---: | ---: | ---: | ---: |');
  for(const [arm,part] of Object.entries(group(valid,r=>r.arm)).sort()){
    const average=key=>averageValues(part.map(r=>r.delivery.process?.[key]));
    const plans=part.map(r=>r.delivery.process?.plan_artifacts?.length??null);
    const projectChanges=part.map(r=>r.delivery.process?.planning?.project_changed_from_pre_agent_baseline??null);
    lines.push('| '+safe(arm)+' | '+fmt(average('agent_created_issues'))+
      ' | '+fmt(average('issues_closed_and_linked'))+' | '+fmt(averageValues(plans),0)+
      ' | '+fmt(averageValues(projectChanges),0)+' |');
  }
  lines.push('','## Per scenario','','| Scenario | Arm | Valid | Invalid | Code | Pipeline | Seed ticket coverage |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for(const [key,part] of Object.entries(group(latest,r=>r.scenario+' '+r.arm)).sort()){
    const [scenario,arm]=key.split(' '),scored=part.filter(r=>outcomeOf(r)!=='invalid');
    const coverage=scored.map(r=>r.delivery.process?.issue_coverage??null);
    lines.push('| '+safe(scenario)+' | '+safe(arm)+' | '+scored.length+' | '+(part.length-scored.length)+
      ' | '+rate(scored,r=>r.delivery.functionality)+' | '+rate(scored,r=>outcomeOf(r)==='success')+
      ' | '+fmt(median(coverage),2)+' |');
  }
  lines.push('','## Coordination observations (W3 and W7)','',
    'One integrated PR is valid. PR counts and closure order are descriptive proxies, not proof of agent orchestration or parallel execution.','',
    '| Scenario | Arm | Mean merged PRs | Mean seeded tickets per merged PR | Dependency order violations |',
    '| --- | --- | ---: | ---: | ---: |');
  for(const [key,part] of Object.entries(group(valid.filter(r=>['W3','W7'].includes(r.scenario)),
      r=>r.scenario+' '+r.arm)).sort()){
    const [scenario,arm]=key.split(' ');
    const mean=values=>values.length&&values.every(Number.isFinite)?
      values.reduce((a,b)=>a+b,0)/values.length:null;
    const coordination=part.map(r=>r.delivery.process?.coordination);
    const prs=coordination.map(c=>c?.merged_pr_count);
    const tickets=coordination.flatMap(c=>(c?.linked_seeded_per_merged_pr??[]).map(x=>x.count));
    const violations=coordination.map(c=>c?.dependency_order_violations);
    lines.push('| '+safe(scenario)+' | '+safe(arm)+' | '+fmt(mean(prs))+' | '+
      fmt(mean(tickets))+' | '+(scenario==='W3'?fmt(mean(violations),0):'n/a')+' |');
  }
  lines.push('','## Invalid measurements','','| Scenario | Arm | Repeat | Reason |',
    '| --- | --- | ---: | --- |');
  for(const r of invalid)
    lines.push('| '+safe(r.scenario)+' | '+safe(r.arm)+' | '+safe(r.repeat)+
      ' | '+safe((r.invalid_reasons??['unknown provenance']).join(', '))+' |');
  if(!invalid.length)lines.push('| None | | | |');
  const invalidCosts=previousInvalid.map(r=>r.cost_usd);
  lines.push('','Invalid-attempt spend (including superseded attempts): '+
    (invalidCosts.length&&invalidCosts.every(n=>typeof n==='number'&&Number.isFinite(n))?
      '$'+fmt(invalidCosts.reduce((a,b)=>a+b,0),2):invalidCosts.length?'unknown':'$0.00')+
    '. These costs are disclosed but not attributed to framework performance.');
  lines.push('','**Scenarios:** W1 plain request to native tracked delivery, W2 existing work item, W3 dependent changes, W4 failing PR/review, W5 interrupted delivery, W6 native work breakdown, W7 parallelizable independent work items.');
  const configs=new Set(latest.map(r=>JSON.stringify([r.agent,r.agent_version,r.requested_model,r.requested_effort,r.eval_fingerprint,r.profile_isolation,r.sandbox_mode])));
  if(configs.size>1)lines.push('','**Comparability warning:** Multiple agents, models, evaluator fingerprints, profiles or sandbox modes are present. Analyze controlled subsets, not pooled averages.');
  if(invalid.length)lines.push('**Invalid-run warning:** Excluded infrastructure attempts require a fresh rerun; no automatic success or failure is imputed. Compare arms only after filling invalid cells or clearly disclosing incomplete scenario coverage.');
  if(latest.some(r=>!r.outcome))lines.push('**Legacy-record warning:** Older rows lack explicit outcome provenance; failures cannot be reliably distinguished from invalid measurements.');
  if(rows.some(r=>r.cost_usd==null))lines.push('**Cost warning:** One or more sessions have unknown cost. Median and total costs are not estimated.');
  if(rows.some(r=>r.descendants!=='included'))lines.push('**Sub-agent warning:** Full descendant usage cannot be independently verified.');
  if(rows.some(r=>r.profile_cleanup!=='ok'))lines.push('**Cleanup warning:** A profile cleanup was incomplete.');
  if(latest.some(r=>r.profile_isolation==='unisolated'))lines.push('**Isolation warning:** Unisolated profiles can change outcomes.');
  if(latest.some(r=>r.plugin_sha&&!['loaded','verified'].includes(r.plugin_bootstrap?.status)))lines.push('**Plugin warning:** External plugin loading is unknown or failed; publication is not controlled.');
  if(latest.some(r=>!Array.isArray(r.transcript_archives)||!r.transcript_archives.length))lines.push('**Transcript warning:** One or more workflow cells lack archived session evidence.');
  return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('report-workflow.mjs')){
  try {
    const {values:v,positionals}=parseArgs({options:{out:{type:'string'},publish:{type:'boolean'},label:{type:'string'},date:{type:'string'},'results-dir':{type:'string'}},allowPositionals:true});
    if(positionals.length!==1)throw Error('usage: node benchmarks/report-workflow.mjs RESULTS.jsonl [--out REPORT.md] [--publish --label slug --date YYYY-MM-DD --results-dir DIR]');
    if(v['results-dir']&&!v.publish)throw Error('--results-dir requires --publish');
    const rows=readFileSync(resolve(positionals[0]),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const output=render(rows);
    const target=reportTarget({publish:v.publish,out:v.out,label:v.label,date:v.date,suite:'workflow',defaultLabel:'workflow',defaultDir:resolve(v['results-dir']??join(HERE,'results'))});
    if(writeReport(target,output))console.log(target);
    else process.stdout.write(output);
  }catch(e){console.error('report-workflow: '+e.message);process.exitCode=2;}
}
