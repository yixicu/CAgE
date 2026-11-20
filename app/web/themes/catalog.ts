/** Declarative presentation only. New themes reuse these semantic roles and geometry. */
export interface CrystalTheme {
  id: string; name: string; description: string; dark: boolean;
  crystal: { sides: number; radius: number; depth: number; tilt: number; hue: number; saturation: number; shear?: number; taper?: number };
  material?: { lightness: number; range: number; opacity: number; shade: number };
  colors: Record<string, string>;
}
const common = {
  'info':'#256399','info-soft':'#edf5fd','success':'#286440','success-soft':'#eaf4eb',
  'danger':'#98362e','danger-soft':'#fff0ec','danger-line':'#dcaca4',
  'warning':'#805813','warning-soft':'#fff4db','idle':'#626d69','idle-soft':'#f0f2f0',
  'code':'#694b36','code-soft':'#f2e9de','link':'#79502e','pdf-stage':'#e5eaf0',
  'scrim':'#15212f66','on-action':'#ffffff',
};
function light(id:string,name:string,description:string, crystal:CrystalTheme['crystal'],palette:string[], material?:CrystalTheme['material']):CrystalTheme {
 const [canvas,surface,rail,selected,accent,brand]=palette;
 return {id,name,description,dark:false,crystal,material,colors:{...common,canvas,surface,rail,tint:rail,selected,accent,brand,
  ink:'#242b31',muted:'#58636d',placeholder:'#65717c',line:'#d4d8d9','line-strong':'#7d8991',
  hover:selected,action:accent,'action-hover':brand,link:accent,signal:accent}};
}
export const themes: readonly CrystalTheme[] = [
 light('blue','Glacier','Tabular crystal',{sides:4,radius:160,depth:28,tilt:.65,hue:211,saturation:45},['#f6f9fc','#fcfdff','#eaf0f7','#d7e5f4','#315b88','#2a5486'],{lightness:84,range:14,opacity:.72,shade:2}),
 light('sage','Sage','Hexagonal prism',{sides:6,radius:65,depth:240,tilt:.15,hue:125,saturation:18},['#f7f9f5','#fdfefb','#edf1e8','#dce7d7','#3f6545','#385d3d']),
 light('amber','Amber','Cubic cluster',{sides:4,radius:115,depth:163,tilt:.78,hue:37,saturation:43},['#fcf8f0','#fffdf8','#f8ecda','#efddbd','#795727','#242b31']),
 light('rose','Rose','Rhombohedral crystal',{sides:4,radius:110,depth:180,tilt:.38,hue:350,saturation:27,shear:65},['#fcf7f6','#fffdfb','#f5e7e4','#ecd4d2','#854c56','#29262a']),
 {id:'obsidian',name:'Obsidian',description:'Smoky quartz',dark:true,crystal:{sides:6,radius:76,depth:270,tilt:.5,hue:218,saturation:18,taper:.38},colors:{
  canvas:'#101112',surface:'#17191c',rail:'#1c1e21',tint:'#252e3b',ink:'#d7d9dd',muted:'#b2bcc8',placeholder:'#a1aebc',
  line:'#343d48','line-strong':'#7d8c9e',hover:'#2c3542',selected:'#303e52',accent:'#a7c7ef',
  action:'#a7c7ef','action-hover':'#c9ddf6','on-action':'#102039',brand:'#d8e6f9',signal:'#b4cfee',
  idle:'#b8c1ca','idle-soft':'#252d35',info:'#a3caff','info-soft':'#202f43',success:'#9bd7ac','success-soft':'#21362b',
  danger:'#ffb1a5','danger-soft':'#402725','danger-line':'#805149',warning:'#eed196','warning-soft':'#3b3221',
  code:'#e5c79f','code-soft':'#302b25',link:'#c2d9f5','pdf-stage':'#222b36',scrim:'#00000099',
 }},
];
export const themeById = (id: unknown) => themes.find(theme => theme.id === id) ?? themes[0];
export function themeStyle(theme: CrystalTheme): string {
 return Object.entries(theme.colors).map(([key,value])=>`--color-${key}:${value}`).join(';');
}
