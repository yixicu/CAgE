<script lang="ts">
  import Icon from './Icon.svelte';
  import SessionTitle from './SessionTitle.svelte';
  type Page = 'research'|'document'|'settings'|'maintenance'|'knowledge';
  let {tabs,active,researchTitle,documentTitle,onrename,renameDisabled=false,onselect,onclose}:{
    tabs:Page[];active:Page;researchTitle:string;documentTitle:string;onrename?:(name:string)=>Promise<void>;
    renameDisabled?:boolean;onselect:(page:Page)=>void;onclose:(page:Page)=>void
  }=$props();
  const titles=$derived({research:researchTitle,document:documentTitle,settings:'Settings',maintenance:'Maintenance Assistant',knowledge:'cages'});
</script>
<nav class="workspace-tabs" aria-label="Open workspace pages">
  {#each tabs as page (page)}
    <div class="workspace-tab" class:current={page===active} aria-current={page===active?'page':undefined}>
      {#if page==='research' && onrename && active===page}
        <SessionTitle title={researchTitle} editable disabled={renameDisabled} onopen={()=>onselect(page)} onsave={onrename}/>
      {:else}<button class="tab-title" title={titles[page]} onclick={()=>onselect(page)}>{titles[page]}</button>{/if}
      <button class="close-tab" aria-label={'Close '+titles[page]+' page'} onclick={()=>onclose(page)}><Icon name="close" size={12}/></button>
    </div>
  {/each}
</nav>
<style>
.workspace-tabs{align-items:center;gap:4px;scrollbar-width:thin}
.workspace-tab{align-items:center;height:30px;max-width:min(240px,48vw);padding-inline:5px;border:1px solid transparent;border-radius:7px}
.workspace-tab.current{border-color:var(--color-line);background:var(--color-surface)}
.workspace-tab:hover{background:var(--color-hover)}
.workspace-tabs .workspace-tab .tab-title,.workspace-tab :global(.workspace-title){font-family:var(--font-ui);font-size:var(--text-xs);font-weight:500;line-height:1.25;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0 7px;color:var(--color-ink);background:transparent}
.workspace-tab :global(.session-title){min-width:0}
.workspace-tab .close-tab{flex:none;width:20px;min-height:20px;height:20px;padding:0;margin:0;border-radius:4px;color:var(--color-muted)}
</style>
