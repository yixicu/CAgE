(() => {
 if(window!==window.top)return;
 const api=()=>window.__TAURI__.window.getCurrentWindow();
 const color='#f5f7fa';
 const init=()=>{
   const style=document.createElement('style');
   style.textContent=`
   #carnot-controls{display:flex;align-items:center;margin-left:auto;flex:none;gap:.75px;color:inherit}
   #carnot-controls button{width:28px;height:22px;display:grid;place-items:center;background:transparent;color:inherit;border:0;border-radius:5px;cursor:default}
   #carnot-controls button:hover{background:#8797aa32}#carnot-controls button:focus-visible{outline:2px solid #4386c7}
   #carnot-controls button:last-child:hover{background:#b42338;color:white}
   #carnot-controls svg{height:8px;width:8px;stroke:currentColor;fill:none}
   #carnot-controls.floating{position:fixed;top:6px;right:8px;z-index:100}
   .topbar{user-select:none} .workspace-tabs{min-width:0}
   .app-shell:not(.is-home)>.workspace-art::after{content:"";position:absolute;inset:0;pointer-events:none;background:color-mix(in srgb,var(--color-canvas) 62%,transparent)}
   @media(min-width:901px){.app-shell{transition:none}.app-shell>.sidebar{transition:opacity 90ms ease-out}}
   #carnot-opening{position:fixed;inset:0;z-index:98;background:${color};display:grid;place-content:center;justify-items:center;gap:14px;color:#33445b;font:15px system-ui}
   #carnot-opening i{width:23px;height:23px;border:3px dotted #7297bd;border-top-color:#193e6c;border-radius:50%;animation:carnot-spin .85s linear infinite}
   @keyframes carnot-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#carnot-opening i{animation:none}}`;
   document.head.append(style);
   const loader=document.createElement('div');loader.id='carnot-opening';loader.setAttribute('role','status');loader.innerHTML='<i aria-hidden="true"></i><span>Opening workspace…</span>';document.body.append(loader);
   const controls=document.createElement('div');controls.id='carnot-controls';controls.className='floating';
   const actions=[['Minimize','M1 6h10',()=>api().minimize()],['Maximize','M1.5 1.5h9v9h-9z',()=>api().toggleMaximize()],['Close','M1 1l10 10M11 1L1 11',()=>api().close()]];
   actions.forEach(([label,path,act])=>{const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);
   b.innerHTML='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="'+path+'"/></svg>';b.addEventListener('click',act);controls.append(b)});
   const update=()=>api().isMaximized().then(max=>{const b=controls.children[1];b.title=max?'Restore':'Maximize';b.setAttribute('aria-label',b.title);b.querySelector('path').setAttribute('d',max?'M4 3V1h7v7H9M1 4h7v7H1z':actions[1][1]);}).catch(()=>{});
   window.addEventListener('resize',update);
   function mount(){const bar=document.querySelector('header.topbar');
     if(bar){if(controls.parentElement!==bar)bar.append(controls);controls.className='';loader.remove();}
     else{if(!controls.isConnected)document.body.append(controls);controls.className='floating';if(document.querySelector('.exit-screen'))loader.remove();}
   }
   mount();const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});
   document.addEventListener('mousedown',e=>{if(e.button!==0||!(e.target instanceof Element)||!e.target.closest('header.topbar,#carnot-opening')||e.target.closest('button,input,select,a,[role=tab]'))return;
     if(e.detail===2)api().toggleMaximize();else api().startDragging();});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();