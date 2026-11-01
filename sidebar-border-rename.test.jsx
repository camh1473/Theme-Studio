import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,beforeEach} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import plugin, {createStudio} from './plugin.js';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';

let api; function Probe(){api=useTheme();return null}
const BENIGN = [/Each child in a list should have a unique/, /not wrapped in act\(/];
let consoleErrors;
function realErrors(){ return consoleErrors.filter(args => !BENIGN.some(re => re.test(String(args[0])))); }
beforeEach(()=>{ consoleErrors=[]; console.error=(...a)=>consoleErrors.push(a); });
afterEach(()=>{cleanup();$sessions.set([]);$selectedStoredSessionId.set(null);localStorage.clear()});

const NEW_LABELS = {
  muted: 'Muted surface (settings tabs, progress bars)',
  popover: 'Popover & command palette background',
  accent: 'Accent highlight (hover & active icons)',
  accentForeground: 'Accent highlight text',
  input: 'Input field border',
};
const OLD_LABELS = ['Muted surface token','Popover surface token','Accent surface token','Accent text token','Input surface token','Sidebar border token'];

function openStudio(){
  const data={}; const contributions=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);return ()=>{}}};
  plugin.register(ctx);
  const page=contributions.find(c=>c.id==='page');
  const view=render(React.createElement(ThemeProvider,null,page.render()));
  act(()=>view.getByText('Start editing current theme').click());
  return {view,data};
}

it('the 5 renamed tokens render with their new location-hinting labels, editable', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'rename-test',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('rename-test');
  const {view} = openStudio();
  for (const label of Object.values(NEW_LABELS)) {
    const btn = view.getByRole('button',{name:label});
    expect(btn).toBeTruthy();
    act(()=>btn.click());
    expect(view.getByLabelText('Color for '+label)).toBeTruthy();
  }
  expect(realErrors()).toEqual([]);
});

it('none of the old generic label strings remain, and sidebarBorder control no longer renders', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'rename-test2',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('rename-test2');
  const {view} = openStudio();
  for (const label of OLD_LABELS) {
    expect(view.queryByRole('button',{name:label})).toBeNull();
    expect(view.queryByLabelText('Color for '+label)).toBeNull();
  }
  expect(realErrors()).toEqual([]);
});

it('a saved theme containing an old stored sidebarBorder value still loads without crashing or erroring', () => {
  modePref.assign('default','light');
  const legacy = {...nousTheme, name:'theme-studio-legacy-sidebar-border', label:'Legacy SB', colors:{...nousTheme.colors, sidebarBorder:'#555555'}, darkColors:{...nousTheme.colors}};
  const data={'scoped-themes-v1':[{scope:'y',theme:legacy}]};
  const disposers=[];
  const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
  const s=createStudio(ctx);
  expect(()=>render(React.createElement(ThemeProvider,null,React.createElement(Probe)))).not.toThrow();
  expect(()=>act(()=>api.setTheme(legacy.name))).not.toThrow();
  expect(api.theme.colors.sidebarBorder).toBe('#555555');
  const scoped=()=>({...api,scope:'y'});
  expect(()=>act(()=>{s.begin(scoped());})).not.toThrow();
  expect(()=>act(()=>{s.edit('background','#abcabd',scoped());})).not.toThrow();
  expect(api.theme.colors.background).toBe('#abcabd');
  act(()=>s.revert(scoped()));
  disposers.forEach(d=>d());
  expect(realErrors()).toEqual([]);
});

it('attempting to edit the removed sidebarBorder key through the API is rejected, not silently corrupting storage', () => {
  const data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register:()=>()=>{}};
  const s=createStudio(ctx);
  const base={name:'base2',label:'Base2',colors:{background:'#ffffff',foreground:'#111111',primary:'#222222'}};
  const api2={scope:'a',theme:base,themeName:'base2',resolvedMode:'light',previewTheme(){},clearThemePreview(){}};
  s.begin(api2);
  expect(()=>s.edit('sidebarBorder','#abcdef',api2)).toThrow(/Invalid color/i);
});

it('other tokens (foreground, primary) are unaffected by the rename/removal', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'rename-test3',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('rename-test3');
  const {view} = openStudio();
  for (const label of ['Main text color (shared)','Panel header / primary accent (shared)']) {
    expect(view.getByRole('button',{name:label})).toBeTruthy();
  }
  expect(realErrors()).toEqual([]);
});
