import {classifyField} from './taxonomy';
import {scatter} from './scatter';
import type { CapabilityItem, CapabilityNetwork } from '../../src/server/capabilities-types';
export const routeKey = (ref: { id: string; version: number | string }) => `${ref.id}@${ref.version}`;
export interface PositionedNode { item: CapabilityItem; x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const NODE_WIDTH = 132, NODE_HEIGHT = 112;
/** Group by scientific subject and preserve the authored relation direction. */
export function prepareLayout(items: CapabilityItem[], network: Pick<CapabilityNetwork, 'routes' | 'links'>) {
  const inventory = [...items].sort((a, b) => compare(a.key, b.key));
  const byResource = new Map<string, CapabilityItem>();
  for (const item of inventory) if (!byResource.has(routeKey(item))) byResource.set(routeKey(item), item);
  const canonical = [...byResource.values()];
  const routes = new Map(network.routes.flatMap(route => {
    const item = byResource.get(routeKey(route.resourceRef)); return item && item.available !== false ? [[routeKey(route), item.key] as const] : [];
  }));
  const links = [...network.links].sort((a, b) => compare(routeKey(a), routeKey(b))).flatMap(link => {
    const fromKey = routes.get(routeKey(link.from)), toKey = routes.get(routeKey(link.to));
    return fromKey && toKey ? [{ ...link, key: routeKey(link), fromKey, toKey, directed: ['requires', 'supports', 'refutes'].includes(link.relation) }] : [];
  });
  const points=scatter(canonical.map(item=>item.key),links.map(l=>({from:l.fromKey,to:l.toKey})),180,new Map(canonical.map(i=>[i.key,classifyField(i.subjectTags)])));
  return (availableWidth:number,offsets:Record<string,Point>={})=>{
  const positioned=new Map(Array.from(points,([k,p])=>[k,{...p,x:p.x+(offsets[k]?.x??0),y:p.y+(offsets[k]?.y??0)}]));
  const nodes=canonical.map(item=>({...positioned.get(item.key)!,item,width:NODE_WIDTH,height:NODE_HEIGHT}));
  const edges=links.map(link=>{
    const a=positioned.get(link.fromKey)!,b=positioned.get(link.toKey)!;
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    const start={x:a.x+66+34*dx/length,y:a.y+38+34*dy/length};
    const end={x:b.x+66-37*dx/length,y:b.y+38-37*dy/length};
    const path=a===b?`M${a.x+34},${a.y+28}c-48,-62 100,-64 62,0`:`M${start.x},${start.y} L${end.x},${end.y}`;
    return {...link,start,end,points:[start,end],path};
  });
  return {nodes,edges,width:Math.max(availableWidth,...nodes.map(n=>n.x+190)),height:Math.max(240,...nodes.map(n=>n.y+160))};
}
}
export function layoutNetwork(items:CapabilityItem[],network:Pick<CapabilityNetwork,"routes"|"links">,availableWidth:number){return prepareLayout(items,network)(availableWidth)}
