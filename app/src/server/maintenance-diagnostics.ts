import {defineTool,type ToolDefinition} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import type {AnyResearchProject} from '../research/contracts/loop.js';
import type {ResearchLibrary} from '../learning/research-library.js';
import {getV4Coordinator} from '../research/versions/v4/coordinator.js';
import type {LearningService} from '../learning/learning-service.js';

export function maintenanceDiagnostics(read:()=>Promise<AnyResearchProject>,learning:LearningService,library:ResearchLibrary,dataRoot:string):ToolDefinition {
  return defineTool({
    name:'maintenance_read_rounds',label:'Read project diagnostics',
    description:'Inspect saved round outcomes, known errors and background learning status for the selected project. Supply a V4 epoch number for its public reports and call statuses.',
    parameters:Type.Object({epoch:Type.Optional(Type.Integer({minimum:1}))},{additionalProperties:false}),
    async execute(_id,{epoch}){
      const project=await read();
      const base={projectId:project.id,name:project.name,status:project.status,lastError:'lastError' in project?project.lastError:undefined};
      const jobs=learning.tasks(project.id).slice(-20).map(({id,kind,status,message})=>({id,kind,status,message}));
      let rounds:unknown[]=[];
      if(project.schemaVersion===3){
        const epochs=new Map([...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])].map(e=>[e.epoch,e]));
        if(epoch!==undefined&&!epochs.has(epoch))throw Error('This project has no saved record for that epoch.');
        rounds=(epoch===undefined?[...epochs.values()].slice(-20):[epochs.get(epoch)!]).map(e=>({
          epoch:e.epoch,phase:e.phase,...('decision' in e?{decision:e.decision,reason:e.reason}:{}),
          ...(epoch===undefined?{}:{calls:e.calls.map(c=>({id:c.id,task:c.task,status:c.status,error:c.captured?.technical.errorCategory})),
            reports:e.optionalFlow?.artifacts.filter(a=>a.publicReport).map(a=>({id:a.id,body:a.publicReport!.body,originalQualification:a.qualification,currentAssessment:library.reportAssessment(project.id,a.id)?.status}))})
        }));
      }
      let background:unknown[]=[];
      if(project.researchLoopVersion==='4.0'){
        const coordinator=getV4Coordinator(dataRoot);
        const [reports,mapTasks]=await Promise.all([coordinator.researchReports(project.id),coordinator.mapTasks(project.id)]);
        background=[...reports.slice(-20).map(r=>({kind:'research-review',id:r.id,epoch:r.report.scope.epochId,phase:r.phase,status:r.status,error:r.error})),
          ...mapTasks.slice(-20).map(t=>({kind:'map-maintenance',id:t.id,phase:t.phase,status:t.status,error:t.error}))];
      }
      const result={...base,rounds,jobs,background};
      const summary=`Read diagnostics for ${project.name}${epoch===undefined?'':' at epoch '+epoch}. Project status: ${project.status}. Returned ${rounds.length} round records, ${jobs.length} learning jobs and ${background.length} background tasks.`;
      return {content:[{type:'text',text:JSON.stringify(result)}],details:{...result,summary}};
    }
  });
}

