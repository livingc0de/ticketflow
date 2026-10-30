/**
 * A benchmark infrastructure failure is not evidence that an agent or framework
 * failed. Preserve invalid attempts for audit; only valid cells enter rates.
 */
export const invalidReasons=({delivery,invocations=[],plugin_bootstrap=null,profile_cleanup='ok'})=>{
  const reasons=[];
  if(delivery?.error)reasons.push('evaluation_unavailable');
  if(invocations.some(p=>p.archive_error))reasons.push('transcript_archive_failed');
  if(profile_cleanup!=='ok'||invocations.some(p=>p.cleanup_error))reasons.push('plugin_cleanup_failed');
  if(invocations.some(p=>p.signal==='error'||p.error||p.stdin_error))reasons.push('agent_launch_failed');
  if(plugin_bootstrap&& !['loaded','verified'].includes(plugin_bootstrap.status))
    reasons.push('plugin_activation_unverified');
  return [...new Set(reasons)];
};
export function classifyOutcome({delivery,invocations=[],plugin_bootstrap=null,profile_cleanup='ok'}){
  const reasons=invalidReasons({delivery,invocations,plugin_bootstrap,profile_cleanup});
  if(reasons.length)return {status:'invalid',invalid_reasons:reasons};
  // The intentionally killed first W5 invocation is not a failure if recovery succeeds.
  const first=invocations.slice(0,-1);
  const cleanFirst=first.every(p=>p.interrupted&&p.reason==='remote checkpoint reached');
  const agentOk=invocations.length>0&&invocations.at(-1).exit===0&&cleanFirst;
  return {status:agentOk&&delivery?.pipeline?'success':'failure',invalid_reasons:[]};
}
/** Legacy rows have ambiguous failure provenance: do not infer infrastructure invalidity. */
export const outcomeOf=r=>['success','failure','invalid'].includes(r.outcome)?r.outcome:
  (r.check?.pass===true?'success':'failure');
export const cellKey=r=>JSON.stringify([r.scenario,r.arm,r.repeat,r.agent,r.eval_fingerprint,
  r.requested_model,r.requested_effort??null]);
/** A later attempt supersedes its earlier result, but no previous row is deleted. */
export function latestAttempts(rows){
  const latest=new Map();
  for(const row of rows)latest.set(cellKey(row),row);
  return [...latest.values()];
}
