import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import plugin, {createStudio} from './plugin.js';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
let api; function Probe(){api=useTheme();return null}; afterEach(()=>{cleanup();localStorage.clear()});
it('edits the full saved definition and replaces registration safely',()=>{
 modePref.assign('default','light'); const original={...nousTheme,name:'theme-studio-original',label:'Original',customCSS:'.keep {color:red}',darkColors:{...nousTheme.colors,background:'#010203'}};
 const data={'scoped-themes-v1':[{scope:'x',theme:original}]}; const disposers=[]; const ctx={storage:{get:(k,f)=>structuredClone(data[k]??f),set:(k,v)=>data[k]=structuredClone(v)},register(c){const d=registry.register(c);disposers.push(d);return d}};
 const studio=createStudio(ctx); render(React.createElement(ThemeProvider,null,React.createElement(Probe))); const scoped=()=>({...api,scope:'x'});
 act(()=>{studio.beginSaved(original.name,scoped());studio.edit('background','#123456',scoped());studio.saveChanges('Renamed',scoped())});
 expect(data['scoped-themes-v1'][0].theme.darkColors.background).toBe('#010203'); expect(data['scoped-themes-v1'][0].theme.customCSS).toBe(original.customCSS);
 act(()=>{studio.revert(scoped());api.setTheme(original.name)}); expect(api.theme.colors.background).toBe('#123456'); disposers.forEach(d=>d());
});

it('blocks active deletion, supports scoped undo and survives reload',()=>{
 const theme={...nousTheme,name:'theme-studio-delete',label:'Delete'}; const data={'scoped-themes-v1':[{scope:'x',theme}]}; const ds=[]; const ctx={storage:{get:(k,f)=>structuredClone(data[k]??f),set:(k,v)=>data[k]=structuredClone(v)},register(c){const d=registry.register(c);ds.push(d);return d}};
 const s=createStudio(ctx); render(React.createElement(ThemeProvider,null,React.createElement(Probe))); const scoped=()=>({...api,scope:'x'});
 act(()=>api.setTheme(theme.name)); expect(()=>s.remove(theme.name,scoped())).toThrow(/active/i);
 act(()=>api.setTheme('nous')); s.remove(theme.name,scoped()); expect(s.list(scoped())).toHaveLength(0); expect(()=>s.undoDelete({...scoped(),scope:'y'})).toThrow();
 s.undoDelete(scoped()); expect(data['scoped-themes-v1'][0].theme.name).toBe(theme.name); expect(createStudio(ctx).list(scoped())).toHaveLength(1); ds.forEach(d=>d());
});
it('UI exposes edit, save changes, confirmed deletion and undo',()=>{
 $sessions.set([{id:'edit-ui-test',connection_id:'local',profile:'default'}]); $selectedStoredSessionId.set('edit-ui-test'); const contributions=[]; const data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);return registry.register(c)}}; plugin.register(ctx); const view=render(React.createElement(ThemeProvider,null,contributions.find(c=>c.id==='page').render())); expect(view.getByText('Edit saved theme')).toBeTruthy(); expect(view.getByText('Delete saved theme')).toBeTruthy(); expect(view.getByText('Undo deletion')).toBeTruthy(); cleanup(); $sessions.set([]); $selectedStoredSessionId.set(null);
});

it('storage failure leaves deletion and registration unchanged',()=>{
 const theme={...nousTheme,name:'theme-studio-fail',label:'Failure'};const data={'scoped-themes-v1':[{scope:'x',theme}]};const ds=[];const ctx={storage:{get:(k,f)=>structuredClone(data[k]??f),set(){}},register(c){const d=registry.register(c);ds.push(d);return d}};const s=createStudio(ctx); render(React.createElement(ThemeProvider,null,React.createElement(Probe)));const scoped=()=>({...api,scope:'x'});
 expect(()=>s.remove(theme.name,scoped())).toThrow(/storage/i);expect(s.list(scoped())).toHaveLength(1);act(()=>api.setTheme(theme.name));expect(api.themeName).toBe(theme.name);ds.forEach(d=>d());
});
it('wrong or stale owner cannot edit or delete saved entries',()=>{
 const theme={...nousTheme,name:'theme-studio-scope',label:'Scoped'};const data={'scoped-themes-v1':[{scope:'x',theme}]};const ds=[];const ctx={storage:{get:(k,f)=>structuredClone(data[k]??f),set:(k,v)=>data[k]=structuredClone(v)},register(c){const d=registry.register(c);ds.push(d);return d}};const s=createStudio(ctx);render(React.createElement(ThemeProvider,null,React.createElement(Probe)));expect(()=>s.beginSaved(theme.name,{...api,scope:'y'})).toThrow();expect(()=>s.remove(theme.name,{...api,scope:'x',currentScope:()=>null})).toThrow();ds.forEach(d=>d());
});
