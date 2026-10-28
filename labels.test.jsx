import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import plugin from './plugin.js';
afterEach(()=>{cleanup();$sessions.set([]);$selectedStoredSessionId.set(null);localStorage.clear()});
it('presents truthful labels and preview selections without saving',()=>{
 modePref.assign('default','light'); $sessions.set([{id:'label-test',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('label-test');
 const data={}; const contributions=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);return ()=>{}}}; plugin.register(ctx);
 const v=render(React.createElement(ThemeProvider,null,contributions.find(c=>c.id==='page').render()));
 act(()=>v.getByText('Start editing current theme').click());
 for(const name of ['Main text color (shared)','App background tint','Message box & card backgrounds (shared)','Sidebar and menu backgrounds (shared)','Sent message background','Conversation background (not glass)','Sessions sidebar (30% glass tint)','Panel header / primary accent (shared)','Welcome title & interface accent (shared)']) expect(v.getByRole('button',{name})).toBeTruthy();
 for(const name of ['cardForeground','mutedForeground','popoverForeground']) expect(v.queryByRole('button',{name})).toBeNull();
 expect(v.getByText(/preview is an approximation/i)).toBeTruthy();
 for(const [preview,label] of [['Select sessions sidebar tint','Sessions sidebar (30% glass tint)'],['Select conversation background','Conversation background (not glass)'],['Select main text color','Main text color (shared)'],['Select your message bubble tint','Sent message background'],['Select panel header / primary accent (shared)','Panel header / primary accent (shared)']]){act(()=>v.getByRole('button',{name:preview}).click());expect(v.getByLabelText('Color for '+label)).toBeTruthy()}
 expect(data['scoped-themes-v1']).toBeUndefined();
});
