<script lang="ts">
  import {onMount} from 'svelte';
  let handle:HTMLElement;
  let value=$state(96),minimum=$state(35);
  const key='cage.reader-width.v1';
  onMount(()=>{
    const column=handle.closest<HTMLElement>('.conversation')!,host=column.parentElement!;
    let preferred=96,available=0,drag:{id:number;x:number;width:number}|undefined;
    try{const stored=Number(localStorage.getItem(key));if(stored>0&&stored<=100)preferred=stored;}catch{}
    function size(){
      const style=getComputedStyle(host);
      available=host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
      minimum=Math.min(100,Math.ceil(420/Math.max(1,available)*100));
      value=Math.max(minimum,preferred);
      column.style.setProperty('--reader-share',value+'%');
    }
    function change(next:number){
      preferred=Math.min(100,Math.max(minimum,Math.round(next)));size();
    }
    function save(){try{localStorage.setItem(key,String(preferred))}catch{}}
    function start(e:PointerEvent){if(e.button!==0)return;e.preventDefault();handle.focus();drag={id:e.pointerId,x:e.clientX,width:column.getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);}
    function move(e:PointerEvent){if(drag?.id===e.pointerId&&available>0)change(100*(drag.width+2*(e.clientX-drag.x))/available);}
    function end(){if(drag){drag=undefined;save()}}
    function keyboard(e:KeyboardEvent){
      const next=({ArrowRight:value+2,ArrowLeft:value-2,Home:minimum,End:100} as Record<string,number>)[e.key];
      if(next===undefined)return;e.preventDefault();change(next);save();
    }
    function reset(){preferred=96;size();save();}
    const observer=new ResizeObserver(size);observer.observe(host);size();
    handle.addEventListener('pointerdown',start);handle.addEventListener('pointermove',move);handle.addEventListener('lostpointercapture',end);
    handle.addEventListener('keydown',keyboard);handle.addEventListener('dblclick',reset);
    return ()=>{observer.disconnect();handle.removeEventListener('pointerdown',start);handle.removeEventListener('pointermove',move);handle.removeEventListener('lostpointercapture',end);handle.removeEventListener('keydown',keyboard);handle.removeEventListener('dblclick',reset);};
  });
</script>
<div class="grip" bind:this={handle} role="slider" aria-orientation="horizontal" tabindex="0" aria-label="Reading width" aria-valuemin={minimum} aria-valuemax="100" aria-valuenow={value} aria-valuetext={value+'% of the reading area'} title="Drag to resize the report · double-click to reset"><i aria-hidden="true"></i></div>
<style>
 .grip{position:absolute;z-index:2;right:-1.55rem;top:0;width:1.45rem;height:3.5rem;display:grid;place-items:center;touch-action:none;cursor:ew-resize;user-select:none}
 i{width:5px;height:25px;border-inline:1.5px solid var(--color-muted);opacity:.65}
 .grip:hover i,.grip:focus-visible i{border-color:var(--color-accent);opacity:1}
 .grip:focus-visible{outline:2px solid var(--color-accent);outline-offset:-4px}
 @media(max-width:900px){.grip{display:none}}
</style>
