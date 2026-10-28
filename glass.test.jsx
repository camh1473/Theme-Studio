import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import plugin from './plugin.js';
afterEach(()=>{cleanup();document.documentElement.removeAttribute('data-hermes-glass');$sessions.set([]);$selectedStoredSessionId.set(null);localStorage.clear()});
it('glass sidebar preview distinguishes selected tint from approximate rendering without saving',async()=>{
 document.documentElement.setAttribute('data-hermes-glass',''); modePref.assign('default','light'); $sessions.set([{id:'glass-test',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('glass-test');
 const data={}, contributions=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);return ()=>{}}}; plugin.register(ctx);
 const v=render(React.createElement(ThemeProvider,null,contributions.find(c=>c.id==='page').render()));
 act(()=>v.getByText('Start editing current theme').click()); act(()=>v.getByRole('button',{name:'Select sessions sidebar tint'}).click());
 act(()=>fireEvent.change(v.getByLabelText('Color for Sessions sidebar (30% glass tint)'),{target:{value:'#ff0000'}}));
 expect(v.getByText(/Selected tint: #ff0000/i)).toBeTruthy(); expect(v.getByText(/Rendered sample.*approximation/i)).toBeTruthy();
 const sidebar=v.getByRole('button',{name:'Select sessions sidebar tint'}); expect(sidebar.getAttribute('style')).toMatch(/color-mix\(in srgb, (?:#ff0000|rgb\(255, 0, 0\)) 30%, transparent\)/i);
 expect(data['scoped-themes-v1']).toBeUndefined();
});
