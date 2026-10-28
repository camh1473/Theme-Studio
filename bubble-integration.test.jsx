import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import {createStudio} from './plugin.js';
let api; function Probe(){api=useTheme();return null}; afterEach(()=>{cleanup();localStorage.clear()});
it('explicit bubble edit paints, persists, reopens and resets independently with legacy CSS',()=>{
 modePref.assign('default','light'); const old={...nousTheme,name:'theme-studio-legacy',label:'Legacy',customCSS:'.legacy {color: red;}'}; const data={'scoped-themes-v1':[{scope:'x',theme:structuredClone(old)}]}; let disposers=[];
 const ctx={storage:{get:(k,f)=>structuredClone(data[k]??f),set:(k,v)=>data[k]=structuredClone(v)},register(c){const d=registry.register(c);disposers.push(d);return d}};
 let s=createStudio(ctx); render(React.createElement(ThemeProvider,null,React.createElement(Probe))); const scoped=()=>({...api,scope:'x'}); act(()=>api.setTheme(old.name)); expect(api.theme.customCSS).toBe(old.customCSS);
 let id; act(()=>{s.begin(scoped());s.edit('chatBackground','#123456',scoped());s.edit('sessionsSidebarBackground','#abcdef',scoped());s.edit('userBubble','#0000ff',scoped())});
 expect(api.theme.customCSS).toContain('.composer-human-message'); expect(api.theme.customCSS).toContain('color-mix(in srgb, #0000ff var(--user-bubble-keep, 100%), transparent)');
 act(()=>s.resetItem('userBubble',scoped())); expect(api.theme.customCSS).not.toContain('.composer-human-message'); expect(api.theme.customCSS).toContain('#123456'); expect(api.theme.customCSS).toContain('#abcdef');
 act(()=>{s.edit('userBubble','#0000ff',scoped());id=s.save('All',scoped());s.revert(scoped())}); expect(data['scoped-themes-v1'][0].theme).toEqual(old);
 cleanup(); disposers.forEach(d=>d()); disposers=[]; s=createStudio(ctx); render(React.createElement(ThemeProvider,null,React.createElement(Probe))); act(()=>api.setTheme(id)); const original=api.theme.customCSS; expect(original).toContain('.legacy'); expect(original).toContain('#123456'); expect(original).toContain('#abcdef'); expect(original).toContain('#0000ff');
 act(()=>{s.begin(scoped());s.edit('userBubble','#ff0000',scoped())}); expect(api.theme.customCSS).toContain('#ff0000'); act(()=>s.resetItem('userBubble',scoped())); expect(api.theme.customCSS).toBe(original); act(()=>s.edit('userBubble','#ff0000',scoped())); act(()=>s.reset(scoped())); expect(api.theme.customCSS).toBe(original); act(()=>s.revert(scoped())); cleanup(); disposers.forEach(d=>d());
});
