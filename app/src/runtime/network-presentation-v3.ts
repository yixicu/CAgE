import type {NetworkSelectionV3,RouteCardV3} from '../learning/method-network-v3.js';
export type NetworkPresentationRevisionV3='progressive-navigation-v1';
/** Initial navigation only. The full selection remains a host validation record, not body/detail exposure. */
export function initialNetworkPresentationV3(selection:NetworkSelectionV3,revision?:NetworkPresentationRevisionV3):string {
 const original=JSON.stringify(selection);
 if(revision===undefined)return original;
 if(revision!=='progressive-navigation-v1')throw new Error('Unsupported frozen network presentation revision.');
 const detailsOmitted=['title','summary','roles'];
 const preview=({title:_title,summary:_summary,roles:_roles,...route}:RouteCardV3)=>({...route,detailsOmitted});
 const compact=JSON.stringify({...selection,presentationRevision:revision,detailsOmitted,
  detailReader:'Each route preview omits the listed descriptive fields. Expand exact ref with retrieve_knowledge {view:"routes",refs:["route-id:version"]}; read the complete exact resourceRef with read_research_resource before relying on it. Omitted detail is not read or exposed.',
  clusters:selection.clusters.map(cluster=>({...cluster,routes:cluster.routes.map(preview)})),routes:selection.routes.map(preview)});
 // Tiny/empty selections retain all detail when the preview envelope would cost more.
 return Buffer.byteLength(compact)<Buffer.byteLength(original)?compact:original;
}
