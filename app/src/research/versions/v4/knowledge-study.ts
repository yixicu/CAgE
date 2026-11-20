import {DirectedRouteInputError,directedRoutePresentation,type DirectedRouteSelection,type DirectedRouteQuery} from '../../../learning/directed-route.js';
import type {KnowledgeNetworkState,KnowledgeRef,KnowledgeSelection} from '../../../learning/knowledge-network.js';
import {routeSelectionPresentation} from '../../../learning/knowledge-map-presentation.js';
import {knowledgeRefKey} from '../../../learning/knowledge-network.js';

/** A frozen host view and ordinary research notes; never a foreground proof form. */
export interface KnowledgeStudyV4 {
 presentation?:'layered-map-v1';proofRefs?:string[];proofExposureRefs?:string[];lastRead?:{ref:KnowledgeRef;detail?:'proof'};proofPhase?:'research'|'review';
 readNotice?:string;phaseOpened?:string[];
 selectors?:{selection:number;ref:KnowledgeRef}[];
 family?:{parent:KnowledgeRef;relation:'revises'|'narrows';argument:string};
 routeQuery?:DirectedRouteQuery;
 query?:{text:string;offset?:number};
 recipe:'knowledge-network-v1';
 libraryRevision:string;
 theoryRevision:string;
 network:KnowledgeNetworkState;
 allowedRefs:KnowledgeRef[];
 selection:KnowledgeSelection;
 opened:{ref:KnowledgeRef;body:string;scientificStatus?:'candidate'|'supported'}[];
 bindings:{subject:KnowledgeRef;argument:string;conditions:string[]}[];
}
export interface KnowledgeStudyReplyV4 {
 action:'query-knowledge'|'open-knowledge'|'bind-knowledge'|'revise';
 body:string;
 selection?:number;
 offset?:number;
 conditions?:string[];
 /** Only the host may attach these after resolving the frozen selector. */
 knowledge?:KnowledgeStudyV4;
}
export function authorizeKnowledgeRead(study:KnowledgeStudyV4,selection:number):KnowledgeRef {
 const selected=study.selectors?study.selectors.find(s=>s.selection===selection)?.ref:study.selection.nodes.find(n=>n.selection===selection)?.node.ref;
 if(!selected||!study.allowedRefs.some(r=>knowledgeRefKey(r)===knowledgeRefKey(selected)))throw new DirectedRouteInputError('Knowledge selection is not granted');
 return selected;
}
export function retainKnowledgeSelectors(study:KnowledgeStudyV4){study.selectors??=[];if('mode'in study.selection){for(const {selection,node} of study.selection.nodes)if(!study.selectors.some(s=>s.selection===selection))study.selectors.push({selection,ref:structuredClone(node.ref)});return;}for(const node of study.selection.nodes){let prior=study.selectors.find(s=>knowledgeRefKey(s.ref)===knowledgeRefKey(node.node.ref));if(!prior){prior={selection:Math.max(0,...study.selectors.map(s=>s.selection))+1,ref:structuredClone(node.node.ref)};study.selectors.push(prior);}node.selection=prior.selection;}}
export const upstreamTheoryGuidance = `Assess all eight theory criteria. Identify the structure shared by a class of problems. Determine its domain, exceptions and justified exclusions beyond the original case. Show the key deductions and what the assumptions rule out. Explain the correspondence between related phenomena. Connect existing theories and credit their sources. Distinguish proved claims, conjectures, physical evidence and unobservable or untested implications. Prefer existing axioms. Treat a replacement as tentative until the evidence supports its consistency and its distinguishing predictions. Identify unmet criteria and retain the work as a finding or candidate when appropriate. Assess the argument itself. To link a supported theory to a method or result, explain the connection and its conditions. Leave Skill and Strategy construction to their respective learning tasks.`;

/** Route methods keep their body; canonical theory text requires an explicit proof read. */
export function knowledgeOpenPresentation(study:KnowledgeStudyV4,opened:KnowledgeStudyV4['opened'][number],detail?:'proof'){
 if(study.presentation!=='layered-map-v1'||opened.ref.store!=='theory'||detail==='proof')return opened;
 const node=study.network.nodes.find(n=>knowledgeRefKey(n.ref)===knowledgeRefKey(opened.ref));
 return {ref:opened.ref,scientificStatus:opened.scientificStatus,title:node?.title?.slice(0,280),conditions:node?.conditions,notice:'Canonical theory content may mix statements and arguments. Use open_knowledge with detail: "proof" to inspect its full text.'};
}
export function knowledgeSelectionPresentation(selection:KnowledgeSelection){
 return 'mode' in selection?directedRoutePresentation(selection as DirectedRouteSelection):routeSelectionPresentation(selection);
}
