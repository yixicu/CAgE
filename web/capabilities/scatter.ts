// Settle once per inventory change. No animation loop or physics dependency.
export function scatter(keys:string[], links:{from:string;to:string}[], spacing=180, subjects=new Map<string,string>()) {
  const points=keys.map((key,i)=>({key,x:spacing*Math.sqrt(i)*Math.cos(i*2.4),y:spacing*Math.sqrt(i)*Math.sin(i*2.4)}));
  const groups=new Map<string,typeof points>();
  for(const p of points){const group=subjects.get(p.key)||'general';if(!groups.has(group))groups.set(group,[]);groups.get(group)!.push(p)}
  if(groups.size>1){
    let i=0;const radius=spacing*Math.sqrt(keys.length)*.85;
    for(const group of [...groups.keys()].sort()){const angle=2*Math.PI*i++/groups.size;
      groups.get(group)!.forEach((p,j)=>{p.x=radius*Math.cos(angle)+spacing*Math.sqrt(j)*Math.cos(j*2.4);p.y=radius*Math.sin(angle)+spacing*Math.sqrt(j)*Math.sin(j*2.4)})}
  }
  const anchors=new Map(points.map(p=>[p.key,{x:p.x,y:p.y}]));
  const index=new Map(points.map(p=>[p.key,p]));
  for(let pass=0;pass<36;pass++){
    for(const link of links){
      const a=index.get(link.from), b=index.get(link.to);
      if(!a||!b||a===b)continue;
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
      const pull=Math.max(0,d-spacing*1.5)*.07/d;
      a.x+=dx*pull;a.y+=dy*pull;b.x-=dx*pull;b.y-=dy*pull;
    }
    if(groups.size>1)for(const p of points){const home=anchors.get(p.key)!;p.x+=(home.x-p.x)*.12;p.y+=(home.y-p.y)*.12}
    const cells=new Map<string,typeof points>();
    for(const p of points){
      const x=Math.floor(p.x/spacing),y=Math.floor(p.y/spacing);
      for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)for(const q of cells.get(i+','+j)??[]){
        const dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy)||1;
        const repel=Math.max(0,spacing-d)*.5/d;
        p.x+=dx*repel;p.y+=dy*repel;q.x-=dx*repel;q.y-=dy*repel;
      }
      const cell=x+','+y;if(!cells.has(cell))cells.set(cell,[]);cells.get(cell)!.push(p);
    }
  }
  const left=Math.min(0,...points.map(p=>p.x)),top=Math.min(0,...points.map(p=>p.y));
  for(const p of points){p.x+=60-left;p.y+=60-top}
  return index;
}
