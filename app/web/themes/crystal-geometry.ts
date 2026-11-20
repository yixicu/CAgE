import type { CrystalTheme } from './catalog';
type V=[number,number,number];
const add=(a:V,b:V):V=>a.map((v,i)=>v+b[i]) as V;
const mul=(a:V,s:number):V=>a.map(v=>v*s) as V;
const dot=(a:V,b:V)=>a.reduce((v,n,i)=>v+n*b[i],0);
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(p:V):V=>mul(p,1/Math.hypot(...p));
const view=unit([1,1,1.1]),right=unit([1,-1,0]),down=unit(cross(right,view));
const light=unit(add(add(mul(right,-1),mul(down,-1.5)),mul(view,2)));
export interface CrystalFace {points:string;fill:string;shade:string;edge:string;depth:number;}
/** Continuous L-shaped growth bed: a full-height right ridge joined to a
 * bottom bed that crosses the navigation rail. Shared related axes, not bouquets. */
const noise=(n:number)=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
const beds=[
 ...Array.from({length:8},(_,i)=>({x:1480+noise(i)*65,y:50+i*145+noise(i+23)*55,angle:-2.35,scale:.95+noise(i+37)*.4})),
 ...Array.from({length:8},(_,i)=>({x:1370-i*190+noise(i+52)*60,y:1070+noise(i+62)*65,angle:i%3===0?-.72:-2.4,scale:.95+noise(i+71)*.4})),
];
export function crystalClusters(theme:CrystalTheme,narrow=false):CrystalFace[][] {
 const c=theme.crystal;
 return beds.map((bed,group)=>{
  const faces:CrystalFace[]=[];
  const x=bed.x-(theme.id==='amber'&&group<8?90:0);
  const bx=narrow?x*700/1440:x;
  const by=bed.y-(group>=8?(theme.id==='blue'?0:75):0);
  for(let k=0;k<5;k++){
   // Related lattice directions with non-periodic heights, spacing and occlusion.
   const layer=Math.floor(k/3);
   const seed=group*19+k*3;
   const angle=(group<8&&k===3&&theme.id!=='blue'?-1.62:bed.angle)+(noise(seed)-.5)*.24;
   const growth=add(mul(right,Math.cos(angle)),mul(down,Math.sin(angle)));
   const axis=theme.id==='blue'?unit(add(mul(growth,.28),mul(view,.96))):unit(add(growth,mul(view,theme.id==='amber'?.85:.38+(k%4)*.08)));
   const u=unit(cross(axis,view)),v=unit(cross(axis,u));
   const size=(.62+noise(seed+2)*.72)*bed.scale*(narrow?.76:1);
   const radius=c.radius*size*(theme.id==='blue'?.95:theme.id==='amber'?.9:.62);
   const length=c.depth*size*(theme.id==='blue'?1.5:theme.id==='amber'?.9:1.4);
   const spread=(noise(seed+4)-.5)*radius*2;
   const base=add(mul(u,spread),theme.id==='blue'?mul(growth,radius*(1.1+layer*.75)):mul(axis,layer*length*.18));
   const origin=add(base,mul(view,(k%4)*15));
   const point=(x:number,y:number,z:number)=>add(origin,add(add(mul(u,x),mul(v,y)),mul(axis,z)));
   const tilt=theme.id==='amber'?0:c.tilt;
   const ring=Array.from({length:c.sides},(_,i):[number,number]=>[radius*Math.cos(tilt+i*2*Math.PI/c.sides),radius*Math.sin(tilt+i*2*Math.PI/c.sides)]);
   const verts:V[]=[...ring.map(([x,y])=>point(x,y,0)),...ring.map(([x,y])=>point(x,y,length*(theme.dark?.78:1)))];
   const indices:number[][]=ring.map((_,i)=>[i,(i+1)%c.sides,(i+1)%c.sides+c.sides,i+c.sides]);
   if(theme.dark){
    verts.push(...ring.map(([x,y])=>point(x*.2,y*.2,length)));
    indices.push(...ring.map((_,i)=>[i+c.sides,(i+1)%c.sides+c.sides,(i+1)%c.sides+2*c.sides,i+2*c.sides]));
    indices.push(ring.map((_,i)=>i+2*c.sides));
   }else{
    if(c.shear)for(let i=c.sides;i<verts.length;i++)verts[i]=add(verts[i],mul(u,c.shear*size));
    indices.push(ring.map((_,i)=>i+c.sides));
   }
   for(const idx of indices){
    const p=idx.map(i=>verts[i]);const normal=unit(cross(add(p[1],mul(p[0],-1)),add(p[2],mul(p[0],-1))));
    if(dot(normal,view)<=0)continue;
    const illumination=Math.max(0,dot(normal,light));
    const l=theme.dark?13+illumination*19:(theme.material?.lightness??88)+illumination*(theme.material?.range??10);
    faces.push({points:p.map(pt=>`${(bx+dot(pt,right)).toFixed(1)},${(by+dot(pt,down)).toFixed(1)}`).join(' '),
      fill:`hsl(${c.hue} ${c.saturation}% ${l}%)`,shade:`hsl(${c.hue} ${c.saturation}% ${l-(theme.dark?2:theme.material?.shade??1.5)}%)`,
      edge:`hsl(${c.hue} ${c.saturation}% ${theme.dark?62:100}%)`,depth:p.reduce((sum,pt)=>sum+dot(pt,view),0)/p.length});
   }
  }
  return faces.sort((a,b)=>a.depth-b.depth);
 });
}
