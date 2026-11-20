/** Op5 presentation only. Fixed host boilerplate has typed equivalents; originals stay immutable. */
const SELF_ADOPTION='Theorist same-response original and reported scientific scope; not host mathematical verification.';
const ROOT_SCOPE='The original user question, without weakened requirements.';
const ROOT_STRENGTH='All requirements in the original user question.';
const ROOT_COMPLETION='Resolve all requirements of the exact original question.';
const ORIGINAL_POINTER='Original question above.';
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function compactHostMetadataV3<T>(input:T):T {
 const result=structuredClone(input);
 const root=(data:unknown)=>{
  if(!record(data)||typeof data.hypothesisId!=='string'||typeof data.revision!=='string'||typeof data.originalText!=='string')return;
  let exact=false;
  if(data.returnToRoot===ROOT_SCOPE){delete data.returnToRoot;exact=true;}
  if(data.strength===ROOT_STRENGTH){delete data.strength;exact=true;}
  if(Array.isArray(data.completionCriteria)&&data.completionCriteria.includes(ROOT_COMPLETION)){
   data.completionCriteria=data.completionCriteria.filter((item:unknown)=>item!==ROOT_COMPLETION);exact=true;
  }
  if(exact)data.originalQuestion=true;
 };
 const adoption=(data:unknown)=>{
  if(record(data)&&data.authorRole==='theorist'&&data.adoptionReason===SELF_ADOPTION){
   delete data.adoptionReason;data.adoptionKind='same-response-original';
  }
 };
 const archive=(data:unknown)=>{
  const meta=record(data)&&record(data.meta)?data.meta.optionalProof:undefined;
  if(record(meta)){root(meta.root);adoption(meta);}
 };
 if(!record(result))return result;
 const data=record(result.frozenInput)?result.frozenInput:result;
 root(data.root);archive(data.proof);
 for(const item of Array.isArray(data.qualifiedArchives)?data.qualifiedArchives:[])archive(item);
 for(const item of Array.isArray(data.pairedRouteOutcomes)?data.pairedRouteOutcomes:[])adoption(item);
 const records=data.v3?.workspace?.records;
 for(const item of Array.isArray(records)?records:[]){
  if(record(item)&&item.kind==='goal'&&item.text===ORIGINAL_POINTER){delete item.text;item.originalQuestion=true;}
 }
 return result;
}

/** V13 proof-reader accounting only: exact authored templates, never scientific scope or proof bodies. */
export function proofHostGuidanceV3(input:unknown):string[] {
 if(!record(input)||!record(input.meta)||typeof input.summary!=='string'||typeof input.proof!=='string')throw new Error('Invalid final proof reader result.');
 const optional=input.meta.optionalProof,texts:string[]=[];
 if(optional===undefined)return texts;
 if(!record(optional)||!record(optional.root))throw new Error('Invalid final proof reader result.');
 const root=optional.root;
 if([root.returnToRoot,root.strength,optional.adoptionReason].some(value=>value!==undefined&&typeof value!=='string'))throw new Error('Invalid final proof reader result.');
 if(typeof root.hypothesisId!=='string'||typeof root.revision!=='string'||typeof root.originalText!=='string'||root.completionCriteria!==undefined&&(!Array.isArray(root.completionCriteria)||root.completionCriteria.some((value:unknown)=>typeof value!=='string')))throw new Error('Invalid final proof reader result.');
 if(root.returnToRoot===ROOT_SCOPE)texts.push(ROOT_SCOPE);
 if(root.strength===ROOT_STRENGTH)texts.push(ROOT_STRENGTH);
 for(const value of root.completionCriteria??[])if(value===ROOT_COMPLETION)texts.push(ROOT_COMPLETION);
 if(optional.authorRole==='theorist'&&optional.adoptionReason===SELF_ADOPTION)texts.push(SELF_ADOPTION);
 return texts;
}
