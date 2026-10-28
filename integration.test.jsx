import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import plugin, {createStudio} from './plugin.js';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
let api; function Probe(){api=useTheme();return null}
afterEach(()=>{cleanup();localStorage.clear()});
it('real SDK route renders and rejects unresolved focused owner',()=>{
 const contributions=[]; const ctx={storage:{get:(k,f)=>f,set(){}},register(c){contributions.push(c);return ()=>{}}}; plugin.register(ctx);
 const page=contributions.find(c=>c.id==='page'); expect(page).toBeTruthy();
 const view=render(React.createElement(ThemeProvider,null,page.render()));
 expect(view.getByText('Theme Studio')).toBeTruthy();
 act(()=>view.getByText('Start editing current theme').click());
 expect(view.getByRole('status',{name:'Theme status'}).textContent).toMatch(/profile/i);
});
it('dark-mode editing preserves the actually painted untouched palette',()=>{
 modePref.assign('default','dark'); render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
 const data={}; const disposers=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
 const s=createStudio(ctx); const scoped=()=>({...api,scope:'x'}); let original=api.theme.colors.background; let originalForeground=api.theme.colors.foreground;
 act(()=>{s.begin(scoped());s.edit('background','#123456',scoped())});
 expect(api.theme.colors.background).toBe('#123456'); expect(api.theme.colors.foreground).toBe(originalForeground);
 act(()=>s.revert(scoped()));expect(api.theme.colors.background).toBe(original);disposers.forEach(d=>d());
});
it('rejects a stale draft after the real SDK mode changes',()=>{
 modePref.assign('default','light'); render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
 const data={}; const disposers=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
 const s=createStudio(ctx), scoped=()=>({...api,scope:'x'});
 act(()=>{s.begin(scoped());s.edit('background','#123456',scoped())});
 act(()=>api.setMode('dark'));
 expect(()=>s.edit('background','#abcdef',scoped())).toThrow(/mode/i);
 expect(()=>s.save('stale',scoped())).toThrow(/mode/i);
 expect(api.resolvedMode).toBe('dark'); expect(api.theme.colors.background).not.toBe('#abcdef');
 act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});
it('non-hex and missing token values are explicitly identified in the real SDK route',()=>{
 modePref.assign('default','light'); $sessions.set([{id:'studio-test',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('studio-test');
 const disposers=[]; const contributions=[]; const data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);const d=registry.register(c);disposers.push(d);return d}};
 const base={...nousTheme,name:'studio-test-nonhex',label:'Nonhex',colors:{...nousTheme.colors,background:'rgb(10, 20, 30)'},darkColors:{...nousTheme.colors}}; delete base.colors.sidebarBackground;
 disposers.push(registry.register({id:base.name,area:'themes',data:base})); plugin.register(ctx);
 const page=contributions.find(c=>c.id==='page'); const view=render(React.createElement(ThemeProvider,null,React.createElement(React.Fragment,null,React.createElement(Probe),page.render())));
 act(()=>api.setTheme(base.name)); act(()=>view.getByText('Start editing current theme').click());
 expect(view.getByText(/Current value: rgb\(10, 20, 30\).*placeholder, not the current color/i)).toBeTruthy();
 act(()=>view.getByRole('button',{name:'Sidebar and menu backgrounds (shared)'}).click()); expect(view.getByText(/token uses a theme fallback.*placeholder/i)).toBeTruthy();
 act(()=>api.setMode('dark')); expect(view.getByRole('status',{name:'Theme status'}).textContent).toMatch(/mode changed.*cancelled/i); expect(view.queryByLabelText('Color for Sidebar and menu backgrounds (shared)')).toBeNull();
 cleanup(); disposers.forEach(d=>d()); $sessions.set([]); $selectedStoredSessionId.set(null);
});
it('editing a synthesized light theme paints the selected color',()=>{
 modePref.assign('default','light'); render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
 act(()=>api.setTheme('midnight')); const data={}; const disposers=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
 const s=createStudio(ctx); const scoped=()=>({...api,scope:'x'}); const foreground=api.theme.colors.foreground;
 act(()=>{s.begin(scoped());s.edit('background','#123456',scoped())});
 expect(api.theme.colors.background).toBe('#123456'); expect(api.theme.colors.foreground).toBe(foreground);
 act(()=>s.revert(scoped()));disposers.forEach(d=>d());
});

it('legacy saved theme stays unchanged and explicit chat editing resets CSS',()=>{
 modePref.assign('default','light'); const old={...nousTheme,name:'theme-studio-old',label:'Old',customCSS:'.original { color: red; }'}; const data={'scoped-themes-v1':[{scope:'x',theme:old}]}; const disposers=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
 const s=createStudio(ctx); render(React.createElement(ThemeProvider,null,React.createElement(Probe))); act(()=>api.setTheme(old.name)); expect(api.theme.customCSS).toBe(old.customCSS); expect(data['scoped-themes-v1'][0].theme.customCSS).toBe(old.customCSS);
 const scoped=()=>({...api,scope:'x'}); const background=api.theme.colors.background; act(()=>{s.begin(scoped());s.edit('chatBackground','#123456',scoped());}); expect(api.theme.colors.background).toBe(background); expect(api.theme.customCSS).toContain('#123456'); expect(api.theme.customCSS).toContain('.original'); act(()=>s.resetItem('chatBackground',scoped())); expect(api.theme.customCSS).toBe(old.customCSS); act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});
