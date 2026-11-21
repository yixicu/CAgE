import type { MapOpenResult } from '../learning/knowledge-map.js';
import { repairProofLatex, applyProofLatexReplacement } from '../shared/proof-latex.js';

export type ReadNode = MapOpenResult & {title:string};
export interface ProofNotes {
  formulas: { start:number; original:string; replacement:string }[];
  markers?: { selection:string; line:number; original:string; marker:string }[];
  locations: { selection:string; line:number; original:string }[];
}

const marker = /\[\[([^\]\n]{1,256})\]\]|\[([^\]\n]+)\]\(#cage-node-([A-Za-z0-9_-]+)\)/g;
const normalized = (name:string) => name.normalize('NFC').trim().toLowerCase();
const link = (node:ReadNode) => '[' + node.title.replace(/[\\[\]*_<>]/g,'\\$&').replace(/[\r\n]/g,' ') + '](#cage-node-' + node.selection + ')';

// Anchor to actual prose lines. Fences, display math, headings, and source lists cannot locate an inference.
function proofLines(lines:string[], nodes:ReadNode[]) {
  let fence='', math='', bibliographyLevel=0, heading='';
  const result:{index:number;heading:string;prose:string}[]=[];
  const sourceLines=new Set<number>(), equationLines=new Set<number>();
  for(const [index,line] of lines.entries()){
    const trimmed=line.trim();
    const block=trimmed.match(/^(\x60{3,}|~{3,})/);
    if(fence){if(block && block[1]![0]===fence[0] && block[1]!.length>=fence.length)fence='';continue;}
    if(block){fence=block[1]!;continue;}
    if(math){if(!bibliographyLevel)equationLines.add(index);if(trimmed.includes(math))math='';continue;}
    const blockMath=trimmed.match(/^(\$\$|\\\[)/)?.[0];
    if(blockMath){if(!bibliographyLevel)equationLines.add(index);const end=blockMath==='$$'?'$$':'\\]'; if(!trimmed.slice(blockMath.length).includes(end))math=end;continue;}
    const header=trimmed.match(/^(#{1,6})\s+(.+)/);
    if(header){
      if(header[1]!.length<=bibliographyLevel)bibliographyLevel=0;
      heading=header[2]!;
      if(/^(?:(?:(?:knowledge[\s-]+map|map|cited)\s+)?(?:references?|bibliography|sources?|citations?|cited nodes?|nodes used)|(?:cited )?knowledge[\s-]+(?:map|nodes)|starting from the knowledge map|proof outline|参考(?:文献|资料|来源)|(?:引用的?|参考的?|使用的?)(?:知识(?:网格|图谱|图)?(?:中的?)?)?节点|知识(?:图谱|网格)?(?:节点)?引用|证明提纲)\s*[:：]?\s*$/i.test(heading))bibliographyLevel=header[1]!.length;
      continue;
    }
    if(!trimmed||/^(?: {4}|\t|>|<|\|)/.test(line))continue;
    sourceLines.add(index);
    if(bibliographyLevel)continue;
    const remainder=trimmed.replace(marker,' ').replace(/[\s\p{P}]/gu,'');
    if(!remainder)continue;
    const prose=trimmed.replace(marker,' ').replace(/\x60[^\x60]*\x60/g,' ').replace(/^[-*+\d.)\s]+/,'').replace(/[*_]/g,'').trim();
    if(!/[\p{L}]/u.test(prose)||nodes.some(n=>normalized(n.title)===normalized(prose))||/^(?:cited nodes?|references?|sources?|map reads?)\s*[:：]/i.test(prose))continue;
    result.push({index,heading,prose});
  }
  return {passages:result,sourceLines,equationLines};
}

export const emptyProofNotes=():ProofNotes=>({formulas:[],locations:[]});
export function proofMath(body:string,notes:ProofNotes) {
  const math=repairProofLatex(body);
  let markdown=math.markdown;
  const issues:string[]=[];
  const lineShifts:{first:number;last:number;delta:number}[]=[];
  for(const issue of [...math.issues].reverse()){
    const patch=notes.formulas.find(f=>f.start===issue.start&&f.original===issue.original);
    const fixed=patch&&applyProofLatexReplacement(markdown,issue,patch.replacement);
    if(fixed){
      const first=math.markdown.slice(0,issue.start).split('\n').length-1;
      const last=first+issue.original.split('\n').length-1;
      lineShifts.push({first,last,delta:patch.replacement.split('\n').length-issue.original.split('\n').length});
      markdown=fixed;
    }else issues.push('Formula at line '+(math.markdown.slice(0,issue.start).split('\n').length)+': '+issue.message);
  }
  return {markdown,issues,lineFor:(raw:number)=>raw+lineShifts.reduce((delta,s)=>delta+(raw>s.last?s.delta:0),0)};
}

export function proofCitations(markdown:string,reads:MapOpenResult[],declared:string[],notes=emptyProofNotes()){
  const issues:string[]=[],used=new Map<string,MapOpenResult>();
  const useLines=new Map<string,Set<number>>();
  const markUse=(node:ReadNode,line:number)=>{
    used.set(node.selection,node);
    const places=useLines.get(node.selection)??new Set<number>();places.add(line);useLines.set(node.selection,places);
  };
  const badMarkers:{line:number;original:string;marker:string}[]=[];
  const nodes=reads.filter((n):n is ReadNode=>!!n.title&&!!n.ref&&/^map_(?:basis_)?[a-zA-Z0-9_-]+$/.test(n.selection));
  const lines=markdown.split('\n');
  const {passages,sourceLines,equationLines}=proofLines(lines,nodes);
  function resolve(name?:string,label?:string,key?:string){
    const matches=key?nodes.filter(n=>n.selection===key&&normalized(n.title)===normalized(label!)):
      nodes.filter(n=>n.selection===name||normalized(n.title)===normalized(name!));
    const candidates=matches.length>1?matches.filter(n=>declared.includes(n.selection)):matches;
    return candidates.length===1?candidates[0]:undefined;
  }
  for(const p of passages){
    const original=lines[p.index]!;
    const pieces=original.split(/(\x60+[^\x60]*\x60+)/g);
    lines[p.index]=pieces.map((part,i)=>i%2?part:part.replace(marker,(whole,name:string|undefined,label:string|undefined,key:string|undefined)=>{
      const correction=notes.markers?.find(m=>m.line===p.index&&m.original===original&&m.marker===whole);
      const node=resolve(name,label,key)??nodes.find(n=>n.selection===correction?.selection);
      if(!node){
        badMarkers.push({line:p.index,original,marker:whole});
        issues.push('Unresolved citation at line '+(p.index+1)+': '+(name??label));return name??label??whole;
      }
      markUse(node,p.index);return link(node);
    })).join('');
  }
  const missing=nodes.filter(n=>declared.includes(n.selection)&&!used.has(n.selection));
  const anchors=notes.locations;
  const anchorLines=[...lines];
  const insertions=new Map<number,string[]>();
  for(const node of missing){
    const location=anchors.find(a=>a.selection===node.selection&&passages.some(p=>p.index===a.line)&&a.original===lines[a.line]);
    if(!location){issues.push('No verified place of use for '+node.title+'.');continue;}
    const list=insertions.get(location.line)??[];list.push(link(node));insertions.set(location.line,list);
    markUse(node,location.line);
  }
  for(const [i,links] of insertions)lines[i]+=' '+links.join(' ');
  // Older reports often have a real, declared bibliography but no inline locations. Let the
  // reader inspect the exact sources without counting a list entry as a proof step.
  const eligible=new Set(passages.map(p=>p.index));
  for(const i of sourceLines){
    if(eligible.has(i))continue;
    const line=lines[i]!;
    const item=line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.+?)\s*$/);
    const name=item?.[2]?.replace(/^\*\*(.*)\*\*$/,'$1').replace(/^\[\[(.*)\]\]$/,'$1');
    const matches=name?nodes.filter(n=>declared.includes(n.selection)&&normalized(n.title)===normalized(name)):[];
    if(matches.length===1){
      const node=matches[0]!;lines[i]=item![1]+link(node);used.set(node.selection,node);
    }else{
      lines[i]=line.split(/(\x60+[^\x60]*\x60+)/g).map((part,index)=>index%2?part:part.replace(marker,(whole,_name,label,key)=>key?label:whole)).join('');
    }
  }

  return {markdown:lines.join('\n'),nodes,passages,equationLines,anchorLines,useLines,badMarkers,issues,citations:[...used.values()]};
}

export function annotateProof(body:string,reads:MapOpenResult[],declared:string[],notes=emptyProofNotes()){
  const math=proofMath(body,notes);
  const citations=proofCitations(math.markdown,reads,declared,notes);
  const issues=[...new Set([...math.issues,...citations.issues])];
  return {view:{...(citations.markdown!==body?{displayBody:citations.markdown}:{}),...(citations.citations.length?{citations:citations.citations}:{}),
    ...(issues.length?{presentationIssues:issues}:{})}};
}
