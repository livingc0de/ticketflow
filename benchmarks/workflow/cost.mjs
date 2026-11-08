// An interrupted Claude invocation never reports its cost. Its own per-message token usage, priced at the model's list rates,
// is a lower bound: it misses some output tokens and auxiliary calls (15-30% below the reported cost on completed runs).
export const LIST_PRICES_PER_MTOK={'claude-sonnet-5-5':{input:2,output:10,cache_read:0.1,cache_write:2.5}}; // USD; matches reported costs exactly
export function streamCostLowerBound(events,model){
  const price=LIST_PRICES_PER_MTOK[model];
  if(!price)return null;
  const byMessage=new Map();
  for(const e of events) if(e.type==='assistant'&&e.message?.id&&e.message.usage) byMessage.set(e.message.id,e.message.usage);
  let usd=0;
  for(const u of byMessage.values())
    usd+=((u.input_tokens??0)*price.input+(u.output_tokens??0)*price.output+(u.cache_read_input_tokens??0)*price.cache_read+(u.cache_creation_input_tokens??0)*price.cache_write)/1e6;
  return byMessage.size?usd:null;
}
