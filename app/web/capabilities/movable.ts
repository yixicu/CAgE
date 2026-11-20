export function movable(node:HTMLElement,mode:'dialog'|'canvas'){
 let x=0,y=0,scale=1,startX=0,startY=0,pointer:number|undefined;
 const plane=()=>mode==='dialog'?node:node.querySelector<HTMLElement>('.board,.network-extent')!;
 function paint(){plane().style.translate=x+'px '+y+'px';if(mode==='canvas'&&node.querySelector('.board'))plane().style.scale=String(scale)}
 function down(e:PointerEvent){
  const target=e.target as HTMLElement;
  if(e.button!==0||target.closest('button,input,select,textarea,a')||mode==='dialog'&&!target.closest('header,.resource-heading,.dialog-head'))return;
  pointer=e.pointerId;startX=e.clientX-x;startY=e.clientY-y;node.setPointerCapture(pointer);e.preventDefault()
 }
 function move(e:PointerEvent){if(e.pointerId!==pointer)return;x=e.clientX-startX;y=e.clientY-startY;
 if(mode==='dialog'){const r=node.getBoundingClientRect();const old=node.style.translate.split(' ').map(parseFloat);x=Math.min(innerWidth-64-r.left+(old[0]||0),Math.max(64-r.right+(old[0]||0),x));y=Math.min(innerHeight-48-r.top+(old[1]||0),Math.max(-r.top+(old[1]||0),y))}
 paint()}
 function end(){pointer=undefined}
 function wheel(e:WheelEvent){e.preventDefault();const rect=plane().getBoundingClientRect(),next=Math.max(.2,Math.min(2.5,scale*Math.exp(-e.deltaY*.0015))),ratio=next/scale;x+=(e.clientX-rect.left)*(1-ratio);y+=(e.clientY-rect.top)*(1-ratio);scale=next;paint()}
 node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('lostpointercapture',end);
 if(mode==='canvas'&&node.querySelector('.board'))node.addEventListener('wheel',wheel,{passive:false});
 return {destroy(){node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('lostpointercapture',end);node.removeEventListener('wheel',wheel)}}
}
// Node drags use diagram coordinates. Consume the click only after actual movement.
export function dragNode(node:HTMLButtonElement, apply:(dx:number,dy:number)=>void){
 let x=0,y=0,active=false,moved=false;
 function down(e:PointerEvent){if(e.button!==0)return;active=true;moved=false;x=e.clientX;y=e.clientY;node.setPointerCapture(e.pointerId)}
 function move(e:PointerEvent){if(!active)return;const dx=e.clientX-x,dy=e.clientY-y;if(!moved&&Math.hypot(dx,dy)<4)return;
  moved=true;const scale=node.getBoundingClientRect().width/node.offsetWidth;apply(dx/scale,dy/scale);x=e.clientX;y=e.clientY}
 function end(){active=false}
 function click(e:MouseEvent){if(moved&&e.detail){e.preventDefault();e.stopImmediatePropagation()}moved=false}
 node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('lostpointercapture',end);node.addEventListener('click',click,true);
 return {update(fn:typeof apply){apply=fn},destroy(){node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('lostpointercapture',end);node.removeEventListener('click',click,true)}}
}
