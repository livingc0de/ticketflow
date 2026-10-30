#!/usr/bin/env node
/** Offline comparison of coding and complete workflow delivery, not framework-specific commands. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
const median=v=>{
  if(!v.length||v.some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;
  const s=[...v].sort((a,b)=>a-b),i=Math.floor(s.length/2);
  return s.length%2?s[i]:(s[i-1]+s[i])/2;
};
const fmt=(v,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'unknown';
const rate=(rows,fn)=>rows.length?fmt(100*rows.filter(fn).length/rows.length,0)+'%':'n/a';
const safe=s=>String(s??'unknown').replace(/[\r\n|<>]/g,'').slice(0,80);
const group=(rows,key)=>rows.reduce((m,r)=>{const k=key(r);(m[k]??=[]).push(r);return m;},{});
export function render(rows){
  if(!rows.length||rows.some(r=>r.suite!=='workflow'||!r.delivery||typeof r.check?.pass!=='boolean'))
    throw Error('workflow report requires valid JSONL workflow records');
  const lines=['# Full-pipeline workflow comparison','',
    '> Coding correctness and complete delivery are separate. Review evidence and planning artifacts are observable proxies.',
    '> Unknown costs, descendant usage and human interventions must not be imputed.','',
    'Scored cells: **'+rows.length+'**','','## Outcomes by arm','',
    '| Arm | Cells | Coding | Full pipeline | Review evidence | Ticket tracking | Latest CI | Median minutes | Median USD |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for(const [arm,part] of Object.entries(group(rows,r=>r.arm)).sort()){
    lines.push('| '+safe(arm)+' | '+part.length+' | '+rate(part,r=>r.delivery.functionality)+
      ' | '+rate(part,r=>r.delivery.pipeline)+' | '+rate(part,r=>r.delivery.steps.review_evidence)+
      ' | '+rate(part,r=>r.delivery.steps.issue_tracking)+' | '+rate(part,r=>r.delivery.steps.latest_head_ci)+
      ' | '+fmt(median(part.map(r=>typeof r.wall_s==='number'?r.wall_s/60:null)))+
      ' | '+fmt(median(part.map(r=>r.cost_usd)),2)+' |');
  }
  lines.push('','## Workflow evidence by arm','','| Arm | Avg agent-created tickets | Avg closed+linked tickets | Avg plan artifacts | Avg agent Project changes |',
    '| --- | ---: | ---: | ---: | ---: |');
  for(const [arm,part] of Object.entries(group(rows,r=>r.arm)).sort()){
    const average=key=>{const vals=part.map(r=>r.delivery.process?.[key]);return vals.every(x=>Number.isFinite(x))?vals.reduce((a,b)=>a+b,0)/vals.length:null;};
    const plans=part.map(r=>r.delivery.process?.plan_artifacts?.length??null);
    lines.push('| '+safe(arm)+' | '+fmt(average('agent_created_issues'))+
      ' | '+fmt(average('issues_closed_and_linked'))+' | '+fmt(median(plans),0)+
      ' | '+fmt(median(part.map(r=>r.delivery.process?.planning?.project_changed_from_pre_agent_baseline??null)),0)+' |');
  }
  lines.push('','## Per scenario','','| Scenario | Arm | N | Code | Pipeline | Seed ticket coverage |',
    '| --- | --- | ---: | ---: | ---: | ---: |');
  for(const [key,part] of Object.entries(group(rows,r=>r.scenario+' '+r.arm)).sort()){
    const [scenario,arm]=key.split(' ');
    const coverage=part.map(r=>r.delivery.process?.issue_coverage??null);
    lines.push('| '+safe(scenario)+' | '+safe(arm)+' | '+part.length+
      ' | '+rate(part,r=>r.delivery.functionality)+' | '+rate(part,r=>r.delivery.pipeline)+
      ' | '+fmt(median(coverage),2)+' |');
  }
  lines.push('','**Scenarios:** W1 plain request to tracked delivery, W2 existing ticket, W3 dependent tickets, W4 failing PR/review, W5 interrupted delivery, W6 brainstorming-to-tickets, W7 parallelizable independent tickets.');
  const configs=new Set(rows.map(r=>JSON.stringify([r.agent,r.agent_version,r.requested_model,r.requested_effort,r.eval_fingerprint,r.profile_isolation,r.sandbox_mode])));
  if(configs.size>1)lines.push('','**Comparability warning:** Multiple agents, models, evaluator fingerprints, profiles or sandbox modes are present. Analyze controlled subsets, not pooled averages.');
  if(rows.some(r=>r.cost_usd==null))lines.push('**Cost warning:** One or more sessions have unknown cost. Median and total costs are not estimated.');
  if(rows.some(r=>r.descendants!=='included'))lines.push('**Sub-agent warning:** Full descendant usage cannot be independently verified.');
  if(rows.some(r=>r.profile_cleanup!=='ok'))lines.push('**Cleanup warning:** A profile cleanup was incomplete.');
  if(rows.some(r=>r.profile_isolation==='unisolated'))lines.push('**Isolation warning:** Unisolated profiles can change outcomes.');
  if(rows.some(r=>r.plugin_sha&&!['loaded','verified'].includes(r.plugin_bootstrap?.status)))lines.push('**Plugin warning:** External plugin loading is unknown or failed; publication is not controlled.');
  if(rows.some(r=>!Array.isArray(r.transcript_archives)||!r.transcript_archives.length))lines.push('**Transcript warning:** One or more workflow cells lack archived session evidence.');
  return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('workflow-report.mjs')){
  try {
    const {values:v,positionals}=parseArgs({options:{out:{type:'string'}},allowPositionals:true});
    if(positionals.length!==1)throw Error('usage: node benchmarks/workflow-report.mjs RESULTS.jsonl [--out REPORT.md]');
    const rows=readFileSync(resolve(positionals[0]),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const output=render(rows);
    if(v.out){const path=resolve(v.out);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,output);console.log(path);}
    else process.stdout.write(output);
  }catch(e){console.error('workflow-report: '+e.message);process.exitCode=2;}
}
