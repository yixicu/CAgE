import {Type,type TSchema} from 'typebox';
import {ContractValidationError,exact} from './strict-schema.js';

/** The original manuscript and all other declaration fields have already been supplied. */
export interface MetadataField {path:string[];message:string;expected?:string;schema?:TSchema}
export class DeclarationSupplementError extends ContractValidationError {
  constructor(issues:readonly string[], readonly fields:'action'|'measured-outcome'|'refutation-kind'|'map-metadata',readonly metadata:MetadataField[]=[]) { super(issues,'semantic'); }
  get schema() {
    if(this.fields==='map-metadata')return Type.Object(Object.fromEntries(this.metadata.map((slot,i)=>['field_'+(i+1),slot.schema?{...slot.schema,description:slot.message}:slot.expected?Type.Literal(slot.expected,{description:slot.message}):Type.String({minLength:1,description:slot.message})])),{additionalProperties:false});
    if(this.fields==='refutation-kind')return Type.Object({
      outcome:Type.Object({refutationKind:Type.Union([Type.Literal('counterexample'),Type.Literal('contradiction')])},{additionalProperties:false})
    },{additionalProperties:false});
    return this.fields==='action' ? Type.Object({action:Type.Literal('pause')},{additionalProperties:false})
      : Type.Object({action:Type.Union([Type.Literal('pause'),Type.Literal('complete')]),
          outcome:Type.Object({resultKind:Type.Union([Type.Literal('open'),Type.Literal('empirical-exclusion')])},{additionalProperties:false})},{additionalProperties:false});
  }
  restore(original:unknown, patch:unknown):unknown {
    exact(this.schema,patch);
    if(this.fields==='map-metadata'){
      const next=structuredClone(original) as Record<string,unknown>;
      for(const [i,{path}] of this.metadata.entries()){
        let row=next;for(const part of path.slice(0,-1))row=row[part] as Record<string,unknown>;
        row[path.at(-1)!]=(patch as Record<string,unknown>)['field_'+(i+1)];
      }
      return next;
    }
    const first=original as {outcome:Record<string,unknown>}, update=patch as {action?:string;outcome?:Record<string,unknown>};
    return {...first,...update,...(update.outcome?{outcome:{...first.outcome,...update.outcome}}:{})};
  }
}
