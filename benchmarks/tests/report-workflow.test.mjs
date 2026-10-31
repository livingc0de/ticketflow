import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {render} from '../report-workflow.mjs';

const tool=fileURLToPath(new URL('../report-workflow.mjs',import.meta.url));

const row=(arm,pass,pipeline)=>({
  suite:'workflow',scenario:'W2',arm,agent:'claude',agent_version:'fake',
  requested_model:'test',requested_effort:'high',eval_fingerprint:'fixed',
  profile_isolation:'isolated',sandbox_mode:'not-applicable',check:{pass},
  outcome:pass?'success':'failure',agent_exit:pass?0:1,
  delivery:{functionality:true,pipeline,steps:{review_evidence:pipeline,issue_tracking:pipeline,
    latest_head_ci:pipeline},process:{agent_created_issues:0,issues_closed_and_linked:1,
    plan_artifacts:[],planning:{project_changed_from_pre_agent_baseline:0},issue_coverage:1}},
  wall_s:60,cost_usd:0.1,descendants:'unknown',profile_cleanup:'ok',transcript_archives:['record'],
});
test('workflow report excludes execution failures from headline pipeline success',()=>{
  const result=render([row('bare',true,true),{...row('bare',false,true),repeat:2}]);
  assert.match(result,/Candidate correctness \| Full pipeline \| Merged delivery \| Agent completed/);
  assert.match(result,/\| bare \| 2 \| 0 \| 100% \| 50% \| 100% \| 50%/);
  assert.match(result,/Scored cells: \*\*2\*\*/);
});
test('workflow report still shows delivery evidence for failed agent runs',()=>{
  const result=render([row('ticketflow',false,true)]);
  assert.match(result,/\| ticketflow \| 1 \| 0 \| 100% \| 0% \| 100% \| 0%/);
});
test('workflow report keeps optional native-process evidence unknown when absent',()=>{
  const native=row('bare',true,true);
  native.delivery={...native.delivery,process:{}};
  const result=render([native]);
  assert.match(result,/\| bare \| unknown \| unknown \| unknown \| unknown \|/);
});
test('workflow report computes arithmetic means for average evidence columns',()=>{
  const withCounts=(base,plans,changes)=>({...base,delivery:{...base.delivery,process:{...base.delivery.process,
    plan_artifacts:Array.from({length:plans},(_,i)=>'plan-'+i),
    planning:{...base.delivery.process.planning,project_changed_from_pre_agent_baseline:changes}}}});
  const result=render([
    withCounts({...row('bare',true,true),repeat:1},0,0),
    withCounts({...row('bare',true,true),repeat:2},0,0),
    withCounts({...row('bare',true,true),repeat:3},6,6),
  ]);
  assert.match(result,/\| bare \| 0\.0 \| 1\.0 \| 2 \| 2 \|/);
});

test('invalid archive/cleanup and evaluator errors are excluded from the denominator',()=>{
  const ok=row('bare',true,true);
  const invalid={...row('bare',false,true),outcome:'invalid',
    invalid_reasons:['transcript_archive_failed'],cost_usd:0.31,repeat:2};
  const failed={...row('bare',false,false),outcome:'failure',repeat:3};
  const report=render([ok,invalid,failed]);
  assert.match(report,/Scored cells: \*\*2\*\* \| Invalid cells excluded: \*\*1\*\*/);
  assert.match(report,/\| bare \| 2 \| 1 \| 100% \| 50%/);
  assert.match(report,/transcript_archive_failed/);
  assert.match(report,/Invalid-attempt spend[^\n]*\$0\.31/);
});
test('all-invalid arms show n\/a instead of a misleading zero success rate',()=>{
  const invalid={...row('ponytail',false,true),outcome:'invalid',
    invalid_reasons:['evaluation_unavailable'],cost_usd:0.2};
  const report=render([invalid]);
  assert.match(report,/\| ponytail \| 0 \| 1 \| n\/a \| n\/a/);
  assert.match(report,/Invalid-run warning/);
});
test('a fresh valid retry supersedes the original invalid measurement without erasing it',()=>{
  const first={...row('ticketflow',false,true),outcome:'invalid',attempt:1,
    invalid_reasons:['plugin_cleanup_failed'],cost_usd:0.29};
  const second={...row('ticketflow',true,true),attempt:2,retry_of:'previous',cost_usd:0.15};
  const report=render([first,second]);
  assert.match(report,/Scored cells: \*\*1\*\* \| Invalid cells excluded: \*\*0\*\* \| Recorded attempts including retries: \*\*2\*\*/);
  assert.match(report,/\| ticketflow \| 1 \| 0 \| 100% \| 100%/);
  assert.match(report,/Invalid-attempt spend[^\n]*\$0\.29/);
  assert.doesNotMatch(report,/\| ticketflow \| 2 \|/);
});
test('legacy rows without explicit status are flagged as ambiguous',()=>{
  const old=row('bare',false,false);delete old.outcome;
  assert.match(render([old]),/Legacy-record warning/);
});

test('workflow publication writes the shared dated report filename',()=>{
  const dir=join(tmpdir(),`workflow-report-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(dir,{recursive:true});
  try {
    const input=join(dir,'2026-10-30-workflow-pilot.jsonl'),results=join(dir,'results');
    writeFileSync(input,JSON.stringify(row('bare',true,true))+'\n');
    const result=spawnSync(process.execPath,[tool,input,'--publish','--label','pilot','--date','2026-10-30','--results-dir',results],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const report=join(results,'2026-10-30-workflow-pilot.md');
    assert.match(result.stdout,/2026-10-30-workflow-pilot\.md/);
    assert.ok(existsSync(report));
    assert.match(readFileSync(report,'utf8'),/^# Full-pipeline workflow comparison/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
