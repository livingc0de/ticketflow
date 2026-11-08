/**
 * A benchmark infrastructure failure is not evidence that an agent or framework failed. Preserve invalid attempts for
 * audit; only valid ('scored') cells enter the report. Scoring itself is the Facts record, never a pass/fail here.
 */
export const invalidReasons=({facts,invocations=[],plugin_bootstrap=null,profile_cleanup='ok'})=>{
  const reasons=[];
  if(!facts||facts.errors?.length)reasons.push('evaluation_unavailable');
  if(invocations.some(p=>p.archive_error))reasons.push('transcript_archive_failed');
  if(profile_cleanup!=='ok'||invocations.some(p=>p.cleanup_error))reasons.push('plugin_cleanup_failed');
  if(invocations.some(p=>p.signal==='error'||p.error||p.stdin_error))reasons.push('agent_launch_failed');
  if(plugin_bootstrap&& !['loaded','verified'].includes(plugin_bootstrap.status))
    reasons.push('plugin_activation_unverified');
  return [...new Set(reasons)];
};
export function classifyOutcome(input){
  const reasons=invalidReasons(input);
  return reasons.length?{status:'invalid',invalid_reasons:reasons}:{status:'scored',invalid_reasons:[]};
}
/**
 * Did the agent stop to ask permission to carry on (its final paragraph asks to proceed, continue or go ahead)? A person would answer
 * "go on". Text only. A closing "Anything else?" or an offer of extra work is not a stall, and a question about a decision is not
 * answered by a generic reply, so neither counts. The final paragraph only.
 */
const PROCEED='(?:proceed|continue|go ahead|go on|keep going|carry on|move on|start|begin|implement|build|do (?:the rest|that|it))';
const ASK=new RegExp('\\b(?:shall i|should i|may i|can i|want me to|would you like me to|do you want me to|ok(?:ay)? (?:for me )?to|let me know (?:if|when) you(?:\'d| would)? (?:like|want)(?: me)? to)\\b[^.?!]*\\b'+PROCEED+'\\b','i');
const READY=new RegExp('\\bready (?:for me )?to '+PROCEED+'\\b|\\b(?:approve|approval)\\b[^.?!]*\\b'+PROCEED+'\\b|^\\s*(?:proceed|continue|go ahead|ok to proceed)\\s*\\?\\s*$','i');
export function asksToContinue(answer){
  const last=String(answer??'').trim().split(/\n\s*\n/).at(-1)??'';
  return ASK.test(last)||READY.test(last);
}
/** Legacy rows have ambiguous failure provenance: do not infer infrastructure invalidity. */
export const outcomeOf=r=>['scored','success','failure','invalid'].includes(r.outcome)?r.outcome:
  (r.check?.pass===true?'success':'failure');
export const cellKey=r=>JSON.stringify([r.scenario,r.arm,r.repeat,r.agent,r.eval_fingerprint,
  r.requested_model,r.requested_effort??null]);
/** A later attempt supersedes its earlier result, but no previous row is deleted. */
export function latestAttempts(rows){
  const latest=new Map();
  for(const row of rows)latest.set(cellKey(row),row);
  return [...latest.values()];
}
