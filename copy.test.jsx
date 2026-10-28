import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import plugin from './plugin.js';
let api; function Probe(){api=useTheme();return null}
afterEach(()=>{cleanup();localStorage.clear();$sessions.set([]);$selectedStoredSessionId.set(null)});
it('copies exact selected color and applies only after clicking apply',()=>{
 modePref.assign('default','light'); $sessions.set([{id:'copy-test',connection_id:'local',profile:'default'}]);$selectedStoredSessionId.set('copy-test');
 const ds=[],cs=[],data={};const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){cs.push(c);const d=registry.register(c);ds.push(d);return d}};plugin.register(ctx);
 const v=render(React.createElement(ThemeProvider,null,React.createElement(React.Fragment,null,React.createElement(Probe),cs.find(c=>c.id==='page').render())));
 act(()=>v.getByText('Start editing current theme').click());fireEvent.change(v.getByLabelText('Color for App background tint'),{target:{value:'#123456'}});
 const foreground=api.theme.colors.foreground;act(()=>v.getByRole('button',{name:'Copy color'}).click());expect(v.getByText(/Copied color: #123456/i)).toBeTruthy();
 act(()=>v.getByRole('button',{name:'Main text color (shared)'}).click());expect(api.theme.colors.foreground).toBe(foreground);expect(data['scoped-themes-v1']).toBeUndefined();
 act(()=>v.getByRole('button',{name:'Apply copied color'}).click());expect(api.theme.colors.foreground).toBe('#123456');expect(api.theme.colors.background).toBe('#123456');
 cleanup();ds.forEach(d=>d());
});
it('disables fallback copying and clears the swatch on mode or focus changes',()=>{
 modePref.assign('default','light');$sessions.set([{id:'one',connection_id:'local',profile:'default'},{id:'two',connection_id:'local',profile:'other'}]);$selectedStoredSessionId.set('one');
 const ds=[],cs=[],data={};const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){cs.push(c);const d=registry.register(c);ds.push(d);return d}};plugin.register(ctx);
 const v=render(React.createElement(ThemeProvider,null,React.createElement(React.Fragment,null,React.createElement(Probe),cs.find(c=>c.id==='page').render())));
 act(()=>v.getByText('Start editing current theme').click());act(()=>v.getByRole('button',{name:'Select conversation background'}).click());
 expect(v.getByRole('button',{name:'Copy color'}).disabled).toBe(true);expect(v.getByText(/Copy unavailable/)).toBeTruthy();
 act(()=>v.getByRole('button',{name:'App background tint'}).click());act(()=>v.getByRole('button',{name:'Copy color'}).click());
 act(()=>api.setMode('dark'));expect(v.queryByRole('button',{name:'Copy color'})).toBeNull();act(()=>v.getByText('Start editing current theme').click());expect(v.getByText(/No copied color/)).toBeTruthy();
 act(()=>v.getByRole('button',{name:'Copy color'}).click());act(()=>$selectedStoredSessionId.set('two'));expect(v.queryByRole('button',{name:'Copy color'})).toBeNull();act(()=>v.getByText('Start editing current theme').click());expect(v.getByText(/No copied color/)).toBeTruthy();
 expect(data['scoped-themes-v1']).toBeUndefined();cleanup();ds.forEach(d=>d());
});