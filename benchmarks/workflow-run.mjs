#!/usr/bin/env node
/** Paid opt-in, remote GitHub workflow benchmark. No automatic real-repo deletion. */
import { spawn,spawnSync,execFileSync } from 'node:child_process';
import { existsSync,readFileSync,writeFileSync,appendFileSync,mkdirSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { scenarios,ids,prompt } from './workflow/scenarios.mjs';
import { validateOrg,newRepository,seedIssues,seedBrokenPull,cloneRepository,installTicketFlow,
  linkProject,setupEnv,sh,gh,newWork } from './workflow/sandbox.mjs';
import { makeProfile,destroyProfile } from './workflow/profile.mjs';
import { scoreDelivery, projectSnapshot } from './workflow/check.mjs';
import { selectProfileMode,approveDangerFullAccess } from './lib/profile-auth.mjs';
import { validatePluginSource } from './lib/integrity.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(HERE,'..');
const ARMS=new Set(['bare','ticketflow','superpowers','ponytail']);
const EFFORTS=new Set(['low','medium','high','xhigh','max']);
const help='workflow-run --agent claude|codex --model ID --owner DISPOSABLE_ORG --out FILE [--arms bare,ticketflow,superpowers,ponytail] [--scenarios W1,W2,W3,W4,W5,W6,W7] [--repeats 3] [--effort high] [--superpowers-source DIR] [--ponytail-source DIR] [--ticketflow-source DIR] [--resume] [--max-sessions 96] [--execute --allow-github-writes] [--allow-danger-full-access]';
const readJson=(file)=>JSON.parse(readFileSync(file,'utf8'));
const gitSha=(dir)=>sh('git',['rev-parse','HEAD'],{cwd:dir,env:process.env});
const cleanRepo=(dir)=>!sh('git',['status','--porcelain'],{cwd:dir,env:process.env});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const idFor=(p,agent,model,effort,sourceShas,fingerprint)=>JSON.stringify({p,agent,model,effort,sourceShas,fingerprint});
function fingerprint() {
  const hash=createHash('sha256');
  for(const path of ['workflow-run.mjs','workflow/scenarios.mjs','workflow/scenarios-extra.mjs','workflow/sandbox.mjs','workflow/profile.mjs','workflow/check.mjs']) {
    hash.update(path);hash.update('\0');hash.update(readFileSync(join(HERE,path)));
  }
  return hash.digest('hex');
}
const safeOut=(file,data)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(data,null,2)+'\n',{mode:0o600});};
function parse() {
  const {values:v}=parseArgs({options:{
    agent:{type:'string'},model:{type:'string'},owner:{type:'string'},out:{type:'string'},arms:{type:'string'},scenarios:{type:'string'},
    repeats:{type:'string'},effort:{type:'string'},'max-sessions':{type:'string'},'ticketflow-source':{type:'string'},
    'superpowers-source':{type:'string'},'ponytail-source':{type:'string'},'allow-github-writes':{type:'boolean'},
    'allow-danger-full-access':{type:'boolean'},execute:{type:'boolean'},resume:{type:'boolean'},
  }});
  if(!['claude','codex'].includes(v.agent)||!v.model?.trim()||!v.owner?.trim()||!v.out?.trim()) throw Error(help);
  const arms=(v.arms??'bare,ticketflow,superpowers,ponytail').split(',');
  const selected=(v.scenarios??ids.join(',')).split(',');
  const repeats=Number(v.repeats??3),max=Number(v['max-sessions']??96);
  if(new Set(arms).size!==arms.length || arms.some(x=>!ARMS.has(x)) || !arms.length ||
    new Set(selected).size!==selected.length || selected.some(x=>!ids.includes(x)) || !selected.length ||
    !Number.isSafeInteger(repeats)||repeats<1 || !Number.isSafeInteger(max)||max<1 ||
    (v.effort&&!EFFORTS.has(v.effort))) throw Error(help);
  const sources={ticketflow:resolve(v['ticketflow-source']??ROOT)};
  for(const arm of ['superpowers','ponytail']) if(arms.includes(arm)) {
    if(!v[arm+'-source']) throw Error('--'+arm+'-source must point to a pinned native plugin checkout');
    sources[arm]=resolve(v[arm+'-source']);
  }
  for(const [arm,dir] of Object.entries(sources)) {
    if(!existsSync(dir)||!cleanRepo(dir)) throw Error(arm+' source must be an existing clean checkout');
    if(arm!=='ticketflow') validatePluginSource(dir,v.agent,arm);
    else if(!existsSync(join(dir,'core/scripts/runtime.mjs'))) throw Error('TicketFlow runtime not found at '+dir);
  }
  return {v,arms,selected,repeats,max,sources,sourceShas:Object.fromEntries(Object.entries(sources).map(([a,d])=>[a,gitSha(d)])),
    out:resolve(v.out),statePath:resolve(v.out)+'.state.json'};
}
function cliVersion(agent) {
  const r=spawnSync(agent,['--version'],{encoding:'utf8',timeout:12000});
  if(r.status!==0||!r.stdout?.trim()) throw Error(agent+' CLI/version unavailable');
  return r.stdout.trim();
}
function runAgent({agent,model,effort,arm,dir,work,source,mode,message,timeoutMs=35*60_000,interrupt=null}) {
  return new Promise((done,reject)=>{
    let profile;
    try {profile=makeProfile(agent,arm,work,source,mode);}
    catch(e){reject(e);return;}
    const outfile=join(work,'agent-answer-'+Date.now()+'.txt');
    const args=agent==='claude'?['-p',message,'--output-format','json','--no-session-persistence',
      '--setting-sources','project,local',
      '--allowedTools','Read,Edit,Write,Glob,Grep,Task,Agent,Bash(git *),Bash(gh *),Bash(node *),Bash(npm *),Bash(ls *),Bash(cat *)',
      '--model',model,...(effort?['--effort',effort]:[]),...profile.pluginArgs]:
      ['exec','--json',...(arm==='bare'||arm==='ticketflow'?['--ignore-user-config']:[]),'--sandbox','danger-full-access',
        '-C',dir,'-o',outfile,'-m',model,...(effort?['--config','model_reasoning_effort='+effort]:[]),'-'];
    const env={...profile.env,GH_TOKEN:process.env.WORKFLOW_BENCH_AGENT_TOKEN,
      GITHUB_TOKEN:process.env.WORKFLOW_BENCH_AGENT_TOKEN,GIT_TERMINAL_PROMPT:'0'};
    const start=Date.now();let stdout='',stderr='',interrupted=false,reason=null,closed=false;
    let timer,watcher,child;
    const finish=async(code,signal)=>{
      if(closed)return;closed=true;clearTimeout(timer);clearInterval(watcher);
      let cleanupError=null;
      try{profile.cleanup()}catch(e){cleanupError=e.message;}
      if(mode==='isolated')destroyProfile(work,mode);
      const path=join(work,'agent.out.'+start);writeFileSync(path,stdout+'\nSTDERR:\n'+stderr,{mode:0o600});
      const events=stdout.split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);
      let result=null,turns=null,reportedModel=null,cost=null,tokens=null;
      if(agent==='claude'){
        result=events.findLast(e=>e.type==='result')??( ()=>{try{return JSON.parse(stdout)}catch{return null}})();
        turns=result?.num_turns??null;reportedModel=Object.keys(result?.modelUsage??{}).join(',')||null;
        cost=typeof result?.total_cost_usd==='number'?result.total_cost_usd:null;tokens=result?.usage??null;
      } else {
        const ends=events.filter(e=>e.type==='turn.completed');
        tokens=ends.length?ends.reduce((a,e)=>{for(const [k,v] of Object.entries(e.usage??{}))a[k]=(a[k]??0)+v;return a},{}):null;
      }
      done({exit:code,signal,interrupted,reason,seconds:(Date.now()-start)/1000,
        cost_usd:cost,tokens,turns,observed_model:reportedModel,transcript:path,cleanup_error:cleanupError});
    };
    try {
      child=spawn(agent,args,{cwd:dir,env,stdio:['pipe','pipe','pipe']});
      if(agent==='codex') child.stdin.end(message);else child.stdin.end();
      child.stdout.on('data',v=>{stdout+=v.toString();if(stdout.length>40_000_000)child.kill('SIGTERM')});
      child.stderr.on('data',v=>{stderr+=v.toString();if(stderr.length>10_000_000)child.kill('SIGTERM')});
      child.on('error',e=>{stderr+='\n'+e.message;finish(null,'error')});
      child.on('close',(code,signal)=>finish(code,signal));
      timer=setTimeout(()=>{reason='timeout';child.kill('SIGTERM')},timeoutMs);
      if(interrupt) watcher=setInterval(async()=>{
        if(closed||interrupted)return;
        try{
          if(await interrupt()) {
            interrupted=true;reason='remote checkpoint reached';child.kill('SIGTERM');
          }
        }catch(e){stderr+='\ncheckpoint probe: '+e.message}
      },2500);
    } catch(e) {
      try{profile.cleanup()}catch{}
      reject(e);
    }
  });
}
const mergeUsage=parts=>{
  const cost=parts.every(p=>typeof p.cost_usd==='number')?parts.reduce((x,p)=>x+p.cost_usd,0):null;
  return {cost_usd:cost,wall_s:parts.reduce((x,p)=>x+p.seconds,0),tokens:parts.map(p=>p.tokens),
    turns:parts.every(p=>typeof p.turns==='number')?parts.reduce((x,p)=>x+p.turns,0):null,
    model:parts.map(p=>p.observed_model).filter(Boolean).join(',')||null};
};
async function runCell(x,opts,state,mode,version,evalFingerprint) {
  const {v,sources,out,statePath}=opts,cell=state.cells[x.key]??{};
  const work=cell.work??newWork(),repo=cell.repo??v.owner+'/tfwf-'+state.runId+'-'+x.id.toLowerCase()+'-'+x.arm+'-'+x.repeat;
  if(!cell.repo) {
    state.cells[x.key]={repo,work,phase:'creating',projectTitle:'Workflow '+state.runId+' '+x.id+' '+x.arm+' '+x.repeat};
    safeOut(statePath,state);
    newRepository({repo,id:x.id,work});
    state.cells[x.key].phase='repository-created';safeOut(statePath,state);
  }
  const current=state.cells[x.key];
  if(current.phase==='creating') throw Error('Repository creation interrupted: inspect '+repo+' before resuming');
  if(!current.project) {
    current.project=linkProject({repo,owner:v.owner,title:current.projectTitle});
    safeOut(statePath,state);
  }
  if(!current.issues) {
    current.issues=seedIssues({repo,id:x.id,projectId:current.project.id});
    safeOut(statePath,state);
  }
  if(x.arm==='ticketflow'&&!current.installed) {
    const tmp=join(work,'base');const dir=cloneRepository(repo,tmp);
    installTicketFlow({repo,dir,source:sources.ticketflow,agent:v.agent,owner:v.owner,
      projectNumber:current.project.number,title:current.projectTitle,issues:current.issues});
    current.installed=true;safeOut(statePath,state);
  }
  if(x.id==='W4'&&!current.initialPR) {
    current.initialPR=seedBrokenPull({repo,id:x.id,work,issue:current.issues[0]});
    const initial=JSON.parse(sh('gh',['api','repos/'+repo+'/pulls/'+current.initialPR]));
    current.initialHead=initial.head?.sha??null;
    safeOut(statePath,state);
  }
  // Check the restricted agent token can see and write this newly-created fixture.
  // Setup-token permissions must never be silently substituted for agent permissions.
  const agentEnv={...process.env,GH_TOKEN:process.env.WORKFLOW_BENCH_AGENT_TOKEN,
    GITHUB_TOKEN:process.env.WORKFLOW_BENCH_AGENT_TOKEN};
  const access=JSON.parse(sh('gh',['api','repos/'+repo],{env:agentEnv}));
  if(access.permissions?.push!==true)throw Error('agent token lacks push access to '+repo+'; no paid agent invoked');
  const actions=JSON.parse(sh('gh',['api','repos/'+repo+'/actions/permissions'],{env:setupEnv()}));
  if(!actions.enabled)throw Error('GitHub Actions is disabled for '+repo+'; no paid agent invoked');
  try {sh('gh',['project','view',String(current.project.number),'--owner',v.owner,'--format','json'],{env:agentEnv});}
  catch(e){throw Error('agent token cannot read benchmark Project '+current.project.number+'; no paid agent invoked: '+e.message);}

  // Capture post-bootstrap, pre-agent Project state. Setup itself must never count as agent work.
  if(!current.baselineProjects) {
    current.baselineProjects=current.issues.map(n=>({number:n,project:projectSnapshot(repo,n)}));
    safeOut(statePath,state);
  }
  // Initial branch and issue state is prepared before the paid agent run.
  const dir=cloneRepository(repo,join(work,'attempt-'+Date.now()));
  const initial=prompt(x.id,repo,current.issues,current.initialPR??null,
    'https://github.com/orgs/'+v.owner+'/projects/'+current.project.number);
  const source=sources[x.arm]??null,parts=[];
  let interrupted=false;
  if(x.id==='W5') {
    const first=runAgent({agent:v.agent,model:v.model,effort:v.effort,arm:x.arm,dir,work,source,mode,message:initial,
      timeoutMs:15*60_000,interrupt:async()=>{
        const branches=JSON.parse(gh(['api','repos/'+repo+'/branches?per_page=100']));
        return branches.some(b=>b.name!=='main');
      }});
    parts.push(await first);
    interrupted=parts[0].interrupted;
    if(interrupted) {
      // A clean, separately cloned context proves recovery from remote GitHub state.
      const fresh=cloneRepository(repo,join(work,'resumed'));
      parts.push(await runAgent({agent:v.agent,model:v.model,effort:v.effort,arm:x.arm,dir:fresh,work,
        source,mode,message:'The previous session was interrupted. Recover the state from GitHub and resume without duplicating issues or pull requests.\n\n'+initial}));
    }
  } else parts.push(await runAgent({agent:v.agent,model:v.model,effort:v.effort,arm:x.arm,dir,work,source,mode,message:initial}));
  const result=scoreDelivery({repo,id:x.id,issues:current.issues,interrupted,
    initialPR:current.initialPR??null,initialHead:current.initialHead??null,
    baselineProjects:current.baselineProjects??[]});
  const metrics=mergeUsage(parts);
  const row={
    suite:'workflow',scenario:x.id,agent:v.agent,agent_version:version,requested_model:v.model,
    model:metrics.model,requested_effort:v.effort??null,arm:x.arm,variant:x.arm,repeat:x.repeat,
    eval_fingerprint:evalFingerprint,source_sha:opts.sourceShas[x.arm]??null,
    ticketflow_sha:x.arm==='ticketflow'?opts.sourceShas.ticketflow:null,plugin_sha:['superpowers','ponytail'].includes(x.arm)?opts.sourceShas[x.arm]:null,
    evaluation_mode:'non-adversarial',profile_isolation:mode,
    sandbox_mode:v.agent==='codex'?'danger-full-access':'not-applicable',
    profile_cleanup:parts.some(p=>p.cleanup_error)?'failed':'ok',
    check:{pass:result.pass&&parts.at(-1).exit===0&&parts.every(p=>!p.cleanup_error),why:result.error??result.hidden_why??''},
    delivery:result,invocations:parts,interrupted,agent_exit:parts.at(-1).exit,
    ...metrics,workdir:work,repo,date:new Date().toISOString(),descendants:'unknown'
  };
  appendFileSync(out,JSON.stringify(row)+'\n',{mode:0o600});
  current.phase='completed';safeOut(statePath,state);
  if(parts.some(p=>p.cleanup_error)) throw Error('benchmark plugin cleanup failed; stop and inspect original profile');
  return row;
}
async function main() {
  const opts=parse(),{v,arms,selected,repeats,max,out,statePath,sourceShas}=opts,evalFingerprint=fingerprint();
  const plan=[];
  for(let rep=1;rep<=repeats;rep++)for(const [i,id] of selected.entries()){
    const rotated=arms.map((_,k)=>arms[(k+i+rep-1)%arms.length]);
    for(const arm of rotated) plan.push({id,arm,repeat:rep,key:id+'|'+arm+'|'+rep});
  }
  const stamp=idFor(plan,v.agent,v.model,v.effort??null,sourceShas,evalFingerprint);
  const state=v.resume?readJson(statePath):null;
  if(state && state.signature!==stamp)throw Error('resume options, evaluator or source revisions changed');
  if(!v.resume && (existsSync(out)||existsSync(statePath)))throw Error('output already exists: use --resume or new output');
  const rows=v.resume&&existsSync(out)?readFileSync(out,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
  const completed=new Set(rows.map(r=>r.scenario+'|'+r.arm+'|'+r.repeat));
  const pending=plan.filter(x=>!completed.has(x.key));
  console.log(JSON.stringify({mode:v.execute?'PAID REMOTE GITHUB':'DRY RUN',agent:v.agent,model:v.model,effort:v.effort??null,
    owner:v.owner,scenarios:selected,arms,repeats,total_cells:plan.length,completed:completed.size,pending:pending.length,
    maximum_paid_invocations:pending.reduce((n,p)=>n+(p.id==='W5'?2:1),0),
    sourceShas,projects:'independent disposable Project per session',output:out},null,2));
  if(!v.execute){for(const p of pending)console.log('PLAN '+p.key);return}
  if(!v['allow-github-writes'])throw Error('--allow-github-writes required: creates private repos, real issues, Projects v2, PRs and Actions runs');
  const invocationCeiling=pending.reduce((n,p)=>n+(p.id==='W5'?2:1),0);
  if(invocationCeiling>max)throw Error(invocationCeiling+' possible paid invocations exceeds --max-sessions '+max+' (W5 can require two invocations)');
  if(!process.env.WORKFLOW_BENCH_SETUP_TOKEN||!process.env.WORKFLOW_BENCH_AGENT_TOKEN)throw Error('Use dedicated WORKFLOW_BENCH_SETUP_TOKEN and WORKFLOW_BENCH_AGENT_TOKEN in a disposable GitHub organization');
  validateOrg(v.owner);const version=cliVersion(v.agent);
  if(rows.some(r=>r.agent_version!==version||r.eval_fingerprint!==evalFingerprint))throw Error('CLI or evaluator version changed; cannot resume');
  if(v.agent==='codex')approveDangerFullAccess({alreadyApproved:v['allow-danger-full-access'],count:pending.reduce((n,p)=>n+(p.id==='W5'?2:1),0)});
  const mode=selectProfileMode(v.agent,arms,{count:pending.length});
  if(rows.some(r=>r.profile_isolation!==mode))throw Error('resume cannot mix isolated and unisolated profiles');
  const runState=state??{signature:stamp,runId:Date.now().toString(36),projectTitle:null,projectNumber:null,cells:{}};
  safeOut(statePath,runState);
  for(const [i,cell] of pending.entries()){
    console.log('SESSION '+(i+1)+'/'+pending.length+' '+cell.key);
    const row=await runCell(cell,opts,runState,mode,version,evalFingerprint);
    console.log('RESULT '+cell.key+' '+(row.check.pass?'PASS':'FAIL')+' '+JSON.stringify(row.delivery.steps));
  }
}
main().catch(e=>{console.error('workflow-run: '+e.message);process.exitCode=2});
