import { Type } from 'typebox';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {createHash} from 'node:crypto';
import type {FrozenSourceV21} from '../research/contracts/v21.js';
import {fetchDocument,htmlText} from './public-document.js';
import {loadPdf} from './documents.js';

function text(details:Record<string,unknown>) {
  return {details,content:[{type:'text' as const,text:JSON.stringify(details)}]};
}

export function documentTools(userText:string[], sources:FrozenSourceV21[], load:(ref:FrozenSourceV21['ref'])=>Promise<Uint8Array>, plugins:ToolDefinition[]):ToolDefinition[] {
  const urls = new Set<string>();
  const allow = (candidate:string) => {try {urls.add(new URL(candidate).href);} catch { /* incomplete link */ }};
  const allowLinks=(message:string)=>{for(const match of message.matchAll(/https?:\/\/[^\s<>"'`，。；）】]+/gi)){
    allow(match[0]); allow(match[0].replace(/[.,;:)\]]+$/,''));
  }};
  userText.forEach(allowLinks);
  let current:{id:string;url:string;bytes:Buffer;type:string}|undefined;
  const reader:ToolDefinition = {
    name:'read_document',label:'Read document',description:'Open a URL supplied by the user or returned by web_search directly, or use an uploaded PDF source ID. Use find to locate text and nextOffset to continue. For PDFs use page (1-based). If equations, figures, columns or OCR are ambiguous, call again with image:true and the page number to inspect the original page before citing it.',
    parameters:Type.Object({source:Type.String(),page:Type.Optional(Type.Integer({minimum:1})),offset:Type.Optional(Type.Integer({minimum:0})),find:Type.Optional(Type.String({minLength:1,maxLength:500})),image:Type.Optional(Type.Boolean())},{additionalProperties:false}),
    async execute(_id,raw,signal,_update,context) {
      const {source,page=1,offset=0,find,image}=raw as {source:string;page?:number;offset?:number;find?:string;image?:boolean};
      try {
        const attachment=sources.find(s=>s.ref.id===source && /\.pdf$/i.test(s.ref.path));
        let doc=current;
        if(!doc||doc.id!==source){
          if(attachment){
            const bytes=Buffer.from(await load(attachment.ref));
            if(createHash('sha256').update(bytes).digest('hex')!==(attachment.originalHash??attachment.bodyHash))throw Error('Attachment revision changed.');
            doc={id:source,url:attachment.ref.path,bytes,type:'application/pdf'};
          }else{
            if(!URL.canParse(source)||!urls.has(new URL(source).href))throw Error('Choose a URL supplied by the user or returned by search.');
            doc={id:source,...await fetchDocument(source,signal)};
          }
          current=doc;
        }
        const location=doc.url;
        function excerpt(body:string,selectedPage?:number,pages?:number){
          const from=selectedPage!==undefined && selectedPage!==page ? 0 : offset;
          const hit=find?body.toLowerCase().indexOf(find.toLowerCase(),from):from;
          if(hit<0)return text({status:'not_found',location,page:selectedPage,pages});
          const start=find?Math.max(from,hit-300):from, end=Math.min(body.length,start+12000);
          return text({status:'ok',location,page:selectedPage,pages,offset:start,...(end<body.length?{nextOffset:end}:{}),text:body.slice(start,end)});
        }
        if(doc.bytes.subarray(0,1024).includes('%PDF-')){
          const task=await loadPdf(doc.bytes);
          try{
            const pdf=await task.promise;
            for(let n=page;n<=pdf.numPages;n++){
              signal?.throwIfAborted();
              const p=await pdf.getPage(n);
              if(image){
                if(context?.model && !context.model.input.includes('image'))return text({status:'unavailable',reason:'This model accepts text only.'});
                const base=p.getViewport({scale:1}), viewport=p.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});
                const factory=pdf.canvasFactory as {create(w:number,h:number):{canvas:HTMLCanvasElement};destroy(surface:{canvas:HTMLCanvasElement}):void};
                const surface=factory.create(Math.ceil(viewport.width),Math.ceil(viewport.height));
                try{
                  await p.render({canvas:surface.canvas,viewport}).promise;
                  const bytes=(surface.canvas as unknown as {toBuffer(type:string):Buffer}).toBuffer('image/png');
                  return {details:{location,page:n,pages:pdf.numPages},content:[{type:'text',text:location+' page '+n},{type:'image',mimeType:'image/png',data:bytes.toString('base64')}]};
                }finally{factory.destroy(surface);}
              }
              const items=(await p.getTextContent()).items;
              const body=items.map(i=>'str' in i?i.str+(i.hasEOL?'\n':' '):'').join('');
              if(!find && !body.trim())return text({status:'no_text',location,page:n,pages:pdf.numPages,hint:'Call read_document with this page and image:true to inspect the original.'});
              if(!find || body.toLowerCase().indexOf(find.toLowerCase(),n===page?offset:0)>=0){
                return excerpt(body,n,pdf.numPages);
              }
              p.cleanup();
            }
            return text({status:'not_found',location,pages:pdf.numPages});
          }finally{await task.destroy();}
        }
        if(image || !/^(text\/|application\/xhtml\+xml)/i.test(doc.type))throw Error('Source has no supported text or PDF page.');
        const body=new TextDecoder(/charset=["']?([\w-]+)/i.exec(doc.type)?.[1]??'utf-8').decode(doc.bytes);
        const delivered=excerpt(/html/i.test(doc.type)?htmlText(body,location):body);
        if(typeof delivered.details.text==='string')allowLinks(delivered.details.text);
        return delivered;
      }catch(error){return text({status:'unavailable',reason:error instanceof Error?error.message:'Document unavailable'});}
    },
  };
  return [reader,...plugins.map(tool=>tool.name!=='web_search'?tool:{...tool,execute:async(...args:Parameters<ToolDefinition['execute']>)=>{
    const response=await tool.execute(...args);
    for(const hit of (response.details as {results?:{url:string}[]}).results??[])allow(hit.url);
    return response;
  }})];
}
