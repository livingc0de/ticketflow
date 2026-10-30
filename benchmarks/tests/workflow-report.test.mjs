import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../workflow-report.mjs';

const row=(arm,pass,pipeline)=>({
  suite:'workflow',scenario:'W2',arm,agent:'claude',agent_version:'fake',
  requested_model:'test',requested_effort:'high',eval_fingerprint:'fixed',
  profile_isolation:'isolated',sandbox_mode:'not-applicable',check:{pass},
  delivery:{functionality:true,pipeline,steps:{review_evidence:pipeline,issue_tracking:pipeline,
    latest_head_ci:pipeline},process:{agent_created_issues:0,issues_closed_and_linked:1,
    plan_artifacts:[],planning:{project_changed_from_pre_agent_baseline:0},issue_coverage:1}},
  wall_s:60,cost_usd:0.1,descendants:'unknown',profile_cleanup:'ok',transcript_archives:['record'],
});
test('workflow report excludes execution failures from headline pipeline success',()=>{
  const result=render([row('bare',true,true),row('bare',false,true)]);
  assert.match(result,/Full pipeline \| Delivery evidence \| Valid execution/);
  assert.match(result,/\| bare \| 2 \| 100% \| 50% \| 100% \| 50%/);
  assert.match(result,/Execution warning/);
});
test('workflow report still shows delivery evidence for failed agent runs',()=>{
  const result=render([row('ticketflow',false,true)]);
  assert.match(result,/\| ticketflow \| 1 \| 100% \| 0% \| 100% \| 0%/);
});
