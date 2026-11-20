import {DirectedRouteInputError,type DirectedRouteQuery} from '../../../learning/directed-route.js';
import {LearningDataError} from '../../../learning/research-data.js';
import type {ResearchLibrary} from '../../../learning/research-library.js';

export interface AlternateMethodRead {query:DirectedRouteQuery;open?:number;revision?:string}
export async function readAlternateMethod(read:AlternateMethodRead,library:ResearchLibrary){
 read.revision??=(await library.freezeKnowledgeView()).revision;
 try{
  const page=await library.readDirectedRoutes(read.revision,read.query,async()=>[]);
  if(read.open===undefined)return page;
  const selected=page.entries.find(entry=>entry.selection===read.open);
  if(!selected)return {...page,notice:'Choose a method or strategy from this page.'};
  const {body}=await library.readKnowledgeResource(selected.ref,{purpose:'theorist-bootstrap',revision:read.revision,allowedRefs:[selected.ref]});
  return {...page,opened:{name:selected.name,selection:selected.selection,body}};
 }catch(error){
  if(error instanceof DirectedRouteInputError||error instanceof LearningDataError)return {notice:error.message};
  throw error;
 }
}
