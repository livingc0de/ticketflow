#!/usr/bin/env node
/** Workflow-specific report. Keeps engineering and lifecycle success separate. */
import {readFileSync,writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';

const avg=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const pct=n=>n===null?'unknown':(100*n).toFixed(0)+'%';
const numeric=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const fmt=n=>n===null?'unknown':n.toFixed(2);
const median=v=>{
  if(!v.length||v.some(x=>!numeric(x)))return null;
  const a=[...v].sort((x,y)=>x-y),k=Math.floor(a.length/2);
  return a.length%2?a[k]:(a[k-1]+a[k])/2;
};
const safe=s=>String(s).replace(/[|<>[\]\r\n]/g,' ').slice(0,80);
export function render(rows) {
  if(!rows.length||rows.some(r=>r.suite!=='workflow'||!r.delivery||typeof r.check?.pass!=='boolean'))
    throw Error('workflow-report requires recorded workflow JSONL rows');
  const versions=new Set(rows.map(r=>JSON.stringify([r.agent,r.agent_version,r.requested_model,r.requested_effort,r.eval_fingerprint,r.profile_isolation,r.sandbox_mode])));
  const warnings=[];
  if(versions.size!==1) warnings.push('Mixed models, CLIs, evaluator revisions, profile modes or sandbox modes. Do not pool or claim a controlled comparison.');
  if(rows.some(r=>r.profile_cleanup!=='ok')) warnings.push('Plugin cleanup incomplete. Do not publish.');
  if(rows.some(r=>!r.model)) warnings.push('Some effective model identities are unknown.');
  if(rows.some(r=>r.cost_usd==null)) warnings.push('Incomplete costs, particularly interrupted invocations. Cost per success is unknown.');
  if(rows.some(r=>r.descendants!=='included')) warnings.push('Subagent token/cost attribution is unverified.');
  const arms=[...new Set(rows.map(r=>r.variant??r.arm))].sort();
  const lines=['# Workflow delivery comparison','',
    'Observed test cells: **'+rows.length+'**. Local engineering scores are reported separately.',
    '', '| Arm | Cells | Functional pass | Pipeline pass | Review evidence | Tracked seeded issues | New issues / cell | Median sec | Total reported USD |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for(const arm of arms) {
    const group=rows.filter(r=>(r.variant??r.arm)===arm);
    const ratio=fn=>pct(avg(group.map(r=>fn(r)?1:0)));
    const tracked=group.map(r=>r.delivery.process?.tracking_coverage).filter(x=>numeric(x));
    const created=group.map(r=>r.delivery.process?.agent_created_issues).filter(x=>numeric(x));
    const costs=group.map(r=>r.cost_usd);
    const total=costs.every(numeric)?costs.reduce((a,b)=>a+b,0):null;
    lines.push('| '+safe(arm)+' | '+group.length+' | '+ratio(r=>r.delivery.functionality)+' | '+
      ratio(r=>r.check.pass)+' | '+ratio(r=>r.delivery.process?.review_evidence)+' | '+
      pct(avg(tracked))+' | '+fmt(avg(created))+' | '+fmt(median(group.map(r=>r.wall_s)))+' | '+fmt(total)+' |');
  }
  lines.push('','## Per-scenario outcomes','',
    '| Scenario | Arm | Cells | Functional passes | Pipeline passes |',
    '| --- | --- | ---: | ---: | ---: |');
  for(const id of [...new Set(rows.map(r=>r.scenario))].sort()) for(const arm of arms) {
    const g=rows.filter(r=>r.scenario===id&&(r.variant??r.arm)===arm);
    if(g.length)lines.push('| '+safe(id)+' | '+safe(arm)+' | '+g.length+' | '+
      g.filter(r=>r.delivery.functionality).length+' | '+g.filter(r=>r.check.pass).length+' |');
  }
  lines.push('','## Interpretation','',
    'Pipeline success requires hidden behavior, repository tests, latest-head GitHub Actions success, an observed review, issue linkage where initial issues exist, a merged PR, no duplicate PRs and, for W5, a confirmed interruption.',
    'The seed Project and issues are provided before the agent starts, so these artifacts never count as agent accomplishments. Each arm uses its native workflow.',
    'Documentation, planning depth, review usefulness, human interventions and quality of decisions require transcript/manual audit, not just a binary proxy.',
    'The benchmark requires an isolated disposable GitHub organization and machine; it is non-adversarial and does not establish a security boundary.',
    'Three repetitions per cell are exploratory, not statistically conclusive.', '');
  if(warnings.length)lines.push('## Warnings','',...warnings.map(w=>'- '+w),'');
  return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('workflow-report.mjs')){
  try{
    const {values:v,positionals}=parseArgs({options:{out:{type:'string'}},allowPositionals:true});
    if(positionals.length!==1)throw Error('usage: workflow-report RUNS.jsonl [--out SUMMARY.md]');
    const rows=readFileSync(positionals[0],'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const report=render(rows);
    if(v.out)writeFileSync(v.out,report);else console.log(report);
  }catch(e){console.error('workflow-report: '+e.message);process.exitCode=2;}
}
