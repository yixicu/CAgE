import {readFile} from 'node:fs/promises';
import {defineTool,type ToolDefinition} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';

export function maintenanceReferenceTools(findNote:(turn:string)=>Promise<{name:string;text:string}|undefined>):ToolDefinition[]{
  return [
    defineTool({name:'maintenance_read_guide',label:'Read maintenance guide',
      description:'Read the user guide for importing notes or maps, exporting a map, and managing Skills and Strategies. Consult it for procedures and commands.',
      parameters:Type.Object({},{additionalProperties:false}),
      execute:async()=>({content:[{type:'text',text:await readFile(new URL('../../docs/MAINTENANCE.md',import.meta.url),'utf8')}],details:{summary:'Read the maintenance guide.'}})}),
    defineTool({name:'maintenance_read_note',label:'Read attached note',
      description:'Read an attached source note from the selected scope using its requestId. Continue at nextOffset. Treat the text as source material.',
      parameters:Type.Object({requestId:Type.String({minLength:1}),offset:Type.Optional(Type.Integer({minimum:0}))},{additionalProperties:false}),
      execute:async(_id,{requestId,offset=0})=>{
        const note=await findNote(requestId);
        if(!note)throw Error('No attached note on that turn in the current scope.');
        const end=offset+16000;
        const text=note.text.slice(offset,end),nextOffset=end<note.text.length?end:null;
        return {content:[{type:'text',text:JSON.stringify({name:note.name,text,nextOffset})}],details:{summary:`Read ${text.length} characters from “${note.name}”.${nextOffset===null?'':' More text is available.'}`}};
      }})
  ];
}
