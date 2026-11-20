import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { stableHash } from '../../../learning/research-hash.js';
import { visibleWorkspaceRecordsV3 } from './workspace.js';
import type { EvidenceLevelV3, WorkspaceV3 } from './workspace.js';
export interface RegisteredOperationRequestV3 {operationId:string;parameters:unknown;factRefs?:string[];conditionRefs?:string[]}
export interface OperationContextV3 {runId:string;rootVersion:string;knowledgeVersion:string;branchId:string;requestKey:string;workspace:WorkspaceV3;sourceVersion:string;requestedAt:string;strictContract?:boolean}
export interface OperationBindingV3 {runId:string;rootVersion:string;knowledgeVersion:string;branchId:string;requestKey:string;factRefs:string[];conditionRefs:string[];evidenceHash:string}
export interface OperationReceiptV3 {id:string;taskId:string;callId:string;operationId:string;operationVersion:string;inputHash:string;inputBinding:OperationBindingV3;sourceVersion:string;artifactRef:string;status:'completed'|'inapplicable'|'fallback'|'error';verification:{kind:EvidenceLevelV3;scope:string};conditionalPremises:string[];missingConditions:string[];errors:string[];result?:unknown;summary:string;createdAt:string}
export interface OperationPortsV3 {readReceipt(binding:string):Promise<OperationReceiptV3|undefined>;persistArtifact(ref:string,full:unknown):Promise<void>;persistReceipt(receipt:OperationReceiptV3):Promise<void>}
export const REGISTERED_OPERATIONS_V3=Object.freeze([
 {id:'rational-arithmetic',version:'1',parameters:'{operator: add|subtract|multiply|divide, left: rational string such as 1/2, right: rational string such as 1/3}. Each numerator/denominator is at most 128 digits; denominator must be nonzero.',scope:'Exact arithmetic on explicitly supplied bounded rational numbers; no interpretation of scientific premises.'},
 {id:'polynomial-identity',version:'1',parameters:'{left: rational-string coefficient array, right: rational-string coefficient array}, each 1–65 entries in ascending degree order. Example left [1,2] must be strings ["1","2"].',scope:'Exact equality of explicitly supplied univariate rational coefficient arrays, in ascending degree order.'},
 {id:'dimension-equality',version:'1',parameters:'{left: SI exponent map, right: SI exponent map}. Keys mass,length,time,current,temperature,amount,luminousIntensity; omitted keys mean 0. Integer exponents from -32 to 32.',scope:'Equality of explicitly supplied SI base-dimension exponent vectors; not physical correctness or coefficient validation.'},
].map(entry=>Object.freeze(entry)));
/** New operation-2 tool contract. Operation-1 presentation remains frozen. */
const objectSchema=(properties:Parameters<typeof Type.Object>[0])=>Type.Object(properties,{additionalProperties:false});
const rationalSchema=Type.String({pattern:'^[-+]?\\d{1,128}(/[-+]?\\d{1,128})?$'});
const dimensions=objectSchema(Object.fromEntries(['mass','length','time','current','temperature','amount','luminousIntensity'].map(key=>[key,Type.Optional(Type.Integer({minimum:-32,maximum:32}))])));
export const OPERATION_PARAMETERS_V3={
 'rational-arithmetic':objectSchema({operator:Type.Union(['add','subtract','multiply','divide'].map(value=>Type.Literal(value))),left:rationalSchema,right:rationalSchema}),
 'polynomial-identity':objectSchema({left:Type.Array(rationalSchema,{minItems:1,maxItems:65}),right:Type.Array(rationalSchema,{minItems:1,maxItems:65})}),
 'dimension-equality':objectSchema({left:dimensions,right:dimensions}),
};
const OPERATION_RESULTS_V3={
 'rational-arithmetic':objectSchema({value:Type.String({pattern:'^-?\\d+(?:/\\d+)?$'})}),
 'polynomial-identity':objectSchema({equal:Type.Boolean(),differentDegrees:Type.Array(Type.Integer({minimum:0,maximum:64}),{maxItems:65})}),
 'dimension-equality':objectSchema({equal:Type.Boolean(),bases:Type.Array(Type.String(),{minItems:7,maxItems:7}),left:Type.Array(Type.Integer({minimum:-32,maximum:32}),{minItems:7,maxItems:7}),right:Type.Array(Type.Integer({minimum:-32,maximum:32}),{minItems:7,maxItems:7})}),
};
const evidenceRefs=Type.Optional(Type.Array(Type.String({minLength:1,maxLength:256}),{maxItems:64}));
export const RegisteredOperationsSchemaV3=objectSchema({requests:Type.Array(Type.Union(Object.entries(OPERATION_PARAMETERS_V3).map(([id,parameters])=>objectSchema({operationId:Type.Literal(id),parameters,factRefs:evidenceRefs,conditionRefs:evidenceRefs}))),{minItems:1,maxItems:8})});
export class OperationInputErrorV3 extends Error {constructor(readonly code:'invalid-arguments'|'input-limit'|'unsupported-operation',message:string){super(message);}}
/** Validate the same contract used on the wire, before any durable effects. */
export function validateOperationArgumentsV3(args:unknown):void {
 try {jsonInput(args);}catch {throw new OperationInputErrorV3('input-limit','Arguments must be finite plain JSON, at most 32768 bytes, 4096 nodes and depth 12.');}
 if(!Value.Check(RegisteredOperationsSchemaV3,args)){
  const requests=(args as {requests?:unknown})?.requests;
  const unsupported=Array.isArray(requests)&&requests.some(r=>r&&typeof r==='object'&&typeof r.operationId==='string'&&!Object.hasOwn(OPERATION_PARAMETERS_V3,r.operationId));
  throw new OperationInputErrorV3(unsupported?'unsupported-operation':'invalid-arguments',unsupported?'Choose a declared operationId; no arbitrary code is executable.':'Arguments must match the selected operation schema. Rational numbers are integer or fraction strings, not decimals or JSON numbers; coefficients are ascending-degree arrays.');
 }
}
class OperationOutputErrorV3 extends Error {}
type Rational=[bigint,bigint];
const gcd=(a:bigint,b:bigint):bigint=>{while(b){const t=a%b;a=b;b=t;}return a<0n?-a:a;};
function rational(v:unknown):Rational {if(typeof v!=='string'||!/^[-+]?\d{1,128}(\/[-+]?\d{1,128})?$/.test(v))throw new Error('Expected bounded rational string.');const [a,b='1']=v.split('/'),n=BigInt(a!),d=BigInt(b);if(d===0n)throw new RangeError('Zero denominator.');const g=gcd(n,d);return [n/g*(d<0n?-1n:1n),d/g*(d<0n?-1n:1n)];}
const show=([n,d]:Rational)=>d===1n?String(n):`${n}/${d}`;
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Expected operation parameter object.');return v as Record<string,unknown>;}
function exactKeys(p:Record<string,unknown>,keys:string[]){if(Object.keys(p).some(k=>!keys.includes(k))||keys.some(k=>!(k in p)))throw new Error('Unsupported or missing operation parameter.');}
function compute(id:string,parameters:unknown):unknown {
 const p=object(parameters);
 if(id==='rational-arithmetic'){exactKeys(p,['operator','left','right']);const [a,b]=rational(p.left),[c,d]=rational(p.right);let n:bigint,den:bigint;switch(p.operator){case 'add':n=a*d+c*b;den=b*d;break;case 'subtract':n=a*d-c*b;den=b*d;break;case 'multiply':n=a*c;den=b*d;break;case 'divide':if(c===0n)throw new RangeError('Division by zero.');n=a*d;den=b*c;break;default:throw new Error('Unknown arithmetic operator.');}const g=gcd(n,den),sign=den<0n?-1n:1n;return {value:show([n/g*sign,den/g*sign])};}
 if(id==='polynomial-identity'){exactKeys(p,['left','right']);const parse=(v:unknown)=>{if(!Array.isArray(v)||v.length>65||v.length===0)throw new Error('Expected 1–65 coefficients.');return v.map(rational);};const left=parse(p.left),right=parse(p.right);const differentDegrees:number[]=[];for(let i=0;i<Math.max(left.length,right.length);i++){const a=left[i]??[0n,1n],b=right[i]??[0n,1n];if(a[0]*b[1]!==b[0]*a[1])differentDegrees.push(i);}return {equal:differentDegrees.length===0,differentDegrees};}
 if(id==='dimension-equality'){exactKeys(p,['left','right']);const bases=['mass','length','time','current','temperature','amount','luminousIntensity'];const parse=(v:unknown)=>{const o=object(v);if(Object.keys(o).some(k=>!bases.includes(k))||Object.values(o).some(n=>!Number.isInteger(n)||Math.abs(n as number)>32))throw new Error('Expected bounded SI dimension exponents.');return bases.map(k=>o[k]??0);};const left=parse(p.left),right=parse(p.right);return {equal:left.every((v,i)=>v===right[i]),bases,left,right};}
 throw new Error('Unsupported registered operation.');
}
function jsonInput(value:unknown):void {let count=0;const seen=new Set<object>();const visit=(v:unknown,depth:number)=>{if(++count>4096||depth>12)throw new Error('Operation input bound exceeded.');if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'&&Number.isFinite(v))return;if(typeof v!=='object'||seen.has(v as object))throw new Error('Operation input must be finite JSON.');seen.add(v as object);if(Array.isArray(v))v.forEach(x=>visit(x,depth+1));else {if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw new Error('Operation input must be plain JSON.');for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('Unsafe parameter key.');visit(x,depth+1);}}seen.delete(v as object);};visit(value,0);if(Buffer.byteLength(JSON.stringify(value))>32768)throw new Error('Operation input is too large.');}
export async function executeRegisteredOperationV3(request:RegisteredOperationRequestV3,context:OperationContextV3,ports:OperationPortsV3):Promise<OperationReceiptV3>{
 jsonInput(request);request=structuredClone(request);context=structuredClone(context);if(Object.keys(request).some(k=>!['operationId','parameters','factRefs','conditionRefs'].includes(k))||typeof request.operationId!=='string'||request.operationId.length>100)throw new Error('Invalid registered operation request.');
 for(const value of [context.runId,context.rootVersion,context.knowledgeVersion,context.branchId,context.requestKey,context.sourceVersion])if(typeof value!=='string'||!value||value.length>256)throw new Error('Host operation identity required.');
 if(!Number.isFinite(Date.parse(context.requestedAt)))throw new Error('Host frozen operation admission timestamp required.');
 if(context.workspace.rootVersion!==context.rootVersion)throw new Error('Operation workspace root mismatch.');
 const refs=(v:string[]|undefined)=>{if(v!==undefined&&(!Array.isArray(v)||v.length>64||v.some(x=>typeof x!=='string'||!x||x.length>256)))throw new Error('Invalid operation evidence refs.');return [...new Set(v??[])].sort();};
 const inputBinding:OperationBindingV3={runId:context.runId,rootVersion:context.rootVersion,knowledgeVersion:context.knowledgeVersion,branchId:context.branchId,requestKey:context.requestKey,factRefs:refs(request.factRefs),conditionRefs:refs(request.conditionRefs),evidenceHash:stableHash(visibleWorkspaceRecordsV3(context.workspace,context.branchId).filter(r=>[...(request.factRefs??[]),...(request.conditionRefs??[])].includes(r.id)))};
 const operation=REGISTERED_OPERATIONS_V3.find(x=>x.id===request.operationId),inputHash=stableHash({request,inputBinding,sourceVersion:context.sourceVersion,requestedAt:context.requestedAt,operationVersion:operation?.version??'unsupported'}),id=`receipt_${inputHash}`,previous=await ports.readReceipt(id);
 if(previous){if(previous.createdAt!==context.requestedAt||previous.inputHash!==inputHash||stableHash(previous.inputBinding)!==stableHash(inputBinding)||previous.sourceVersion!==context.sourceVersion||previous.operationId!==request.operationId)throw new Error('Stored receipt binding mismatch.');return structuredClone(previous);}
 const receipt:OperationReceiptV3={id,taskId:`task_${stableHash({runId:context.runId,requestKey:context.requestKey})}`,callId:`call_${inputHash}`,operationId:request.operationId,operationVersion:operation?.version??'unsupported',inputHash,inputBinding,sourceVersion:context.sourceVersion,artifactRef:`v3-artifact:${inputHash}`,status:'fallback',verification:{kind:'unknown',scope:operation?.scope??'No registered executable operation.'},conditionalPremises:[],missingConditions:[],errors:[],summary:'Returned to Theorist without execution.',createdAt:context.requestedAt};
 const visible=new Map(visibleWorkspaceRecordsV3(context.workspace,context.branchId).map(r=>[r.id,r]));
 for(const ref of [...inputBinding.factRefs,...inputBinding.conditionRefs]){const r=visible.get(ref);if(!r||r.kind==='goal'||['unverified','needs-review'].includes(r.status))receipt.missingConditions.push(ref);else if(r.status==='refuted')receipt.status='inapplicable';else if(r.kind==='assumption'||r.status==='conditional')receipt.conditionalPremises.push(ref);}
 if(!operation)receipt.errors.push('Unsupported operation; model reasoning remains available.');
 else if(receipt.status!=='inapplicable'&&receipt.missingConditions.length===0){try{receipt.result=compute(request.operationId,request.parameters);if(context.strictContract&&!Value.Check(OPERATION_RESULTS_V3[request.operationId as keyof typeof OPERATION_RESULTS_V3],receipt.result))throw new OperationOutputErrorV3('Registered operation output contract failed.');receipt.status='completed';receipt.verification.kind=receipt.conditionalPremises.length?'conditional':'exact';receipt.summary=JSON.stringify(receipt.result);}catch(error){receipt.status=error instanceof OperationOutputErrorV3?'error':error instanceof RangeError?'inapplicable':'fallback';receipt.errors.push((error as Error).message);}}
 await ports.persistArtifact(receipt.artifactRef,{request:structuredClone(request),receipt:structuredClone(receipt)});await ports.persistReceipt(structuredClone(receipt));return receipt;
}
/** Only independent requests are accepted. No interpolation or model-directed branching. */
export async function executeRegisteredBatchV3(requests:RegisteredOperationRequestV3[],context:OperationContextV3,ports:OperationPortsV3):Promise<OperationReceiptV3[]>{if(!Array.isArray(requests)||requests.length===0||requests.length>8)throw new Error('V3 independent batch must contain 1–8 requests.');const receipts:OperationReceiptV3[]=[];for(const [i,r]of requests.entries()){const receipt=await executeRegisteredOperationV3(r,{...context,requestKey:`${context.requestKey}:${i}`},ports);receipts.push(receipt);if(receipt.status!=='completed')break;}return receipts;}
