<script lang="ts">
  import Icon from '../Icon.svelte';
  let {column,scrollport,sticky,onnavigate}:{column:HTMLElement;scrollport:HTMLElement;sticky?:HTMLElement;onnavigate:()=>void}=$props();
  type Heading={element:HTMLElement;title:string;level:number;parent:number;children:boolean};
  let headings=$state.raw<Heading[]>([]),active=$state(-1),expanded=$state<number[]>([]),open=$state(false);
  function visible(i:number){for(let p=headings[i]!.parent;p>=0;p=headings[p]!.parent)if(!expanded.includes(p))return false;return true;}
  const current=$derived.by(()=>{let i=active;while(i>=0&&!visible(i))i=headings[i]!.parent;return i;});
  function position(){return scrollport.getBoundingClientRect().top+(sticky?.getBoundingClientRect().height??0)+18;}
  function follow(){
    const line=position();let index=-1;
    for(const [i,h] of headings.entries()){
      if(!h.element.getClientRects().length)continue;
      if(h.element.getBoundingClientRect().top>line+1)break;
      index=i;
    }
    if(scrollport.scrollHeight>scrollport.clientHeight+1 && scrollport.scrollTop+scrollport.clientHeight>=scrollport.scrollHeight-2)
      index=headings.findLastIndex(h=>h.element.getClientRects().length>0);
    active=index;
  }
  function navigate(i:number){
    const h=headings[i]!.element;
    for(let p=h.parentElement;p&&p!==column;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;
    onnavigate();
    scrollport.scrollTo({top:scrollport.scrollTop+h.getBoundingClientRect().top-position(),behavior:'instant'});
    h.setAttribute('tabindex','-1');h.focus({preventScroll:true});follow();
  }
  $effect(()=>{
    const root=column,port=scrollport,header=sticky;
    let frame=0,content:Element|null=null;
    function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;follow()});}
    const contentObserver=new MutationObserver(scan);
    function scan(){
      const next=root.querySelector('[data-current-report] .research-paper');
      if(next!==content){contentObserver.disconnect();content=next;if(content)contentObserver.observe(content,{childList:true,subtree:true,characterData:true});}
      const list:Heading[]=[],stack:number[]=[];
      for(const h of content?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')??[]){
        if(h.closest('[data-empty-section]'))continue;
        const level=Number(h.tagName.slice(1));
        const label=h.cloneNode(true) as HTMLElement;
        label.querySelectorAll('.katex-html,annotation').forEach(el=>el.remove());
        const title=label.textContent?.trim();if(!title)continue;
        while(stack.length&&list[stack.at(-1)!]!.level>=level)stack.pop();
        const parent=stack.at(-1)??-1;
        if(parent>=0)list[parent]!.children=true;
        stack.push(list.length);list.push({element:h,title,level,parent,children:false});
      }
      headings=list;schedule();
    }
    const mountObserver=new MutationObserver(()=>{if(root.querySelector('[data-current-report] .research-paper')!==content)scan();});
    mountObserver.observe(root,{childList:true,subtree:true});
    const sizes=new ResizeObserver(schedule);sizes.observe(port);sizes.observe(root);if(header)sizes.observe(header);
    port.addEventListener('scroll',schedule,{passive:true});root.addEventListener('toggle',schedule,true);
    scan();
    return ()=>{contentObserver.disconnect();mountObserver.disconnect();sizes.disconnect();cancelAnimationFrame(frame);port.removeEventListener('scroll',schedule);root.removeEventListener('toggle',schedule,true);};
  });
</script>
{#if headings.length}
<nav class="report-outline" aria-label="Report outline">
  <button class="outline-title" aria-expanded={open} onclick={()=>open=!open}>
    <span>Report outline</span><span class="count">{headings.length}</span><span class:turned={open}><Icon name="chevronDown" size={14}/></span>
  </button>
  {#if open}<div class="rows">
    {#each headings as h,i (h.element)}
      {#if visible(i)}
        {@const depth=(()=>{let d=0;for(let p=h.parent;p>=0;p=headings[p]!.parent)d++;return d;})()}
        <div class="row" class:top={h.parent<0} class:current={current===i} style:--depth={Math.min(depth,5)}>
          {#if h.children}<button class="branch" aria-label={(expanded.includes(i)?'Collapse ':'Expand ')+h.title} aria-expanded={expanded.includes(i)} onclick={()=>expanded=expanded.includes(i)?expanded.filter(n=>n!==i):[...expanded,i]}><span class:turned={expanded.includes(i)}><Icon name="chevronDown" size={12}/></span></button>{:else}<span class="leaf" aria-hidden="true"></span>{/if}
          <button class="jump" aria-current={current===i?'location':undefined} onclick={()=>navigate(i)}>{h.title}</button>
        </div>
      {/if}
    {/each}
  </div>{:else if active>=0}<div class="preview">{headings[active]?.title}</div>{/if}
</nav>
{/if}
<style>
 .report-outline{margin:.8rem .75rem 1rem;padding:.55rem .5rem;background:color-mix(in srgb,var(--color-accent) 5%,var(--color-surface));border-radius:9px;color:var(--color-ink)}
 .outline-title,.branch,.jump{background:transparent;border:0;box-shadow:none;color:inherit;cursor:pointer}
 .outline-title{display:flex;align-items:center;gap:.5rem;width:100%;padding:.35rem .45rem;text-align:left;font-weight:650;font-size:.92rem}
 .count{color:var(--color-muted);margin-left:auto;font-size:.75rem;font-variant-numeric:tabular-nums}
 .rows{margin-top:.3rem;max-height:46vh;overflow:auto}
 .row{display:flex;align-items:stretch;padding-left:calc(.2rem + var(--depth)*.75rem);border-radius:4px}
 .row.top:not(.current){background:color-mix(in srgb,var(--color-accent) 3%,transparent)}.top .jump{font-weight:600}.row.current{background:color-mix(in srgb,var(--color-accent) 12%,var(--color-surface));box-shadow:inset 3px 0 var(--color-accent);color:var(--color-accent)}
 .row:hover{background:var(--color-hover)}
 .jump{justify-content:flex-start;min-width:0;padding:.38rem .3rem;text-align:left;flex:1;line-height:1.35;font-size:.86rem;overflow-wrap:anywhere}
 .branch,.leaf{display:grid;width:1.5rem;flex:none;place-items:center;padding:0;color:var(--color-muted)}
 .branch span,.outline-title>span:last-child{display:flex;rotate:-90deg}.branch .turned,.outline-title>span.turned{rotate:0deg}
 .preview{margin:.1rem .45rem .25rem;color:var(--color-muted);font-size:.8rem}
 button:focus-visible{outline:2px solid var(--color-accent);outline-offset:-2px}
</style>
