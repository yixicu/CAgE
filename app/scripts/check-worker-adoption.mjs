import assert from 'node:assert/strict';
import {createOptionalOperationV21} from '../dist/research/versions/v21/optional-operation.js';
import {OPTIONAL_MODE_V21 as solverMode} from '../dist/research/versions/v21/optional-types.js';
import {digestV21} from '../dist/research/versions/v21/state.js';
import {freezeCapacityConfigV3} from '../dist/research/versions/v3/capacity-policy.js';

const config=freezeCapacityConfigV3({roleBudget:{},workerBudgets:{}});
const capacityPolicy=config.roleBudget.capacityPolicy;
const root={hypothesisId:'root',revision:'r1'};
const body='Finite norm follows by integration.';
const originalRef={byteLength:Buffer.byteLength(body),bodyHash:digestV21(body)};
const outcome={resultKind:'supported-result',scope:'local',gaps:[],reason:'Integration',reproducible:true,dependencyArtifactIds:[],sourceRefs:['source-1']};
const worker={id:'worker-1',originalRef,authorRole:'auxiliary-worker',acceptanceCommitted:true,qualification:'unreviewed',control:{outcome}};
const route={methodKey:'integration',reason:'Boundary terms vanish',description:'Integrate once',resourceRefs:[]};
const declaration={action:'complete',route,outcome:{...outcome,sourceRefs:[],scope:'root',dependencyArtifactIds:[worker.id]}};
const revision='v4-proof-5';
function operation(qualification=worker.qualification, exposed=true){
 const artifacts=[{...worker,qualification}];
 const snapshot={config,modelConfig:{},capacityPolicy,root,solverMode,sources:[{ref:{id:'source-1'}}],theoryRevision:'v4-operation-5'};
 const marker={projectId:'project',snapshot,solverMode,calls:[],optionalFlow:{operationRevision:revision,artifacts}};
 const context={project:{id:marker.projectId,researchLoopVersion:'4.0'},marker,boundaryId:'call',root};
 return createOptionalOperationV21('v21_theorist',{boundaryId:'call',capacityPolicy,root,artifacts:exposed?artifacts:[]},context,revision);
}
const op=operation();
assert.match(op.wireSchema.properties.outcome.properties.dependencyArtifactIds.description,/once/);
assert.ok(op.schema.properties.adoptions.items.required.includes('outcome'));
assert.ok(!op.wireSchema.properties.adoptions);
assert.ok(!op.wireSchema.properties.reviews.items.properties.outcome);
assert.ok(!operation('unreviewed',false).wireSchema.properties.reviews);
const bytes=schema=>Buffer.byteLength(JSON.stringify(schema));
console.log('Canonical, exposed wire, empty wire bytes:',bytes(op.schema),bytes(op.wireSchema),bytes(operation('unreviewed',false).wireSchema));
assert.throws(()=>op.prepare(declaration),/Read its original/);
const delivery={answerRef:originalRef,startByte:0,endByte:originalRef.byteLength,excerptHash:digestV21(body),body};
op.observeEvidence({deliveries:[{...delivery,excerptHash:'altered'}]});
assert.throws(()=>op.prepare(declaration),/Read its original/);
op.observeEvidence({deliveries:[delivery]});
assert.deepEqual(op.prepare(declaration).adoptions,[]);
const contested=operation('needs-review');
const reevaluation={...declaration,reviews:[{artifactId:worker.id,status:'valid',reason:'Rechecked complete original'}]};
assert.throws(()=>contested.prepare(reevaluation),/Read the complete original/);
contested.observeEvidence({deliveries:[delivery]});
assert.equal(contested.prepare(reevaluation).adoptions[0].outcome.scope,'local');
assert.throws(()=>contested.prepare(declaration),/reviewed supporting result/);
for(const status of ['rejected','deferred','valid']){
 const review={artifactId:worker.id,status,reason:'Checked the local claim'};
 const message={...declaration,outcome:{...declaration.outcome,dependencyArtifactIds:[]},reviews:[review]};
 const prepared=op.prepare(message);
 assert.deepEqual(prepared.adoptions,[{...review,outcome}]);
 assert.deepEqual(op.prepare({...declaration,outcome:message.outcome,adoptions:[{...review,outcome}]}),prepared);
 assert.deepEqual(op.validatePrepared(prepared),prepared);
 if(status!=='valid')assert.throws(()=>op.prepare({...declaration,reviews:[review]}),/reviewed supporting result/);
}
assert.throws(()=>op.prepare({...declaration,reviews:[{artifactId:'missing',status:'valid',reason:'Unknown'}]}),/exposed original/);
assert.throws(()=>op.prepare({...declaration,reviews:[{artifactId:worker.id,status:'valid',reason:'Mismatch',scientificFailure:true}]}),/rejected adoption/);
assert.throws(()=>op.prepare({...declaration,reviews:[{artifactId:worker.id,status:'valid',reason:'Relabel',outcome:{...outcome,scope:'root'}}]}));
console.log('Worker dependency and separate review controls passed.');

// A legal tool-only dispatch is itself the research boundary. Its exact open
// progress note is retained, while a tool-only "complete" still needs a proof.
const {ProofControlV3}=await import('../dist/runtime/v3-control.js');
const {openProgressNote,manuscriptSchema}=await import('../dist/runtime/proof-delivery.js');
const tools=['submit_research_result','submit_manuscript'].map((name,i)=>({name,parameters:i?manuscriptSchema(false):op.wireSchema}));
const notes=[];
const journal={state:{corrections:0},capture:async()=>{},flush:async()=>{}};
function makeControl(){
 return new ProofControlV3(journal,tools,op.wireSchema,value=>op.prepare(value),async(text,collector)=>{
  assert.ok(collector.complete);
  notes.push(text);
  return {technical:{completeness:'complete'}};
 },()=>false,()=>({}),false,undefined,undefined,true,true);
}
async function deliver(control,args,name='submit_research_result'){
 control.startDispatch();
 const id='result';
 const msg={role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id,name,arguments:args}]};
 control.evidence.set(id,{toolCallId:id,tool:name,sdkArguments:args,rawArguments:JSON.stringify(args),coverage:'full',identityValid:true});
 control.observe({type:'done',reason:'toolUse',message:msg});
 await control.prepareMessage(msg);
}
const dispatch={action:'dispatch',route,outcome:{...declaration.outcome,resultKind:'open',gaps:['Need local bound'],dependencyArtifactIds:[],reason:'Estimate the boundary integral before applying the norm.'},
 workers:[{kind:'auxiliary-worker',route,question:'Bound the integral',symbols:{},checks:['Bound finite'],effort:'shallow',reason:'Check convergence'}]};
const control=makeControl();
await deliver(control,dispatch);
assert.equal(control.fatal,undefined);
assert.equal(control.permits('result'),true);
assert.equal(control.needsManuscript,false);
assert.deepEqual(notes,[dispatch.outcome.reason]);
assert.equal(openProgressNote(declaration),'');
const complete=makeControl();
await deliver(complete,declaration);
assert.equal(complete.needsManuscript,true);
assert.equal(notes.length,1);
const ongoing={...dispatch,action:'continue',workers:[]};
const continued=makeControl();
await deliver(continued,ongoing);
assert.ok(continued.permits('result'));
assert.deepEqual(notes,[dispatch.outcome.reason,ongoing.outcome.reason]);
const paused=makeControl();
await deliver(paused,{...ongoing,action:'pause'});
assert.equal(paused.needsManuscript,true);
assert.equal(openProgressNote({...ongoing,action:'pause'}),'');
console.log('Textless Worker dispatch retained its original note; bare completion requires manuscript.');

async function exerciseSavedDeclaration(schema, manuscript, invalid){
 const captured=[], original=[];
 const log={state:{corrections:0},capture:async event=>captured.push(event),flush:async()=>{},complete:async()=>{}};
 const definitions=tools.map(tool=>tool.name==='submit_research_result'?{...tool,parameters:schema}:tool);
 const control=new ProofControlV3(log,definitions,schema,v=>v,async(text,collector)=>{
  assert.ok(collector.complete);original.push(text);return {technical:{completeness:'complete'}};
 },()=>false,()=>({}),false,undefined,undefined,true,true);
 await deliver(control,{answer:{markdown:manuscript}},'submit_manuscript');
 assert.equal(control.fatal,undefined);
 assert.match(control.feedback,/manuscript is saved/);
 control.feedback=undefined;control.correction=true;log.state.corrections=1;
 await deliver(control,invalid);
 assert.equal(control.fatal,undefined,JSON.stringify(captured.filter(e=>e.kind==='v21-rejected-scientific-step')));
 assert.match(control.feedback,/\/adoptions/);
 assert.equal(control.deliveryStage,'declaration');
 assert.equal(control.declarationDispatchLimit,2);
 control.feedback=undefined;log.state.corrections=2;
 await deliver(control,{field_1:true});
 assert.ok(control.permits('result'));
 await control.execute(definitions[0],['result',{field_1:true}]);
 assert.ok(control.accepted);
 const {adoptions:extra,...unchanged}=invalid;
 assert.deepEqual(control.value.control,unchanged);
 assert.deepEqual(original,[manuscript]);
 assert.equal(captured.filter(e=>e.kind==='v3-original-message'&&e.deliveryStage==='manuscript').length,1);
 assert.equal(captured.filter(e=>e.kind==='v21-rejected-scientific-step').length,0);
 console.log('Targeted extra-field confirmation preserved',Buffer.byteLength(manuscript),'manuscript bytes and all declared fields.');
}
if(process.argv.length===5){
 const fs=await import('node:fs/promises');
 const [request,bodyResponse,declarationResponse]=await Promise.all(process.argv.slice(2).map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
 const schema=request.tools.find(t=>t.function.name==='submit_research_result').function.parameters;
 const argumentsOf=r=>JSON.parse(r.tool_calls[0].function.arguments);
 await exerciseSavedDeclaration(schema,argumentsOf(bodyResponse).answer.markdown,argumentsOf(declarationResponse));
}else await exerciseSavedDeclaration(op.wireSchema,'The open interval has positive length by hypothesis.',{...declaration,adoptions:[{artifactId:worker.id,status:'valid'}]});
