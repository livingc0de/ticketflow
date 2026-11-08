#!/usr/bin/env node
/**
 * Audited estimates for the workflow benchmark: a status probe (dossier only) and a rubric judge
 * (diff + dossier + condensed transcript + answers + facts), each one tool-less call.
 * Dry run by default; --execute makes paid calls. Output is appended to <rows>.judge.jsonl.
 */
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,appendFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {runProcess} from './lib/process.mjs';
import {selectProfileMode,approveDangerFullAccess} from './lib/profile-auth.mjs';
import {makeProfile,destroyProfile} from './workflow/profile.mjs';
import {newWork} from './workflow/sandbox.mjs';
import {checkRows,latestAttempts,readJsonl} from './report-workflow.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
export const JUDGE_SCHEMA='workflow-judge-v1';
export const RUBRIC={
  C1:'Correctness and robustness of the change: edge cases, error handling, no obvious bug in the diff.',
  C2:'Fit with the existing code: reuses shared helpers, no duplication, no needless dependency, no unrelated changes.',
  C3:'Tests added for the change: meaningful, exercise the new behaviour, would fail without it.',
  D1:'Durable record of intent: a later reader can tell what was asked and why (tickets, PR text, commit messages, docs; any form).',
  D2:'Durable record of decisions: key choices and trade-offs are explained where a later reader will find them.',
  D3:'Durable record of state: what is done, verified and still open is stated honestly and findably.',
  E1:'Review and fix: independent scrutiny of the work, real problems found, fixed and re-checked before the final state.',
  E2:'Verification and honesty: the final answers claim only what the transcript shows actually ran; the exact final state was checked.',
};
export const FILES=['diff.patch','dossier.md','transcript.json','answers.txt','facts.json','checks.json'];
const CAPS={'diff.patch':60_000,'dossier.md':40_000,'transcript.json':40_000,'answers.txt':20_000,'facts.json':20_000,'checks.json':10_000};
const CRITERIA=Object.keys(RUBRIC);
const STATUS=['done','partial','not','unknown'];
const family=(agent,model)=>/claude|opus|sonnet|haiku|fable/i.test(model??'')?'anthropic':/gpt|codex|^o\d/i.test(model??'')?'openai':agent==='claude'?'anthropic':'openai';

// Tool vocabulary must not reveal the arm to the judge.
const TOOL=/\.ticketflow|ticket-?flow|superpowers|ponytail|ticket-planner|pr-reviewer|brainstorming|writing-plans|executing-plans|systematic-debugging|test-driven-development|verification-before-completion|requesting-code-review|subagent-driven-development|using-git-worktrees|dispatching-parallel-agents|finishing-a-development-branch|receiving-code-review|implement-ticket|create-ticket|orchestrate-tickets|engineering-method|e2e-verifier|pr-wait|verify-route|local-verify|core\/scripts\/[\w.-]+/gi;
export const strip=text=>String(text).replace(TOOL,'[tool]');
const squash=s=>s.replace(/\s+/g,' ').trim();

/** Locate the evidence bundle of a row; null when it is not on disk. */
export function bundleDir(row,{rowsFile=null,evidenceRoot=null}={}){
  if(typeof row.evidence_dir!=='string'||!row.evidence_dir)return null;
  const cands=evidenceRoot?[join(evidenceRoot,basename(row.evidence_dir))]:
    isAbsolute(row.evidence_dir)?[row.evidence_dir]:[resolve(row.evidence_dir),resolve(HERE,row.evidence_dir),...(rowsFile?[resolve(dirname(rowsFile),row.evidence_dir)]:[])];
  return cands.find(d=>existsSync(join(d,'facts.json')))??null;
}
/** Read the bundle, strip tool vocabulary and cap each file. What the model sees is what citations are validated against. */
export function loadBundle(dir){
  const text={};
  for(const f of FILES){
    const p=join(dir,f);
    if(!existsSync(p))return {missing:f};
    const raw=strip(readFileSync(p,'utf8'));
    // keep the start and the end: the final verification and the last answer matter most in a long run
    text[f]=raw.length>CAPS[f]?raw.slice(0,Math.floor(CAPS[f]*0.6))+'\n[... truncated ...]\n'+raw.slice(-Math.floor(CAPS[f]*0.4)):raw;
  }
  return {text};
}
const section=(name,body)=>`=== ${name} ===\n${body}\n`;
const requirementList=checks=>checks.filter(c=>c.kind==='req').map(c=>({id:c.id,text:c.text}));
const idEnum=ids=>({type:'string',enum:ids});
const strict=(properties)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});

export function probeRequest(bundle){
  const reqs=requirementList(JSON.parse(bundle.text['checks.json']));
  const prompt=`PROBE. You are a developer picking up a repository you have never seen. You have no tools and no code access; you only have the project dossier below (issues, pull requests with comments and reviews, commit messages, changed documents). Answer only from it. If the dossier does not let you tell, say unknown.

For every requirement listed, say whether it is done (delivered on the default branch), partial (exists but not delivered, for example only on an open pull request or branch), not (not done) or unknown. Then list the ids of requirements that are still open (partial or not). If the dossier shows that a requirement was changed after the first request, give its id in changed_requirement, else null.

Requirements:
${JSON.stringify(reqs,null,1)}

${section('dossier',bundle.text['dossier.md'])}
Reply with JSON only.`;
  const ids=reqs.map(r=>r.id);
  const schema=strict({requirements:{type:'array',items:strict({id:idEnum(ids.length?ids:['none']),status:{type:'string',enum:STATUS}})},
    open_items:{type:'array',items:idEnum(ids.length?ids:['none'])},changed_requirement:{anyOf:[idEnum(ids.length?ids:['none']),{type:'null'}]}});
  return {prompt,schema,ids};
}
/** Deterministic score of a probe answer against facts.checks. Unknown or missing answers never count as correct. */
export function scoreProbe(answer,facts,checksJson=[]){
  const truth=Object.fromEntries((facts.checks??[]).filter(c=>c.kind==='req').map(c=>[c.id,{landed:'done',pending:'partial',missing:'not'}[c.status]]));
  const ids=Object.keys(truth);
  if(!ids.length)return {error:'no requirement checks in facts'};
  if(!answer||!Array.isArray(answer.requirements)||!Array.isArray(answer.open_items))return {error:'malformed probe output'};
  const said=Object.fromEntries(answer.requirements.filter(r=>r&&typeof r.id==='string').map(r=>[r.id,r.status]));
  const given=ids.map(id=>STATUS.includes(said[id])?said[id]:'unknown');
  const open=new Set(answer.open_items.filter(x=>typeof x==='string'&&ids.includes(x))),want=new Set(ids.filter(id=>truth[id]!=='done'));
  const union=new Set([...open,...want]);
  const late=checksJson.filter(c=>c.late===true).map(c=>c.id);
  return {req_accuracy:given.filter((s,i)=>s===truth[ids[i]]).length/ids.length,
    unknown_rate:given.filter(s=>s==='unknown').length/ids.length,
    open_items_agreement:union.size?[...union].filter(x=>open.has(x)&&want.has(x)).length/union.size:1,
    late_change:late.length?+late.includes(answer.changed_requirement):null};
}

export function judgeRequest(bundle){
  const rubric=CRITERIA.map(id=>`${id}: ${RUBRIC[id]}`).join('\n');
  const prompt=`JUDGE. You audit one finished piece of agent work. You have no tools; the material below is everything. Score each criterion 0-3 (0 absent or wrong, 1 weak, 2 good, 3 excellent) or give score null when the material cannot show it. Do not reward volume of artifacts: any form of record or process is fine if it delivers the property. Judge only the work, not which tool or method produced it.

Every score needs evidence: one or more entries {file, quote} where file is one of ${FILES.join(', ')} and quote is a short verbatim excerpt (at least 8 characters) copied from that file below. A score whose quotes cannot be found verbatim is discarded.

Rubric:
${rubric}

${FILES.map(f=>section(f,bundle.text[f])).join('\n')}
Reply with JSON only.`;
  const schema=strict({scores:{type:'array',items:strict({id:{type:'string',enum:CRITERIA},score:{type:['integer','null']},reason:{type:'string'},
    evidence:{type:'array',items:strict({file:{type:'string',enum:FILES},quote:{type:'string'}})}})}});
  return {prompt,schema};
}
/** Null every score that is out of range, lacks evidence or cites text that is not in the bundle. Never imputes. */
export function validateJudge(answer,bundle){
  const scores=Object.fromEntries(CRITERIA.map(id=>[id,null])),reasons=Object.fromEntries(CRITERIA.map(id=>[id,'missing from output']));
  if(!answer||!Array.isArray(answer.scores))return {scores,reasons:Object.fromEntries(CRITERIA.map(id=>[id,'malformed judge output'])),malformed:true};
  const hay=Object.fromEntries(Object.entries(bundle.text).map(([f,t])=>[f,squash(t)]));
  for(const item of answer.scores){
    if(!item||!CRITERIA.includes(item.id))continue;
    const id=item.id;
    if(item.score===null){reasons[id]='judge gave no score: '+squash(String(item.reason??'')).slice(0,120);continue;}
    if(!Number.isInteger(item.score)||item.score<0||item.score>3){reasons[id]='score out of range';continue;}
    const ev=Array.isArray(item.evidence)?item.evidence:[];
    if(!ev.length){reasons[id]='no evidence cited';continue;}
    const bad=ev.find(e=>!e||typeof e.quote!=='string'||squash(e.quote).length<8||!hay[e.file]?.includes(squash(e.quote)));
    if(bad){reasons[id]='citation does not resolve in the bundle';continue;}
    scores[id]=item.score;reasons[id]=null;
  }
  return {scores,reasons};
}

const cleanEnv=env=>Object.fromEntries(Object.entries(env).filter(([k])=>!/^(?:GH|GITHUB)_TOKEN$/.test(k)));
/**
 * One CLI call in an empty directory with the given environment (an isolated profile in a real run). Claude runs with no tools; Codex has
 * no tool-less mode, so it runs with the same unrestricted sandbox flag as the benchmark arms (the user-namespace sandbox does not start on
 * every host) in an empty directory with a disposable HOME and no GitHub credentials. Returns {value,cost_usd} or {error}.
 */
export async function callModel({agent,model,effort,prompt,schema,timeoutMs=10*60_000,env=null}){
  const dir=newWork();
  try {
    const schemaFile=join(dir,'schema.json'),out=join(dir,'answer.txt');
    writeFileSync(schemaFile,JSON.stringify(schema));
    const args=agent==='claude'
      ?['-p','--output-format','json','--no-session-persistence','--setting-sources','project,local','--tools','','--json-schema',JSON.stringify(schema),
        ...(model?['--model',model]:[]),...(effort?['--effort',effort]:[])]
      :['exec','--ignore-user-config','--sandbox','danger-full-access','--skip-git-repo-check','--ephemeral','--output-schema',schemaFile,'-C',dir,'-o',out,
        ...(model?['-m',model]:[]),...(effort?['--config','model_reasoning_effort='+effort]:[]),'-'];
    let r;
    try {r=await runProcess(agent,args,{cwd:dir,env:{...(env??cleanEnv(process.env)),GIT_TERMINAL_PROMPT:'0'},input:prompt,timeoutMs});}
    catch(e){return {error:'launch failed: '+e.message};}
    if(r.error)return {error:'launch failed: '+r.error.message};
    if(r.timedOut)return {error:'timeout'};
    if(r.status!==0)return {error:'agent exit '+r.status};
    if(agent==='claude'){
      let res;try{res=JSON.parse(r.stdout);}catch{return {error:'malformed output: not JSON'};}
      const value=res.structured_output??parse(res.result);
      return value===null?{error:'malformed output: no JSON answer',cost_usd:num(res.total_cost_usd)}:{value,cost_usd:num(res.total_cost_usd)};
    }
    const value=existsSync(out)?parse(readFileSync(out,'utf8')):null;
    return value===null?{error:'malformed output: no JSON answer',cost_usd:null}:{value,cost_usd:null};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function parse(text){
  if(typeof text!=='string')return null;
  const body=text.trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
  try{const v=JSON.parse(body);return v&&typeof v==='object'?v:null;}catch{return null;}
}

/** Plan which (row, kind, run) calls are needed. Pure and offline: used by the dry run and by --execute. */
export function plan(rows,{runs=2,done=[],rowsFile=null,evidenceRoot=null,agent=null,model=null}={}){
  const jobs=[],skipped=[];
  for(const row of latestAttempts(rows)){
    const tag={result_row_id:row.result_row_id,scenario:row.scenario,arm:row.arm};
    if(row.outcome==='invalid'){skipped.push({...tag,reason:'invalid cell'});continue;}
    const dir=bundleDir(row,{rowsFile,evidenceRoot});
    if(!dir){skipped.push({...tag,reason:'missing evidence bundle'});continue;}
    const bundle=loadBundle(dir);
    if(bundle.missing){skipped.push({...tag,reason:`evidence bundle lacks ${bundle.missing}`});continue;}
    const judgeAgent=agent??(row.agent==='claude'?'codex':'claude');
    for(const kind of ['probe','judge'])for(let run=1;run<=runs;run++){
      if(done.some(d=>d.result_row_id===row.result_row_id&&d.kind===kind&&d.run===run&&d.judge_agent===judgeAgent&&(d.judge_model??null)===(model??null)))continue;
      jobs.push({...tag,kind,run,row,bundle,judge_agent:judgeAgent,same_family:family(judgeAgent,model)===family(row.agent,row.model??row.requested_model)});
    }
  }
  return {jobs,skipped};
}
/** Run one planned call and turn it into a record. Never throws, never imputes. */
export async function execute(job,{model=null,effort=null,call=callModel,env=null}={}){
  const base={schema:JUDGE_SCHEMA,kind:job.kind,result_row_id:job.result_row_id,scenario:job.scenario,arm:job.arm,arm_agent:job.row.agent,
    judge_agent:job.judge_agent,judge_model:model,judge_effort:effort,same_family:job.same_family,run:job.run,date:new Date().toISOString()};
  const req=job.kind==='probe'?probeRequest(job.bundle):judgeRequest(job.bundle);
  const res=await call({agent:job.judge_agent,model,effort,prompt:req.prompt,schema:req.schema,env});
  if(res.error)return {...base,...(job.kind==='probe'?{probe:null}:{scores:null}),reason:res.error,cost_usd:res.cost_usd??null};
  if(job.kind==='probe'){
    const scored=scoreProbe(res.value,job.row.facts??{},JSON.parse(job.bundle.text['checks.json']));
    return scored.error?{...base,probe:null,reason:scored.error,cost_usd:res.cost_usd}:{...base,probe:scored,reason:null,cost_usd:res.cost_usd};
  }
  const v=validateJudge(res.value,job.bundle);
  return {...base,scores:v.scores,null_reasons:v.reasons,reason:v.malformed?'malformed judge output':null,cost_usd:res.cost_usd};
}

if(process.argv[1]?.endsWith('judge-workflow.mjs')){
  try {
    const usage='usage: node benchmarks/judge-workflow.mjs ROWS.jsonl [--execute] [--agent claude|codex] [--model ID] [--effort level] [--runs 2] [--evidence-root DIR] [--out FILE] [--allow-danger-full-access]  (dry run unless --execute)';
    const {values:v,positionals}=parseArgs({options:{execute:{type:'boolean'},agent:{type:'string'},model:{type:'string'},effort:{type:'string'},runs:{type:'string'},'evidence-root':{type:'string'},out:{type:'string'},'allow-danger-full-access':{type:'boolean'}},allowPositionals:true});
    if(positionals.length!==1||(v.agent&&!['claude','codex'].includes(v.agent))||(v.runs&&!/^[1-9]\d*$/.test(v.runs)))throw Error(usage);
    const rowsFile=resolve(positionals[0]),out=resolve(v.out??rowsFile+'.judge.jsonl'),runs=+(v.runs??2);
    const rows=checkRows(readJsonl(rowsFile));
    const done=existsSync(out)?readJsonl(out).filter(x=>x.kind!=='skipped'&&(x.probe||x.scores)):[];
    const {jobs,skipped}=plan(rows,{runs,done,rowsFile,evidenceRoot:v['evidence-root']&&resolve(v['evidence-root']),agent:v.agent,model:v.model});
    for(const s of skipped)console.log(`skip ${s.scenario}/${s.arm} ${s.result_row_id}: ${s.reason}`);
    const shared=jobs.filter(j=>j.same_family);
    console.log(`${jobs.length} judge call(s) planned (${runs} run(s) each of probe and judge per scored cell), ${skipped.length} cell(s) skipped.`);
    if(shared.length)console.log(`WARNING: ${shared.length} call(s) use the same model family as the arm being judged.`);
    if(!v.execute){console.log('Dry run: no calls made. Add --execute to run them (paid).');}
    else {
      // Same preflight and consent as the runner: CLI present, login usable in an isolated profile (or an explicit unisolated approval),
      // and the explicit approval for Codex's unrestricted sandbox. Everything is checked before the first paid call.
      const agents=[...new Set(jobs.map(j=>j.judge_agent))],profiles=new Map(),work=newWork();
      try {
        for(const agent of agents){
          const probe=spawnSync(agent,['--version'],{encoding:'utf8',timeout:15000});
          if(probe.error||probe.status!==0)throw Error(agent+' CLI not found or not runnable; no judge call made');
          const count=jobs.filter(j=>j.judge_agent===agent).length;
          const mode=selectProfileMode(agent,['bare'],{count});
          if(agent==='codex')approveDangerFullAccess({alreadyApproved:v['allow-danger-full-access'],count});
          profiles.set(agent,{mode,profile:makeProfile(agent,'bare',join(work,agent),null,mode,{github:false})});
        }
        for(const s of skipped)appendFileSync(out,JSON.stringify({schema:JUDGE_SCHEMA,kind:'skipped',...s,date:new Date().toISOString()})+'\n');
        for(const job of jobs){
          const rec=await execute(job,{model:v.model??null,effort:v.effort??null,env:profiles.get(job.judge_agent).profile.env});
          appendFileSync(out,JSON.stringify(rec)+'\n');
          console.log(`${rec.kind} ${rec.scenario}/${rec.arm} run ${rec.run}: ${rec.reason??'ok'}`);
        }
      } finally {
        for(const [agent,{mode,profile}] of profiles){try{profile.cleanup();}catch{} try{destroyProfile(join(work,agent),mode);}catch{}}
        rmSync(work,{recursive:true,force:true});
      }
      console.log(out);
    }
  }catch(e){console.error('judge-workflow: '+e.message);process.exitCode=2;}
}
