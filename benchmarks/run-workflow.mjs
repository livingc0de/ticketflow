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
import { scoreDelivery, projectSnapshot, meaningfulCheckpoint } from './workflow/check.mjs';
import { selectProfileMode,approveDangerFullAccess } from './lib/profile-auth.mjs';
import { validatePluginSource,validateSourceCheckout } from './lib/integrity.mjs';
import { archiveSession,readOrCreateAnswer,transcriptSessionId } from './lib/transcripts.mjs';
import { terminateProcess } from './lib/process.mjs';
import { classifyOutcome, outcomeOf } from './workflow/outcome.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(HERE,'..');
const ARMS=new Set(['bare','ticketflow','superpowers','ponytail']);
const EFFORTS=new Set(['low','medium','high','xhigh','max']);
const help='run-workflow --agent claude|codex --model ID --owner DISPOSABLE_ORG --out FILE [--arms bare,ticketflow,superpowers,ponytail] [--scenarios W1,W2,W3,W4,W5,W6,W7] [--repeats 3] [--effort high] [--superpowers-source DIR --superpowers-sha SHA] [--ponytail-source DIR --ponytail-sha SHA] [--ticketflow-source DIR --ticketflow-sha SHA] [--resume] [--acknowledge-plugin-cleanup] [--execute --allow-github-writes] [--allow-danger-full-access]';
const readJson=(file)=>JSON.parse(readFileSync(file,'utf8'));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const cellKey=(cell)=>cell.id+'|'+cell.arm+'|'+cell.repeat;
const identityFor=({owner,agent,model,effort,sourceShas,sourceMeta,fingerprint})=>({owner,agent,model,effort,sourceShas,sourceMeta,fingerprint});
const idFor=(schedule,identity)=>JSON.stringify({p:schedule,...identity});
const sameJson=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sourceSubset=(previous,current)=>Object.entries(previous??{}).every(([name,value])=>sameJson(current?.[name],value));
const armSet=(schedule)=>new Set(schedule.map(cell=>cell.arm));
const mergeSchedule=(previous,requested)=>{
  const merged=[],seen=new Map();
  for(const cell of [...previous,...requested]){
    const key=cellKey(cell);
    if(seen.has(key)){
      if(!sameJson(seen.get(key),cell))throw Error('resume schedule contains conflicting cell definitions; use a new output/state pair');
      continue;
    }
    seen.set(key,cell);merged.push({...cell,key});
  }
  return merged;
};
const validSchedule=(schedule)=>Array.isArray(schedule)&&schedule.every(cell=>cell&&ids.includes(cell.id)&&ARMS.has(cell.arm)&&
  Number.isSafeInteger(cell.repeat)&&cell.repeat>0&&cell.key===cellKey(cell));
const ownerFromState=(state)=>{
  const owners=new Set(Object.values(state.cells??{}).map(cell=>typeof cell.repo==='string'?cell.repo.split('/')[0]:null).filter(Boolean));
  return owners.size===1?[...owners][0]:null;
};
const previousRun=(state)=>{
  if(Array.isArray(state.schedule)&&state.identity){
    if(!validSchedule(state.schedule))throw Error('resume state has an invalid schedule; use a new output/state pair');
    return {schedule:state.schedule,identity:state.identity};
  }
  let parsed;
  try{parsed=JSON.parse(state.signature)}catch{throw Error('resume state has an invalid signature; use a new output/state pair');}
  if(!validSchedule(parsed?.p))throw Error('resume state has no valid schedule; use a new output/state pair');
  const owner=parsed.owner??ownerFromState(state);
  if(!owner)throw Error('resume state owner cannot be verified; reconcile it or use a new output/state pair');
  return {schedule:parsed.p,identity:identityFor({...parsed,owner})};
};
const compatibleIdentity=(previous,current)=>{
  if(previous.owner!==current.owner||previous.agent!==current.agent||previous.model!==current.model||
      (previous.effort??null)!==(current.effort??null)||previous.fingerprint!==current.fingerprint)
    throw Error('resume immutable options, evaluator or owner changed');
  if(!sourceSubset(previous.sourceShas,current.sourceShas)||!sourceSubset(previous.sourceMeta,current.sourceMeta))
    throw Error('resume source revisions or provenance changed');
};
const compatibleArms=(previousSchedule,currentSchedule)=>{
  const previousArms=armSet(previousSchedule),currentArms=armSet(currentSchedule);
  for(const arm of previousArms)if(!currentArms.has(arm))throw Error('resume cannot remove an existing arm; use a new output/state pair');
};
const planFor=(selected,arms,repeats)=>{
  const plan=[];
  for(let rep=1;rep<=repeats;rep++)for(const [i,id] of selected.entries()){
    const rotated=arms.map((_,k)=>arms[(k+i+rep-1)%arms.length]);
    for(const arm of rotated)plan.push({id,arm,repeat:rep,key:id+'|'+arm+'|'+rep});
  }
  return plan;
};
function fingerprint() {
  const hash=createHash('sha256');
  for(const path of ['run-workflow.mjs','workflow/scenarios.mjs','workflow/scenarios-extra.mjs','workflow/sandbox.mjs','workflow/profile.mjs','workflow/check.mjs','workflow/outcome.mjs','lib/integrity.mjs','lib/profile-auth.mjs','lib/process.mjs','lib/transcripts.mjs']) {
    hash.update(path);hash.update('\0');hash.update(readFileSync(join(HERE,path)));
  }
  return hash.digest('hex');
}
const safeOut=(file,data)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(data,null,2)+'\n',{mode:0o600});};
function parse() {
  const {values:v}=parseArgs({options:{
    agent:{type:'string'},model:{type:'string'},owner:{type:'string'},out:{type:'string'},arms:{type:'string'},scenarios:{type:'string'},
    repeats:{type:'string'},effort:{type:'string'},'max-sessions':{type:'string'},'ticketflow-source':{type:'string'},
    'superpowers-source':{type:'string'},'ponytail-source':{type:'string'},'ticketflow-sha':{type:'string'},
    'superpowers-sha':{type:'string'},'ponytail-sha':{type:'string'},'allow-github-writes':{type:'boolean'},
    'allow-danger-full-access':{type:'boolean'},'acknowledge-plugin-cleanup':{type:'boolean'},execute:{type:'boolean'},resume:{type:'boolean'},
  }});
  if(!['claude','codex'].includes(v.agent)||!v.model?.trim()||!v.owner?.trim()||!v.out?.trim()) throw Error(help);
  const arms=(v.arms??'bare,ticketflow,superpowers,ponytail').split(',');
  const selected=(v.scenarios??ids.join(',')).split(',');
  const repeats=Number(v.repeats??3),max=Number(v['max-sessions']??96);
  if(new Set(arms).size!==arms.length || arms.some(x=>!ARMS.has(x)) || !arms.length ||
    new Set(selected).size!==selected.length || selected.some(x=>!ids.includes(x)) || !selected.length ||
    !Number.isSafeInteger(repeats)||repeats<1 || !Number.isSafeInteger(max)||max<1 ||
    (v.effort&&!EFFORTS.has(v.effort))) throw Error(help);
  const sources={};
  if(arms.includes('ticketflow')) sources.ticketflow=resolve(v['ticketflow-source']??ROOT);
  for(const arm of ['superpowers','ponytail']) if(arms.includes(arm)) {
    if(!v[arm+'-source']) throw Error('--'+arm+'-source must point to a pinned native plugin checkout');
    sources[arm]=resolve(v[arm+'-source']);
  }
  const sourceMeta={};
  for(const [arm,dir] of Object.entries(sources)) {
    if(!existsSync(dir)) throw Error(arm+' source must be an existing clean checkout');
    const expectedRemote=arm==='ticketflow'?'https://github.com/livingc0de/ticketflow':null;
    sourceMeta[arm]=validateSourceCheckout(dir,{name:arm,expectedSha:v[arm+'-sha']??null,expectedRemote});
    if(arm!=='ticketflow') validatePluginSource(dir,v.agent,arm);
    else if(!existsSync(join(dir,'core/scripts/runtime.mjs'))) throw Error('TicketFlow runtime not found at '+dir);
  }
  return {v,arms,selected,repeats,max,sources,sourceMeta,sourceShas:Object.fromEntries(Object.entries(sourceMeta).map(([a,m])=>[a,m.sha])),
    out:resolve(v.out),statePath:resolve(v.out)+'.state.json'};
}
function cliVersion(agent) {
  const r=spawnSync(agent,['--version'],{encoding:'utf8',timeout:12000});
  if(r.status!==0||!r.stdout?.trim()) throw Error(agent+' CLI/version unavailable');
  return r.stdout.trim();
}
function requireClaudePluginDir() {
  const r=spawnSync('claude',['--help'],{encoding:'utf8',timeout:12000});
  if(r.status!==0||!r.stdout?.includes('--plugin-dir')) throw Error('Claude CLI does not advertise --plugin-dir; cannot load competitor natively');
}
function requireCodexPonytailHooks() {
  const r=spawnSync('codex',['exec','--help'],{encoding:'utf8',timeout:12000});
  if(r.status!==0||!(r.stdout+'\n'+r.stderr).includes('--dangerously-bypass-hook-trust'))
    throw Error('Codex exec does not advertise --dangerously-bypass-hook-trust; Ponytail lifecycle hooks cannot be enabled noninteractively');
}
function runAgent({agent,model,effort,arm,dir,work,source,mode,message,timeoutMs=35*60_000,interrupt=null,archiveRoot=null,archiveMeta={}}) {
  return new Promise((done,reject)=>{
    let profile;
    try {profile=makeProfile(agent,arm,work,source,mode);}
    catch(e){reject(e);return;}
    const outfile=join(work,'agent-answer-'+Date.now()+'.txt');
    const args=agent==='claude'?['-p',message,'--output-format','json','--no-session-persistence',
      '--setting-sources','project,local',
      '--allowedTools','Read,Edit,Write,Glob,Grep,Task,Agent,Bash(git *),Bash(gh *),Bash(node *),Bash(npm *),Bash(npx *),Bash(ls *),Bash(cat *),Bash(rg *),Bash(find *),Bash(pwd),Bash(mkdir *),Bash(sed *),Bash(jq *),Bash(cp *),Bash(mv *),Bash(printf *),Bash(chmod *)',
      '--model',model,...(effort?['--effort',effort]:[]),...profile.pluginArgs]:
      ['exec','--json',...(arm==='ponytail'?['--dangerously-bypass-hook-trust']:[]),...(arm==='bare'||arm==='ticketflow'?['--ignore-user-config']:[]),'--sandbox','danger-full-access',
        '-C',dir,'-o',outfile,'-m',model,...(effort?['--config','model_reasoning_effort='+effort]:[]),'-'];
    const env={...profile.env,GH_TOKEN:process.env.WORKFLOW_BENCH_AGENT_TOKEN,
      GITHUB_TOKEN:process.env.WORKFLOW_BENCH_AGENT_TOKEN,GIT_TERMINAL_PROMPT:'0'};
    const start=Date.now();let stdout='',stderr='',interrupted=false,reason=null,closed=false,probing=false;
    let childError=null,stdinError=null;
    let timer,watcher,child,clearEscalation;
    const stop=()=>{
      if(!child?.pid||closed||clearEscalation)return;
      clearEscalation=terminateProcess(child,{onEscalate:()=>{stderr+='\nprocess group escalated to SIGKILL'}});
    };
    const finish=async(code,signal)=>{
      if(closed)return;closed=true;clearTimeout(timer);clearInterval(watcher);clearEscalation?.();
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
      const answer=agent==='claude'?(result?.result??''):readOrCreateAnswer(outfile,'[No answer was produced by the agent before this invocation ended.]\n');
      // An interrupted Codex invocation can exit before creating -o's file. Keep
      // the transcript archiveable so a successful W5 recovery remains valid.
      if(agent==='claude')writeFileSync(outfile,answer,{mode:0o600});
      const external=['superpowers','ponytail'].includes(arm);
      const evidence=profile.nativePluginEvidence??(agent==='claude'&&external?'claude-plugin-dir':null);
      const plugin_bootstrap=external?{status:evidence?(agent==='claude'||arm==='ponytail'?'loaded':'verified'):'failed',evidence:evidence??'native-plugin-loading-failed'}:null;
      let archive=null,archive_error=null;
      if(archiveRoot){
        try{archive=archiveSession({root:archiveRoot,sessionId:transcriptSessionId('workflow',archiveMeta),agentOut:path,answerFile:outfile,
          metadata:{...archiveMeta,agent,model:reportedModel,requested_model:model,arm,agent_exit:code,signal,interrupted,reason,
            status:interrupted?'interrupted':code===0?'completed':'failed',plugin_bootstrap,timestamp:new Date().toISOString()}})}
        catch(e){archive_error=e.message;}
      }
      const errorInfo=e=>e?{code:e.code??null,message:e.message}:null;
      done({exit:code,signal,interrupted,reason,seconds:(Date.now()-start)/1000,
        cost_usd:cost,tokens,turns,observed_model:reportedModel,transcript:path,answer:answer,
        archive,archive_error,plugin_bootstrap,cleanup_error:cleanupError,
        error:childError?.message??null,stdin_error:errorInfo(stdinError)});
    };
    try {
      child=spawn(agent,args,{cwd:dir,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
      child.stdin.once('error',e=>{stdinError??=e;stderr+='\nstdin: '+e.message});
      child.stdout.on('data',v=>{stdout+=v.toString();if(stdout.length>40_000_000)stop()});
      child.stderr.on('data',v=>{stderr+=v.toString();if(stderr.length>10_000_000)stop()});
      child.once('error',e=>{childError??=e;stderr+='\n'+e.message});
      child.once('close',(code,signal)=>finish(code,childError?'error':signal));
      try { if(agent==='codex') child.stdin.end(message);else child.stdin.end(); }
      catch(e) { stdinError??=e;stderr+='\nstdin: '+e.message; }
      timer=setTimeout(()=>{reason='timeout';stop()},timeoutMs);
      if(interrupt) watcher=setInterval(async()=>{
        if(closed||interrupted||probing)return;
        probing=true;
        try{
          const ready=await interrupt();
          if(!closed&&ready) {
            interrupted=true;reason='remote checkpoint reached';stop();
          }
        }catch(e){stderr+='\ncheckpoint probe: '+e.message}
        finally{probing=false}
      },2000);
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
  const {v,sources,out,statePath}=opts;
  const previous=opts.latestRows?.get(x.key);
  // Retry a discarded measurement in a fresh repo. Never contaminate a retry
  // with a failed attempt's remote state or overwrite its original transcript.
  if(previous&&outcomeOf(previous)==='invalid'&&
      state.cells[x.key]?.result_row_id===previous.result_row_id){
    (state.retired_cells??=[]).push({key:x.key,...state.cells[x.key]});
    state.cells[x.key]={attempt:(previous.attempt??1)+1,retry_of:previous.result_row_id};
    safeOut(statePath,state);
  }
  const cell=state.cells[x.key]??{};
  const rowId=cell.result_row_id??`workflow:${x.key}:attempt-${cell.attempt??1}:${Date.now().toString(36)}`;
  if(!cell.result_row_id){cell.result_row_id=rowId;safeOut(statePath,state);}
  const archiveRoot=resolve(process.env.BENCHMARK_TRANSCRIPTS_DIR??join(ROOT,'benchmarks/results/transcripts'));
  const work=cell.work??newWork(),repo=cell.repo??v.owner+'/tfwf-'+state.runId+'-'+x.id.toLowerCase()+'-'+x.arm+'-'+x.repeat+(cell.attempt>1?'-retry'+cell.attempt:'');
  if(!cell.repo) {
    state.cells[x.key]={...cell,repo,work,phase:'creating',result_row_id:rowId,projectTitle:'Workflow '+state.runId+' '+x.id+' '+x.arm+' '+x.repeat+(cell.attempt>1?' retry '+cell.attempt:'')};
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
  if(current.phase==='agent-running')throw Error('previous paid session may still be active; inspect remote state before resume for '+repo);
  current.phase='agent-running';safeOut(statePath,state);
  const dir=cloneRepository(repo,join(work,'attempt-'+Date.now()));
  const initial=prompt(x.id,repo,current.issues,current.initialPR??null,
    'https://github.com/orgs/'+v.owner+'/projects/'+current.project.number);
  // All arms receive the same early remote-checkpoint instruction in W5.
  const stagedPrompt=x.id==='W5'?initial+
    '\n\nFor the deliberate interruption test, push meaningful src/ or test/ changes to a remote feature branch early. Keep working on verification but do not merge during this first session; recovery and merging belong to the fresh resumed session.':initial;
  const source=sources[x.arm]??null,parts=[];
  let interrupted=false;
  if(x.id==='W5') {
    const first=runAgent({agent:v.agent,model:v.model,effort:v.effort,arm:x.arm,dir,work,source,mode,message:stagedPrompt,archiveRoot,
      archiveMeta:{scenario:x.id,repeat:x.repeat,result_row_id:rowId,eval_fingerprint:evalFingerprint,source_sha:opts.sourceShas[x.arm]??null,
        ticketflow_sha:x.arm==='ticketflow'?opts.sourceShas.ticketflow:null,plugin_sha:['superpowers','ponytail'].includes(x.arm)?opts.sourceShas[x.arm]:null},
      timeoutMs:15*60_000,interrupt:async()=>{
        const branches=JSON.parse(gh(['api','repos/'+repo+'/branches?per_page=100']));
        const prs=JSON.parse(gh(['pr','list','-R',repo,'--state','all','--json','mergedAt,number','--limit','100']));
        if(prs.some(p=>p.mergedAt))return false;
        const compares={};
        for(const branch of branches.filter(b=>b.name!=='main')){
          compares[branch.name]=JSON.parse(gh(['api','repos/'+repo+'/compare/main...'+encodeURIComponent(branch.name)]));
        }
        return meaningfulCheckpoint({branches,prs,compares});
      }});
    parts.push(await first);
    interrupted=parts[0].interrupted;
    if(interrupted) {
      // A clean, separately cloned context proves recovery from remote GitHub state.
      const fresh=cloneRepository(repo,join(work,'resumed'));
      parts.push(await runAgent({agent:v.agent,model:v.model,effort:v.effort,arm:x.arm,dir:fresh,work,archiveRoot,
        archiveMeta:{scenario:x.id,repeat:x.repeat,result_row_id:rowId,eval_fingerprint:evalFingerprint,source_sha:opts.sourceShas[x.arm]??null,
          ticketflow_sha:x.arm==='ticketflow'?opts.sourceShas.ticketflow:null,plugin_sha:['superpowers','ponytail'].includes(x.arm)?opts.sourceShas[x.arm]:null},
        source,mode,message:'The previous session was interrupted. Recover the state from GitHub and resume without duplicating issues or pull requests.\n\n'+initial}));
    }
  } else parts.push(await runAgent({agent:v.agent,model:v.model,effort:v.effort,arm:x.arm,dir,work,source,mode,message:initial,archiveRoot,
    archiveMeta:{scenario:x.id,repeat:x.repeat,result_row_id:rowId,eval_fingerprint:evalFingerprint,source_sha:opts.sourceShas[x.arm]??null,
      ticketflow_sha:x.arm==='ticketflow'?opts.sourceShas.ticketflow:null,plugin_sha:['superpowers','ponytail'].includes(x.arm)?opts.sourceShas[x.arm]:null}}));
  const result=scoreDelivery({repo,id:x.id,issues:current.issues,interrupted,resumed:interrupted&&parts.length===2&&parts[1].exit===0,
    initialPR:current.initialPR??null,initialHead:current.initialHead??null,
    baselineProjects:current.baselineProjects??[]});
  const metrics=mergeUsage(parts);
  const plugin_bootstrap=parts.some(p=>p.plugin_bootstrap?.status==='failed')?{status:'failed',evidence:'one-or-more-invocations-failed'}:
    parts.length>0&&parts.every(p=>p.plugin_bootstrap?.status==='loaded')?{status:'loaded',evidence:v.agent==='claude'?'all-claude-plugin-dir-loads':'all-codex-plugin-hook-bypass-loads'}:
    parts.length>0&&parts.every(p=>p.plugin_bootstrap?.status==='verified')?{status:'verified',evidence:'all-codex-plugin-list-loads'}:
    parts.some(p=>p.plugin_bootstrap)?{status:'unknown',evidence:'native-plugin-loading-unobserved'}:null;
  const profile_cleanup=parts.some(p=>p.cleanup_error)?'failed':'ok';
  const outcome=classifyOutcome({delivery:result,invocations:parts,plugin_bootstrap,profile_cleanup});
  const row={
    suite:'workflow',scenario:x.id,agent:v.agent,agent_version:version,requested_model:v.model,
    model:metrics.model,requested_effort:v.effort??null,arm:x.arm,variant:x.arm,repeat:x.repeat,
    eval_fingerprint:evalFingerprint,source_sha:opts.sourceShas[x.arm]??null,
    ticketflow_sha:x.arm==='ticketflow'?opts.sourceShas.ticketflow:null,plugin_sha:['superpowers','ponytail'].includes(x.arm)?opts.sourceShas[x.arm]:null,
    evaluation_mode:'non-adversarial',profile_isolation:mode,
    sandbox_mode:v.agent==='codex'?'danger-full-access':'not-applicable',
    profile_cleanup,outcome:outcome.status,invalid_reasons:outcome.invalid_reasons,
    attempt:cell.attempt??1,retry_of:cell.retry_of??null,
    check:{pass:outcome.status==='success',why:outcome.status==='invalid'?
      'invalid benchmark attempt: '+outcome.invalid_reasons.join(', '):
      result.error??result.hidden_why??''},
    delivery:result,invocations:parts,interrupted,agent_exit:parts.at(-1).exit,result_row_id:rowId,
    source_provenance:opts.sourceMeta[x.arm]??null,transcript_archives:parts.map(p=>p.archive).filter(Boolean),
    plugin_bootstrap,
    ...metrics,workdir:work,repo,date:new Date().toISOString(),descendants:'unknown'
  };
  appendFileSync(out,JSON.stringify(row)+'\n',{mode:0o600});
  current.phase='completed';safeOut(statePath,state);
  if(parts.some(p=>p.cleanup_error)) throw Error('benchmark plugin cleanup failed; stop and inspect original profile');
  return row;
}
async function main() {
  const opts=parse(),{v,arms,selected,repeats,max,out,statePath,sourceShas,sourceMeta}=opts;
  const evalFingerprint=fingerprint();
  const plan=planFor(selected,arms,repeats),identity=identityFor({owner:v.owner,agent:v.agent,model:v.model,
    effort:v.effort??null,sourceShas,sourceMeta,fingerprint:evalFingerprint});
  const state=v.resume?readJson(statePath):null;
  const prior=state?previousRun(state):null;
  if(prior){
    compatibleIdentity(prior.identity,identity);
    compatibleArms(prior.schedule,plan);
  }
  const schedule=prior?mergeSchedule(prior.schedule,plan):plan;
  if(!v.resume && (existsSync(out)||existsSync(statePath)))throw Error('output already exists: use --resume or new output');
  const rows=v.resume&&existsSync(out)?readFileSync(out,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
  const rowMatches=(row)=>row.agent===v.agent&&row.requested_model===v.model&&
    (row.requested_effort??null)===(v.effort??null)&&row.eval_fingerprint===evalFingerprint&&
    (row.source_sha??null)===(sourceShas[row.arm]??null);
  if(rows.some(row=>!rowMatches(row)))throw Error('resume output contains rows from a different agent, model, evaluator or source revision');
  const latestRows=new Map();
  for(const r of rows)latestRows.set(r.scenario+'|'+r.arm+'|'+r.repeat,r);
  const requestedKeys=new Set(plan.map(cell=>cell.key));
  const completed=new Set([...latestRows].filter(([key,r])=>requestedKeys.has(key)&&outcomeOf(r)!=='invalid').map(([key])=>key));
  const validKeys=new Set([...latestRows].filter(([,r])=>outcomeOf(r)!=='invalid').map(([key])=>key));
  const pending=plan.filter(x=>!completed.has(x.key));
  const scheduledKeys=new Set(schedule.map(cell=>cell.key));
  const newCells=plan.filter(cell=>!prior||!prior.schedule.some(old=>old.key===cell.key)).length;
  const deferred=schedule.filter(cell=>!requestedKeys.has(cell.key)&&!validKeys.has(cell.key)).length;
  opts.latestRows=latestRows;
  console.log(JSON.stringify({mode:v.execute?'PAID REMOTE GITHUB':'DRY RUN',agent:v.agent,model:v.model,effort:v.effort??null,
    owner:v.owner,scenarios:selected,arms,repeats,total_cells:plan.length,scheduled_cells:scheduledKeys.size,new_cells:newCells,
    completed:completed.size,pending:pending.length,deferred,
    invalid_to_retry:pending.filter(x=>outcomeOf(latestRows.get(x.key)??{})==='invalid').length,
    maximum_paid_invocations:pending.reduce((n,p)=>n+(p.id==='W5'?2:1),0),
    sourceShas,projects:'independent disposable Project per session',output:out},null,2));
  if(!v.execute){for(const p of pending)console.log('PLAN '+p.key);return}
  if(!v['allow-github-writes'])throw Error('--allow-github-writes required: creates private repos, real issues, Projects v2, PRs and Actions runs');
  if(pending.some(x=>(latestRows.get(x.key)?.invalid_reasons??[]).includes('plugin_cleanup_failed'))&&
      !v['acknowledge-plugin-cleanup'])
    throw Error('Previous plugin cleanup failed. Inspect and remove benchmark-owned leftovers first, then explicitly pass --acknowledge-plugin-cleanup to retry invalid cells.');
  const invocationCeiling=pending.reduce((n,p)=>n+(p.id==='W5'?2:1),0);
  if(invocationCeiling>max)throw Error(invocationCeiling+' possible paid invocations exceeds --max-sessions '+max+' (W5 can require two invocations)');
  if(!process.env.WORKFLOW_BENCH_SETUP_TOKEN||!process.env.WORKFLOW_BENCH_AGENT_TOKEN)throw Error('Use dedicated WORKFLOW_BENCH_SETUP_TOKEN and WORKFLOW_BENCH_AGENT_TOKEN in a disposable GitHub organization');
  const version=cliVersion(v.agent);
  if(v.agent==='claude'&&arms.some(arm=>arm==='superpowers'||arm==='ponytail'))requireClaudePluginDir();
  if(v.agent==='codex'&&arms.includes('ponytail'))requireCodexPonytailHooks();
  validateOrg(v.owner);
  if(rows.some(r=>r.agent_version!==version||r.eval_fingerprint!==evalFingerprint))throw Error('CLI or evaluator version changed; cannot resume');
  if(v.agent==='codex')approveDangerFullAccess({alreadyApproved:v['allow-danger-full-access'],count:pending.reduce((n,p)=>n+(p.id==='W5'?2:1),0)});
  const mode=selectProfileMode(v.agent,arms,{count:invocationCeiling});
  if(rows.some(r=>r.profile_isolation!==mode))throw Error('resume cannot mix isolated and unisolated profiles');
  const runState=state??{runId:Date.now().toString(36),projectTitle:null,projectNumber:null,cells:{}};
  runState.version=2;runState.identity=identity;runState.schedule=schedule;runState.signature=idFor(schedule,identity);
  safeOut(statePath,runState);
  for(const [i,cell] of pending.entries()){
    console.log('SESSION '+(i+1)+'/'+pending.length+' '+cell.key);
    const row=await runCell(cell,opts,runState,mode,version,evalFingerprint);
    console.log('RESULT '+cell.key+' '+row.outcome.toUpperCase()+' '+JSON.stringify(row.outcome==='invalid'?row.invalid_reasons:row.delivery.steps));
  }
}
main().catch(e=>{console.error('run-workflow: '+e.message);process.exitCode=2});
