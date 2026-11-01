import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,beforeEach} from 'vitest';
import {ThemeProvider,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import plugin from './plugin.js';

const BENIGN = [/Each child in a list should have a unique/, /not wrapped in act\(/];
let consoleErrors;
function realErrors(){ return consoleErrors.filter(args => !BENIGN.some(re => re.test(String(args[0])))); }
beforeEach(()=>{ consoleErrors=[]; console.error=(...a)=>consoleErrors.push(a); });
afterEach(()=>{cleanup();$sessions.set([]);$selectedStoredSessionId.set(null);localStorage.clear()});

const NEW_LABELS = {
  primaryForeground: 'Primary button text (e.g. Send, Save)',
  secondary: 'Drawer close-button fill (mobile sidebar, shown when open)',
  border: 'Shared border color (cards, dialogs & panels)',
  ring: 'Keyboard focus ring (buttons, tabs & inputs)',
  composerRing: 'Composer input border (chat message box)',
  destructive: 'Destructive actions & errors (Delete buttons, error text)',
};
const OLD_LABELS = [
  'Primary accent text token',
  'Secondary surface token',
  'Shared border token',
  'Focus ring token',
  'Composer focus ring token',
  'Destructive action token',
];

function openStudio(){
  const data={}; const contributions=[]; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);return ()=>{}}};
  plugin.register(ctx);
  const page=contributions.find(c=>c.id==='page');
  const view=render(React.createElement(ThemeProvider,null,page.render()));
  act(()=>view.getByText('Start editing current theme').click());
  return {view,data};
}

it('the 6 pass-2 tokens render with their new location-hinting labels, editable', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'pass2-rename-test',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('pass2-rename-test');
  const {view} = openStudio();
  for (const label of Object.values(NEW_LABELS)) {
    const btn = view.getByRole('button',{name:label});
    expect(btn).toBeTruthy();
    act(()=>btn.click());
    expect(view.getByLabelText('Color for '+label)).toBeTruthy();
  }
  expect(realErrors()).toEqual([]);
});

it('none of the 6 old generic label strings remain', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'pass2-rename-test2',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('pass2-rename-test2');
  const {view} = openStudio();
  for (const label of OLD_LABELS) {
    expect(view.queryByRole('button',{name:label})).toBeNull();
    expect(view.queryByLabelText('Color for '+label)).toBeNull();
  }
  expect(realErrors()).toEqual([]);
});

it('other tokens (muted, popover, accent, accentForeground, input, foreground, primary) are unaffected by this pass', () => {
  modePref.assign('default','light');
  $sessions.set([{id:'pass2-rename-test3',connection_id:'source-a',profile:'default'}]); $selectedStoredSessionId.set('pass2-rename-test3');
  const {view} = openStudio();
  for (const label of [
    'Muted surface (settings tabs, progress bars)',
    'Popover & command palette background',
    'Accent highlight (hover & active icons)',
    'Accent highlight text',
    'Input field border',
    'Main text color (shared)',
    'Panel header / primary accent (shared)',
  ]) {
    expect(view.getByRole('button',{name:label})).toBeTruthy();
  }
  expect(realErrors()).toEqual([]);
});
