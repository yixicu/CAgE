import type {FastifyInstance,FastifyReply} from 'fastify';
import {Type} from 'typebox';
import type {AnyResearchProject} from '../research/contracts/loop.js';
import type {ResearchLibrary} from '../learning/research-library.js';
import {MapObservationSchema} from '../learning/map-observation.js';
import {mapNodeTypeSchema,authoredRelationKinds,observationRelationKinds} from '../learning/map-node-fields.js';
import {CORE_MAP_ID,type MapSeedInput} from '../learning/knowledge-map-store.js';
import {MapError,type MapRef,type MapUser,type NodeReviewStatus} from '../learning/knowledge-map.js';

export function publicResearchTask(task:unknown):unknown {
 if(!task||typeof task!=='object'||Array.isArray(task))return task;
 const {nativeReply:_raw,nativeReplies:_history,...publicTask}=task as Record<string,unknown>;return publicTask;
}

export type ReviewedPremiseOrigin={kind:'field';taskId:string;proposalHash:string;field:string}|{kind:'archive';updateId:string;revision:number};
export interface KnowledgeMapRouteOptions {
 library:Pick<ResearchLibrary,'knowledgeMap'>;
 loadProject:(id:string)=>Promise<AnyResearchProject>;
 pump:(projectId:string)=>void|Promise<void>;
 tasks:(projectId:string)=>Promise<unknown[]>;
 backfill?:(projectId:string,sourceKeys:string[],requestId:string)=>Promise<unknown>;
 retry?:(projectId:string,taskId:string)=>Promise<unknown>;
 acceptPremise?:(actor:MapUser,statement:string,origin:ReviewedPremiseOrigin)=>Promise<unknown>;
 domainDecision?:(projectId:string,taskId:string,proposalHash:string,decision:'approve'|'decline',acceptedFields?:string[])=>Promise<unknown>;
}

const identifier=Type.String({pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$'});
const text=Type.String({minLength:1});
const ref=Type.Object({store:Type.Union([Type.Literal('map'),Type.Literal('theory')]),id:text,version:Type.Integer({minimum:1}),bodyHash:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false});
export const seedSchema=Type.Object({
 key:Type.Optional(text),summary:Type.Optional(text),nodeType:Type.Optional(mapNodeTypeSchema),
 relations:Type.Optional(Type.Array(Type.Object({target:text,kind:Type.Union([...authoredRelationKinds,...observationRelationKinds].map(v=>Type.Literal(v))),basis:text,direction:Type.Union([Type.Literal('forward'),Type.Literal('symmetric')])},{additionalProperties:false}))),
 observation:Type.Optional(MapObservationSchema),replaces:Type.Optional(ref),
 kind:Type.Union([Type.Literal('concept'),Type.Literal('theorem'),Type.Literal('observation')]),title:text,
 aliases:Type.Optional(Type.Array(text)),domain:Type.Optional(Type.Array(text)),
 body:text,assumptions:Type.Optional(Type.Array(Type.String())),proof:Type.Optional(text),
 acceptAsFoundation:Type.Optional(Type.Boolean()),
},{additionalProperties:false});
const seedInput=Type.Object({projectId:identifier,requestId:identifier,expectedProfileVersion:Type.Integer({minimum:0}),entries:Type.Array(seedSchema,{minItems:1})},{additionalProperties:false});
const reviewTarget=Type.Object({projectId:identifier,ref},{additionalProperties:false});
const reviewChange=Type.Object({...reviewTarget.properties,expected:text,status:Type.Union(['approved','pending','invalid'].map(v=>Type.Literal(v))),argument:Type.Optional(text)},{additionalProperties:false});
const observationStatus=Type.Object({projectId:identifier,requestId:identifier,ref,status:Type.Union([Type.Literal('disputed'),Type.Literal('withdrawn')]),reason:text},{additionalProperties:false});
const profileInput=Type.Object({projectId:identifier,requestId:identifier,expectedProfileVersion:Type.Integer({minimum:0}),accepted:Type.Array(ref)},{additionalProperties:false});
const premiseInput=Type.Object({projectId:identifier,statement:text,origin:Type.Union([
 Type.Object({kind:Type.Literal('field'),taskId:identifier,proposalHash:Type.String({pattern:'^[a-f0-9]{64}$'}),field:text},{additionalProperties:false}),
 Type.Object({kind:Type.Literal('archive'),updateId:identifier,revision:Type.Integer({minimum:1})},{additionalProperties:false}),
])},{additionalProperties:false});
const domainDecisionInput=Type.Object({projectId:identifier,taskId:identifier,proposalHash:Type.String({pattern:'^[a-f0-9]{64}$'}),decision:Type.Union([Type.Literal('approve'),Type.Literal('decline')]),acceptedFields:Type.Optional(Type.Array(text,{uniqueItems:true}))},{additionalProperties:false});
const backfillInput=Type.Object({projectId:identifier,requestId:identifier,sourceKeys:Type.Array(text,{minItems:1})},{additionalProperties:false});
const retryInput=Type.Object({projectId:identifier,taskId:identifier},{additionalProperties:false});
const query=Type.Object({projectId:identifier},{additionalProperties:false});

async function mapResponse(reply:FastifyReply,work:()=>Promise<unknown>){
 try{return await work();}
 catch(error){
  if(!(error instanceof MapError))throw error;
  const status={FORBIDDEN:403,CONFLICT:409,INVALID_INPUT:400,STALE_SOURCE:409,NOT_FOUND:404}[error.code];
  return reply.code(status).send({error:error.code,message:error.message});
 }
}

/** Registered within the app's existing Origin/Host/token guards; payloads cannot choose an actor. */
export function registerKnowledgeMapRoutes(app:FastifyInstance,options:KnowledgeMapRouteOptions):void {
 const admit=async(projectId:string)=>{
  try{await options.pump(projectId);return {status:'admitted' as const};}
  catch{return {status:'deferred' as const,message:'The source is saved. Inspect maintenance tasks for the admission error; retry after resolving it.'};}
 };
 const actor=async(projectId:string):Promise<MapUser>=>{
  const project=await options.loadProject(projectId);
  if(project.id!==projectId||project.researchLoopVersion!=='4.0')throw new MapError('FORBIDDEN','Knowledge-map management requires the selected V4 project.');
  return {purpose:'map-user',ownerId:'local-user',projectId};
 };

 const reviewActor=async(projectId:string)=>{if(projectId!==CORE_MAP_ID)await actor(projectId);};
 app.post<{Body:{projectId:string;ref:MapRef}}>('/api/research/knowledge-map/review-status',{schema:{body:reviewTarget}},async(request,reply)=>mapResponse(reply,async()=>{
  const {projectId,ref}=request.body;await reviewActor(projectId);return options.library.knowledgeMap.nodeReview(projectId,ref);
 }));
 app.put<{Body:{projectId:string;ref:MapRef;expected:string;status:NodeReviewStatus;argument?:string}}>('/api/research/knowledge-map/review-status',{schema:{body:reviewChange}},async(request,reply)=>mapResponse(reply,async()=>{
  const {projectId,ref,expected,status,argument}=request.body;await reviewActor(projectId);return options.library.knowledgeMap.setNodeReview(projectId,ref,expected,status,argument);
 }));
 app.post<{Body:{projectId:string;statement:string;origin:ReviewedPremiseOrigin}}>('/api/research/knowledge-map/reviewed-premises',{schema:{body:premiseInput}},async(request,reply)=>mapResponse(reply,async()=>{
  const {projectId,statement,origin}=request.body,authority=await actor(projectId);
  if(!options.acceptPremise)return reply.code(503).send({error:'PREMISE_ACCEPTANCE_UNAVAILABLE'});
  return {receipt:await options.acceptPremise(authority,statement,origin)};
 }));
 app.post<{Body:{projectId:string;taskId:string;proposalHash:string;decision:'approve'|'decline';acceptedFields?:string[]}}>('/api/research/knowledge-map/domain-decisions',{schema:{body:domainDecisionInput}},async(request,reply)=>mapResponse(reply,async()=>{
  const {projectId,taskId,proposalHash,decision,acceptedFields}=request.body;await actor(projectId);
  if(!options.domainDecision)return reply.code(503).send({error:'DOMAIN_DECISION_UNAVAILABLE'});
  const task=await options.domainDecision(projectId,taskId,proposalHash,decision,acceptedFields);
  return {task:publicResearchTask(task),maintenance:await admit(projectId)};
 }));
 app.get<{Querystring:{projectId:string}}>('/api/research/knowledge-map',{schema:{querystring:query}},async(request,reply)=>mapResponse(reply,async()=>{
  const authority=await actor(request.query.projectId);
  const inspection=await options.library.knowledgeMap.inspect(authority);
  return {...inspection,tasks:(await options.tasks(authority.projectId)).map(publicResearchTask)};
 }));

 app.post<{Body:MapSeedInput}>('/api/research/knowledge-map/seeds',{schema:{body:seedInput}},async(request,reply)=>mapResponse(reply,async()=>{
  const authority=await actor(request.body.projectId);
  const receipt=await options.library.knowledgeMap.importSeeds(request.body,authority);
  return {...receipt,maintenance:{status:'on-demand'}};
 }));

 app.post<{Body:{projectId:string;requestId:string;ref:MapRef;status:'disputed'|'withdrawn';reason:string}}>('/api/research/knowledge-map/observations/status',{schema:{body:observationStatus}},async(request,reply)=>mapResponse(reply,async()=>{
  const {projectId,...change}=request.body;
  return options.library.knowledgeMap.changeObservationStatus(change,await actor(projectId));
 }));

 app.post<{Body:{projectId:string;requestId:string;expectedProfileVersion:number;accepted:MapRef[]}}>('/api/research/knowledge-map/profile',{schema:{body:profileInput}},async(request,reply)=>mapResponse(reply,async()=>{
  const authority=await actor(request.body.projectId),{requestId,expectedProfileVersion,accepted}=request.body;
  return {profile:await options.library.knowledgeMap.updateProfile({requestId,expectedVersion:expectedProfileVersion,accepted},authority)};
 }));

 app.post<{Body:{projectId:string;requestId:string;sourceKeys:string[]}}>('/api/research/knowledge-map/backfill',{schema:{body:backfillInput}},async(request,reply)=>mapResponse(reply,async()=>{
  const authority=await actor(request.body.projectId);
  if(!options.backfill)return reply.code(503).send({error:'MAP_BACKFILL_UNAVAILABLE',message:'Historical source conversion is not connected.'});
  const receipt=await options.backfill(authority.projectId,request.body.sourceKeys,request.body.requestId);
  return {receipt,maintenance:await admit(authority.projectId)};
 }));
 app.post<{Body:{projectId:string;taskId:string}}>('/api/research/knowledge-map/retry',{schema:{body:retryInput}},async(request,reply)=>mapResponse(reply,async()=>{
  const authority=await actor(request.body.projectId);
  if(!options.retry)return reply.code(503).send({error:'MAP_RETRY_UNAVAILABLE',message:'Knowledge task recovery is not connected.'});
  const task=await options.retry(authority.projectId,request.body.taskId);
  return {task:publicResearchTask(task),maintenance:await admit(authority.projectId)};
 }));
}
