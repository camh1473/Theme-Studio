import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,beforeEach} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import plugin, {createStudio} from './plugin.js';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';

let api; function Probe(){api=useTheme();return null}
// Benign React dev-mode noise unrelated to the token-removal feature under test
// (pre-existing in this component before the change: missing-key warnings on
// mapped color buttons, and act()-wrapping warnings from mount timing).
const BENIGN = [/Each child in a list should have a unique/, /not wrapped in act\(/];
let consoleErrors;
function realErrors(){ return consoleErrors.filter(args => !BENIGN.some(re => re.test(String(args[0])))); }
beforeEach(()=>{ consoleErrors=[]; console.error=(...a)=>consoleErrors.push(a); });
afterEach(()=>{cleanup();$sessions.set([]);$selectedStoredSessionId.set(null);localStorage.clear()});

const REMOVED_LABELS = ['Secondary text token','Midground text token','Destructive action text token','Interactive accent text token','Your message bubble border token'];

function openStudio(){
  const data={}; const contributions=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);return ()=>{}}};
  plugin.register(ctx);
  const page=contributions.find(c=>c.id==='page');
  const view=render(React.createElement(ThemeProvider,null,page.render()));
  act(()=>view.getByText('Start editing current theme').click());
  return {view,data};
}

it('the 4 removed controls no longer render in main or advanced lists', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'dead-token-test',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('dead-token-test');
  const {view} = openStudio();
  for (const label of REMOVED_LABELS) {
    expect(view.queryByRole('button',{name:label})).toBeNull();
    expect(view.queryByLabelText('Color for '+label)).toBeNull();
  }
  expect(realErrors()).toEqual([]);
});

it('Secondary surface token remains available and editable', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'dead-token-test2',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('dead-token-test2');
  const {view} = openStudio();
  const secondaryBtn = view.getByRole('button',{name:'Secondary surface token'});
  expect(secondaryBtn).toBeTruthy();
  act(()=>secondaryBtn.click());
  expect(view.getByLabelText('Color for Secondary surface token')).toBeTruthy();
  expect(realErrors()).toEqual([]);
});

it('other surviving tokens (foreground, primary, accent) still render and are editable', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'dead-token-test3',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('dead-token-test3');
  const {view} = openStudio();
  for (const label of ['Main text color (shared)','Panel header / primary accent (shared)','Accent surface token']) {
    expect(view.getByRole('button',{name:label})).toBeTruthy();
  }
  act(()=>view.getByRole('button',{name:'Accent surface token'}).click());
  act(()=>{const inp=view.getByLabelText('Color for Accent surface token'); inp.focus();});
  expect(realErrors()).toEqual([]);
});

it('a saved theme containing old removed-key values loads without crashing or erroring', () => {
  modePref.assign('default','light');
  const legacy = {...nousTheme, name:'theme-studio-legacy-dead-keys', label:'Legacy', colors:{...nousTheme.colors, secondaryForeground:'#111111', midgroundForeground:'#222222', destructiveForeground:'#333333', userBubbleBorder:'#444444'}, darkColors:{...nousTheme.colors}};
  const data={'scoped-themes-v1':[{scope:'x',theme:legacy}]};
  const disposers=[];
  const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
  const s=createStudio(ctx);
  expect(()=>render(React.createElement(ThemeProvider,null,React.createElement(Probe)))).not.toThrow();
  expect(()=>act(()=>api.setTheme(legacy.name))).not.toThrow();
  expect(api.theme.colors.secondaryForeground).toBe('#111111');
  expect(api.theme.colors.destructiveForeground).toBe('#333333');
  const scoped=()=>({...api,scope:'x'});
  expect(()=>act(()=>{s.begin(scoped());})).not.toThrow();
  expect(()=>act(()=>{s.edit('background','#abcabc',scoped());})).not.toThrow();
  expect(api.theme.colors.background).toBe('#abcabc');
  act(()=>s.revert(scoped()));
  disposers.forEach(d=>d());
  expect(realErrors()).toEqual([]);
});

it('attempting to edit a removed key through the API is rejected, not silently corrupting storage', () => {
  const data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register:()=>()=>{}};
  const s=createStudio(ctx);
  const base={name:'base',label:'Base',colors:{background:'#ffffff',foreground:'#111111',primary:'#222222'}};
  const api2={scope:'a',theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){}};
  s.begin(api2);
  expect(()=>s.edit('secondaryForeground','#abcdef',api2)).toThrow(/Invalid color/i);
});
