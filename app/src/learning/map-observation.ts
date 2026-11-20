import {Type,type Static} from 'typebox';
import {Value} from 'typebox/value';

const text=Type.String({pattern:'\\S'});
export const MapObservationSchema=Type.Object({
 system:text,observable:text,value:text,units:text,conditions:text,uncertainty:text,
 sourceLocator:Type.String({pattern:'\\S',description:'Original paper or data release and exact table, figure, or data item.'}),
 calibration:Type.Optional(text),reduction:Type.Optional(text),dependencies:Type.Optional(Type.Array(text)),
},{additionalProperties:false});
export type MapObservation=Static<typeof MapObservationSchema>;
export const validMapObservation=(value:unknown):value is MapObservation=>Value.Check(MapObservationSchema,value);
export function observationSourceBody(excerpt:string,observation:MapObservation){
 return excerpt+'\n\nReported measurement:\n'+JSON.stringify(observation,Object.keys(observation).sort());
}
export function observationSummary(o:MapObservation){
 return `${o.system} — ${o.observable}: ${o.value} ${o.units}. ${o.conditions}. ${o.uncertainty}`;
}
