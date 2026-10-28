import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,vi} from 'vitest';
import {ThemeProvider,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import plugin,{createStudio} from './plugin.js';
const scope=JSON.stringify(['local','default']);
const theme=(name,label)=>({...nousTheme,name,label});
let disposers=[];
function context(data,fail=()=>false){return {storage:{get:(k,f)=>structuredClone(data[k]??f),set:(k,v)=>{if(!fail('storage')) data[k]=structuredClone(v)}},register(c){if(fail(c.id)) throw Error('registry failure');const d=registry.register(c);disposers.push(d);return d}}}
afterEach(()=>{cleanup();disposers.forEach(d=>d());disposers=[];localStorage.clear();$sessions.set([]);$selectedStoredSessionId.set(null);vi.restoreAllMocks()});
it('clicks through edit, change, copy, cancelled deletion, deletion and undo',()=>{
 modePref.assign('default','light');$sessions.set([{id:'manage-ui',connection_id:'local',profile:'default'}]);$selectedStoredSessionId.set('manage-ui');
 const original=theme('theme-studio-ui-original','Original');const data={'scoped-themes-v1':[{scope,theme:original}]};const ctx=context(data);let page;const reg=ctx.register;ctx.register=c=>{if(c.id==='page')page=c;return reg(c)};plugin.register(ctx);
 const v=render(React.createElement(ThemeProvider,null,page.render()));const click=n=>act(()=>fireEvent.click(v.getByRole('button',{name:n})));const change=(n,value)=>act(()=>fireEvent.change(v.getByLabelText(n),{target:{value}}));
 change('Saved theme',original.name);click('Edit saved theme');change('Theme name','Renamed');click('Save changes');expect(data['scoped-themes-v1'][0].theme.label).toBe('Renamed');
 change('Theme name','Copy');click('Save as copy');expect(data['scoped-themes-v1']).toHaveLength(2);const id=data['scoped-themes-v1'][1].theme.name;
 vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);click('Delete saved theme');expect(data['scoped-themes-v1']).toHaveLength(2);click('Delete saved theme');expect(data['scoped-themes-v1']).toHaveLength(1);click('Undo deletion');expect(data['scoped-themes-v1'].some(x=>x.theme.name===id)).toBe(true);
 expect(v.getByText(/panel header \/ primary accent is a shared primary token/i)).toBeTruthy();
});
it('refreshes independent instances without overwriting other scopes and rejects conflicting edits',()=>{
 const a=theme('theme-studio-a','A'),b=theme('theme-studio-b','B');const data={'scoped-themes-v1':[{scope,theme:a}]};const ctx=context(data);const s=createStudio(ctx);const api={scope,resolvedMode:'light',theme:a,themeName:'nous',clearThemePreview(){},previewTheme(){}};
 s.beginSaved(a.name,api);data['scoped-themes-v1'].push({scope:'other',theme:b});s.saveChanges('Changed',api);expect(data['scoped-themes-v1']).toHaveLength(2);
 s.beginSaved(a.name,api);data['scoped-themes-v1'][0].theme.label='external';expect(()=>s.saveChanges('stale',api)).toThrow(/changed elsewhere/);expect(data['scoped-themes-v1'][0].theme.label).toBe('external');
});
it('registration failure after save preserves stored state and other scopes',()=>{
 const a=theme('theme-studio-regfail','A');const data={'scoped-themes-v1':[{scope,theme:a}]};let fail=false;const s=createStudio(context(data,id=>fail && id===a.name));const api={scope,resolvedMode:'light',theme:a,themeName:'nous',clearThemePreview(){},previewTheme(){}};s.beginSaved(a.name,api);fail=true;expect(()=>s.saveChanges('New',api)).toThrow(/saved.*registration failed/i);expect(data['scoped-themes-v1'][0].theme.label).toBe('New');expect(s.list(api)[0].label).toBe('New');
});
