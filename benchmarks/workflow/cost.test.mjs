import test from 'node:test';
import assert from 'node:assert/strict';
import {streamCostLowerBound} from './cost.mjs';

const msg=(id,usage)=>({type:'assistant',message:{id,usage}});
test('an interrupted stream is priced from its per-message usage, once per message id',()=>{
  const events=[msg('m1',{input_tokens:4,output_tokens:485,cache_read_input_tokens:28043,cache_creation_input_tokens:5496}),
    msg('m1',{input_tokens:4,output_tokens:485,cache_read_input_tokens:28043,cache_creation_input_tokens:5496}),{type:'user'}];
  // 4*2 + 485*10 + 28043*0.1 + 5496*2.5 = 21402.3 millionths of a dollar, the cost Claude reported for that usage
  assert.ok(Math.abs(streamCostLowerBound(events,'claude-sonnet-5-5')-0.0214023)<1e-9);
});
test('unknown model or no usage is unknown, not zero',()=>{
  assert.equal(streamCostLowerBound([msg('m1',{input_tokens:1})],'some-other-model'),null);
  assert.equal(streamCostLowerBound([{type:'user'}],'claude-sonnet-5-5'),null);
});
