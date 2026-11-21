import type { RoleBudget } from '../research/contracts/v1.js';
import { RuntimeError } from './errors.js';
import { copyProviderPayload } from './provider-transport.js';

type Rates = { input:number; output:number; cacheRead:number; cacheWrite:number };
type Cost = Rates & { tiers?: ReadonlyArray<Rates> };
type Spend = {tokens:number; costUsd:number; tokensKnown:boolean; costKnown:boolean};

/** Compute the total output (including thinking) that can still be funded by this invocation. */
export function proofOutputAllowanceV4(payload: unknown, budget: RoleBudget, spend: Spend, cost: Cost, contextWindow: number): number {
  if (!spend.tokensKnown || !spend.costKnown || budget.maxTokens === undefined || budget.maxCostUsd === undefined)
    throw new RuntimeError('BUDGET_UNAVAILABLE');
  const rates=[cost,...cost.tiers??[]];
  if (rates.some(rate=>[rate.input,rate.output,rate.cacheRead,rate.cacheWrite].some(value=>!Number.isFinite(value)||value<0)))
    throw new RuntimeError('BUDGET_UNAVAILABLE');
  const inputRate=Math.max(...rates.map(rate=>Math.max(2*rate.input,rate.cacheRead,rate.cacheWrite)));
  const outputRate=Math.max(...rates.map(rate=>rate.output));
  if (Math.max(inputRate,outputRate)<=0 || !payload || typeof payload!=='object') throw new RuntimeError('BUDGET_UNAVAILABLE');
  // The complete serialized request upper-bounds text under a byte tokenizer. Reserve framing
  // for chat messages, tool calls and provider-added wrappers separately.
  const inputReserve=Buffer.byteLength(JSON.stringify(payload),'utf8')+1024;
  let remaining=Math.min(budget.maxTokens-spend.tokens-inputReserve,contextWindow>0?contextWindow-inputReserve:Infinity);
  const money=(budget.maxCostUsd-spend.costUsd)*1e6-inputReserve*inputRate;
  if (money<0) throw new RuntimeError('BUDGET_EXHAUSTED');
  if (outputRate>0) remaining=Math.min(remaining,Math.floor(money/outputRate));
  if (!Number.isSafeInteger(remaining)||remaining<1) throw new RuntimeError('BUDGET_EXHAUSTED');
  return remaining;
}

/** Recheck the final SDK payload after wire schemas and provider thinking/output expansion. */
export function limitProofPayloadV4(payload: unknown, budget: RoleBudget, spend: Spend, cost: Cost, contextWindow: number): unknown {
  const remaining=proofOutputAllowanceV4(payload,budget,spend,cost,contextWindow);
  const body=copyProviderPayload(payload);
  const caps: {owner:Record<string,unknown>;field:string}[]=[];
  for (const parent of [body,body.config,body.generationConfig,body.inferenceConfig]) {
    if (!parent||typeof parent!=='object') continue;
    const owner=parent as Record<string,unknown>;
    for (const field of ['max_tokens','max_completion_tokens','max_output_tokens','maxOutputTokens','maxTokens']) {
      if (Object.hasOwn(owner,field)) caps.push({owner,field});
    }
  }
  if (caps.length!==1) throw new RuntimeError('BUDGET_UNAVAILABLE');
  const {owner,field}=caps[0], current=owner[field];
  if (typeof current!=='number'||!Number.isSafeInteger(current)||current<1) throw new RuntimeError('BUDGET_UNAVAILABLE');
  owner[field]=Math.min(current,remaining);
  return body;
}

export function stagedOutputReserve(window:number,output:number){return Math.min(output,4096,Math.max(1,Math.floor(window/4)));}

/** The final wire payload includes schema expansion and provider framing. */
export function fitStagedWindow(payload:unknown,window:number,modelOutput:number):unknown {
  if(window<=0||!payload||typeof payload!=='object')return payload;
  const input=Math.ceil(Buffer.byteLength(JSON.stringify(payload),'utf8')/3)+1024;
  const available=window-input;
  if(available<stagedOutputReserve(window,modelOutput))throw new RuntimeError('CONTEXT_EXHAUSTED');
  const body=copyProviderPayload(payload);
  for(const config of [body,body.config,body.generationConfig,body.inferenceConfig]){
    if(!config||typeof config!=='object')continue;
    const values=config as Record<string,unknown>;
    for(const key of ['max_tokens','max_completion_tokens','max_output_tokens','maxOutputTokens','maxTokens']){
      const value=values[key];
      if(typeof value==='number')values[key]=Math.min(value,available);
    }
  }
  return body;
}
