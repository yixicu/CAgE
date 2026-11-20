import {Type, type Static} from 'typebox';
import {Value} from 'typebox/value';
import type {ResearchLibrary,KnowledgePublicationAuthorityV4} from './research-library.js';
import type {KnowledgeNode,KnowledgeProposal,KnowledgeRef} from './knowledge-network.js';
import {knowledgeRefKey} from './knowledge-network.js';
import {stableHash} from './research-hash.js';
import {LearningDataError} from './research-data.js';

const strings=Type.Array(Type.String());
export const knowledgeLearningSchema=Type.Object({
 associations:Type.Optional(Type.Object({object:Type.Optional(strings),method:Type.Optional(strings),process:Type.Optional(strings)},{additionalProperties:false})),
 steps:Type.Optional(Type.Array(Type.Object({selection:Type.Integer({minimum:1}),conditions:strings},{additionalProperties:false}))),
 links:Type.Optional(Type.Array(Type.Object({selection:Type.Integer({minimum:1}),relation:Type.Union(['same-object','same-method','similar-process'].map(x=>Type.Literal(x))),basis:Type.String({minLength:1}),conditions:strings},{additionalProperties:false}))),
},{additionalProperties:false,description:'Optional knowledge navigation. Steps are ordered Strategy-to-Skill occurrences; repetitions are meaningful. Cross-kind links allow similar-process only here. Shared-theory navigation requires separately reviewed theory bindings. Omit unsupported relations.'});
export interface KnowledgeLearningView {
 recipe:'knowledge-network-v1';revision:string;networkRevision:number;
 entries:{selection:number;node:KnowledgeNode;body:string}[];
}
export async function freezeKnowledgeLearning(library:ResearchLibrary,text:string,purpose:'method-learning'|'strategy-learning'):Promise<KnowledgeLearningView>{
 const view=await library.freezeKnowledgeView(),refs=view.refs.filter(r=>r.store==='library');
 const grant={purpose,allowedRefs:refs,revision:view.revision};
 const selection=await library.queryKnowledgeView(view,{text},grant),entries:KnowledgeLearningView['entries']=[];
 for(const candidate of selection.nodes){
  const resource=await library.readKnowledgeResource(candidate.node.ref,grant);
  entries.push({selection:candidate.selection,node:candidate.node,body:resource.body});
 }
 return {recipe:'knowledge-network-v1',revision:view.revision,networkRevision:view.network.revision,entries};
}
export async function publishKnowledgeLearning(library:ResearchLibrary,view:KnowledgeLearningView,output:unknown,ownerRef:{id:string;version:number},authority:KnowledgePublicationAuthorityV4,modelDirectedKnowledge?:true){
 if(!Value.Check(knowledgeLearningSchema,output))throw new LearningDataError('INVALID_INPUT','Invalid optional knowledge navigation');
 const candidate=output as Static<typeof knowledgeLearningSchema>,current=await library.freezeKnowledgeView();
 const owner=current.network.nodes.find(n=>n.ref.store==='library'&&n.ref.id===ownerRef.id&&n.ref.version===ownerRef.version);
 if(!owner)throw new LearningDataError('STALE_SOURCE','Published knowledge owner unavailable');
 const select=(selection:number):KnowledgeRef=>{const row=view.entries.find(r=>r.selection===selection);if(!row)throw new LearningDataError('FORBIDDEN','Knowledge selection was not exposed');return row.node.ref;};
 const allowedRefs=[owner.ref,...(modelDirectedKnowledge?[...candidate.steps??[],...candidate.links??[]].map(item=>select(item.selection)):view.entries.map(e=>e.node.ref))];
 const proposal:KnowledgeProposal={owner:owner.ref,purpose:owner.kind==='specific-strategy'?'strategy-learning':'method-learning',reviewed:true,
  receiptId:'learning_knowledge_'+authority.jobId,expectedRevision:current.network.revision,allowedRefs,
  ...(candidate.associations?{nodes:[{...owner,associations:candidate.associations}]}:{}),
  ...(candidate.steps?{composition:{strategy:owner.ref,steps:candidate.steps.map(step=>({skill:select(step.selection),conditions:step.conditions}))}}:{}),
  ...(candidate.links?{links:candidate.links.map(link=>({from:owner.ref,to:select(link.selection),relation:link.relation,basis:link.basis,conditions:link.conditions}))}:{}),
 };
 // Revalidation uses exact delivered endpoints, never newer replacements.
 const available=new Set((modelDirectedKnowledge?await library.availableKnowledgeRefs(allowedRefs):current.refs).map(knowledgeRefKey));
 if(!allowedRefs.every(r=>available.has(knowledgeRefKey(r))))throw new LearningDataError('STALE_SOURCE','Knowledge learning source withdrawn');
 return library.publishKnowledgeProposal(proposal,authority);
}
export const knowledgeLearningBinding=(view:KnowledgeLearningView)=>stableHash(view);
