import {scatter} from './scatter';

const referenceCount=77;
export function globeRadius(count:number){
 return 900*Math.sqrt(Math.max(12,count)/referenceCount);
}

export function planarLayout(keys:string[],links:{from:string;to:string}[],fields:Map<string,string>){
 const points=scatter(keys,links,235,fields);
 // Preserve approximately the occupied area per node of the original Core map.
 // Dense cross-field edges can otherwise pull the larger spiral back into its centre.
 if(keys.length>referenceCount){
   let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
   for(const p of points.values()){
     left=Math.min(left,p.x);right=Math.max(right,p.x);
     top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);
   }
   const area=Math.max(235,right-left)*Math.max(235,bottom-top);
   const growth=Math.max(1,413*Math.sqrt(keys.length/area));
   const bins=new Map<string,Position[]>();
   const cardWidth=240,cardHeight=90;
   function occupied(x:number,y:number){
     const col=Math.floor(x/cardWidth),row=Math.floor(y/cardHeight);
     for(let i=col-1;i<=col+1;i++)for(let j=row-1;j<=row+1;j++){
       if(bins.get(i+','+j)?.some(q=>Math.abs(q.x-x)<cardWidth && Math.abs(q.y-y)<cardHeight))return true;
     }
     return false;
   }
   for(const p of points.values()){
     const x=left+(p.x-left)*growth,y=top+(p.y-top)*growth;
     p.x=x;p.y=y;
     // Only crowded cards move further. Search outwards within their field neighbourhood.
     for(let step=1;occupied(p.x,p.y);step++){
       p.x=Math.max(cardWidth/2,x+Math.cos(step*golden)*cardWidth*Math.sqrt(step));
       p.y=Math.max(cardHeight/2,y+Math.sin(step*golden)*cardHeight*Math.sqrt(step));
     }
     const cell=Math.floor(p.x/cardWidth)+','+Math.floor(p.y/cardHeight);
     if(!bins.has(cell))bins.set(cell,[]);
     bins.get(cell)!.push(p);
   }
 }
 return points;
}

type Position={x:number;y:number};
type Anchor={lon:number;lat:number};
const golden=Math.PI*(3-Math.sqrt(5));

/** Split a jittered Fibonacci sphere by spatial medians, giving each field one neighbourhood. */
export function sphericalLayout(groups:Map<string,string[]>){
 const keys=[...groups.keys()].sort();
 const count=[...groups.values()].reduce((n,g)=>n+g.length,0);
 const slots=Array.from({length:count},(_,i)=>{
   const noise=(j:number)=>{const n=Math.sin((i+1)*j)*43758.5453;return n-Math.floor(n)-.5};
   const y=1-2*(i+.5+noise(78.23)*.65)/count,lat=Math.asin(y),r=Math.cos(lat);
   const lon=i*golden+noise(19.17)*1.3/(Math.sqrt(count)*Math.max(.1,r));
   return {lon,lat,x:r*Math.sin(lon),y,z:r*Math.cos(lon)};
 });
 const result=new Map<string,Anchor>();
 function divide(fields:string[],points:typeof slots){
   if(fields.length<2){const ids=groups.get(fields[0]!)??[];[...ids].sort().forEach((k,i)=>result.set(k,points[i]!));return}
   const axes=['x','y','z'] as const;
   const spread=(axis:typeof axes[number])=>{let min=Infinity,max=-Infinity;for(const p of points){min=Math.min(min,p[axis]);max=Math.max(max,p[axis])}return max-min};
   const axis=[...axes].sort((a,b)=>spread(b)-spread(a))[0]!;
   points.sort((a,b)=>a[axis]-b[axis]);
   const split=Math.ceil(fields.length/2),left=fields.slice(0,split);
   const cut=left.reduce((n,f)=>n+groups.get(f)!.length,0);
   divide(left,points.slice(0,cut));divide(fields.slice(split),points.slice(cut));
 }
 if(keys.length)divide(keys,slots);
 return result;
}

export function fieldWashes(groups:Map<string,Position[]>){
 return [...groups].map(([field,points])=>{
   const n=points.length,x=points.reduce((s,p)=>s+p.x,0)/n,y=points.reduce((s,p)=>s+p.y,0)/n;
   const rx=Math.sqrt(points.reduce((s,p)=>s+(p.x-x)**2,0)/n);
   const ry=Math.sqrt(points.reduce((s,p)=>s+(p.y-y)**2,0)/n);
   return {field,x,y,rx:125+rx*2.15,ry:85+ry*2.15};
 });
}

export function arrowPoints(a:Position,b:Position,zoom:number,directed:boolean){
 const segments=directed?Math.min(128,Math.max(2,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*zoom/205))):1;
 return Array.from({length:segments+1},(_,i)=>(a.x+(b.x-a.x)*i/segments)+','+(a.y+(b.y-a.y)*i/segments)).join(' ');
}
