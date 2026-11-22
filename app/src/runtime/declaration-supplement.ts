import {Type,type TSchema} from 'typebox';
import {Value} from 'typebox/value';
import {ContractValidationError,exact} from './strict-schema.js';

/** The original manuscript and all other declaration fields have already been supplied. */
export interface MetadataField {path:string[];message:string;expected?:string;schema?:TSchema}
export class DeclarationSupplementError extends ContractValidationError {
  constructor(issues:readonly string[], readonly fields:'action'|'measured-outcome'|'refutation-kind'|'map-metadata'|'omit-extra-fields',readonly metadata:MetadataField[]=[]) { super(issues,'semantic'); }
  get schema() {
    if(this.fields==='map-metadata'||this.fields==='omit-extra-fields')return Type.Object(Object.fromEntries(this.metadata.map((slot,i)=>['field_'+(i+1),slot.schema?{...slot.schema,description:slot.message}:slot.expected?Type.Literal(slot.expected,{description:slot.message}):Type.String({minLength:1,description:slot.message})])),{additionalProperties:false});
    if(this.fields==='refutation-kind')return Type.Object({
      outcome:Type.Object({refutationKind:Type.Union([Type.Literal('counterexample'),Type.Literal('contradiction')])},{additionalProperties:false})
    },{additionalProperties:false});
    return this.fields==='action' ? Type.Object({action:Type.Literal('pause')},{additionalProperties:false})
      : Type.Object({action:Type.Union([Type.Literal('pause'),Type.Literal('complete')]),
          outcome:Type.Object({resultKind:Type.Union([Type.Literal('open'),Type.Literal('empirical-exclusion')])},{additionalProperties:false})},{additionalProperties:false});
  }
  restore(original:unknown, patch:unknown):unknown {
    exact(this.schema,patch);
    if(this.fields==='map-metadata'||this.fields==='omit-extra-fields'){
      const next=structuredClone(original) as Record<string,unknown>;
      for(const [i,{path}] of this.metadata.entries()){
        let row=next;for(const part of path.slice(0,-1))row=row[part] as Record<string,unknown>;
        if(this.fields==='omit-extra-fields')delete row[path.at(-1)!];
        else row[path.at(-1)!]=(patch as Record<string,unknown>)['field_'+(i+1)];
      }
      return next;
    }
    const first=original as {outcome:Record<string,unknown>}, update=patch as {action?:string;outcome?:Record<string,unknown>};
    return {...first,...update,...(update.outcome?{outcome:{...first.outcome,...update.outcome}}:{})};
  }
}

/** Only an explicit model confirmation can remove an undeclared field. */
export function extraDeclarationFields(schema:TSchema,original:unknown):DeclarationSupplementError|undefined {
 const errors=Value.Errors(schema,original).filter(e=>e.keyword==='additionalProperties');
 if(!errors.length)return;
 const fields:MetadataField[]=[];
 for(const e of errors){
  const keys=(e.params as {additionalProperties?:unknown}).additionalProperties;
  if(!Array.isArray(keys)||!keys.every(k=>typeof k==='string'))return;
  const parent=e.instancePath.split('/').slice(1).map(k=>k.replaceAll('~1','/').replaceAll('~0','~'));
  for(const key of keys){
   const pointer=e.instancePath+'/'+key.replaceAll('~','~0').replaceAll('/','~1');
   fields.push({path:[...parent,key],schema:Type.Literal(true),message:pointer+' is outside the declaration schema. Confirm removal only if the declared fields already preserve its scientific meaning.'});
  }
 }
 if(!fields.length)return;
 const supplement=new DeclarationSupplementError(fields.map(f=>f.message),'omit-extra-fields',fields);
 const preview=supplement.restore(original,Object.fromEntries(fields.map((_,i)=>['field_'+(i+1),true])));
 return Value.Check(schema,preview)?supplement:undefined;
}
