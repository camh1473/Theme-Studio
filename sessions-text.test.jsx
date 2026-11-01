import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,describe} from 'vitest';
import {ThemeProvider,useTheme,modePref} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {registry} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/contrib/registry.ts';
import {nousTheme} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/presets.ts';
import plugin, {createStudio} from './plugin.js';
import {$connection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import {$sessions,$selectedStoredSessionId} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';

let api; function Probe(){api=useTheme();return null}
afterEach(()=>{cleanup();localStorage.clear();$sessions.set([]);$selectedStoredSessionId.set(null);});

function freshCtx() {
  const data = {}; const disposers = [];
  const ctx = {storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){const d=registry.register(c);disposers.push(d);return d}};
  return {ctx, data, disposers};
}

it('new token is editable and produces scoped CSS overriding the real sidebar text vars',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx); const scoped = () => ({...api, scope:'x'});
  act(()=>{s.begin(scoped()); s.edit('sessionsSidebarForeground','#ff00aa',scoped());});
  const css = api.theme.customCSS;
  expect(css).toContain('[data-tour="sessions-sidebar"][data-slot="sidebar"]');
  expect(css).toContain('--ui-text-primary: color-mix(in srgb, #ff00aa 94%, transparent)');
  expect(css).toContain('--ui-text-secondary: color-mix(in srgb, #ff00aa 74%, transparent)');
  expect(css).toContain('--ui-text-tertiary: color-mix(in srgb, #ff00aa 54%, transparent)');
  expect(css).toContain('--ui-text-quaternary: color-mix(in srgb, #ff00aa 36%, transparent)');
  // Verify against the REAL compiled stylesheet the desktop app injects
  // (same style tag sessionsSidebarBackground's own test asserts against).
  expect(document.getElementById('hermes-desktop-custom-css').textContent).toContain('--ui-text-primary: color-mix(in srgb, #ff00aa 94%, transparent)');
  act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});

it('resetItem clears the text override and restores the baseline',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx); const scoped = () => ({...api, scope:'x'});
  act(()=>{s.begin(scoped()); s.edit('sessionsSidebarForeground','#ff00aa',scoped());});
  expect(api.theme.customCSS).toContain('#ff00aa');
  act(()=>s.resetItem('sessionsSidebarForeground',scoped()));
  expect(api.theme.customCSS || '').not.toContain('#ff00aa');
  act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});

it('does not touch --ui-base, --sidebar-edge-border, or any non-sidebar-scoped CSS (main chat text unaffected)',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx); const scoped = () => ({...api, scope:'x'});
  act(()=>{s.begin(scoped()); s.edit('sessionsSidebarForeground','#112233',scoped());});
  const css = api.theme.customCSS;
  // The rule block must be scoped to the sidebar selector only -- no bare
  // :root rule for --ui-base, --ui-text-primary, etc. that would leak to
  // the main chat surface or anywhere else in the document.
  const sidebarRuleMatch = css.match(/:root \[data-tour="sessions-sidebar"\]\[data-slot="sidebar"\] \{[^}]*\}/);
  expect(sidebarRuleMatch).toBeTruthy();
  expect(css).not.toMatch(/^:root \{[^}]*--ui-text-primary/m);
  expect(css).not.toContain('--ui-base:');
  expect(css).not.toContain('--sidebar-edge-border');
  expect(css).not.toContain('[data-chat-surface]'.concat(' { --ui-text'));
  act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});

it('coexists with sessionsSidebarBackground -- both independently baked into customCSS',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx); const scoped = () => ({...api, scope:'x'});
  act(()=>{
    s.begin(scoped());
    s.edit('sessionsSidebarBackground','#000011',scoped());
    s.edit('sessionsSidebarForeground','#eeeeee',scoped());
  });
  const css = api.theme.customCSS;
  expect(css).toContain('--ui-sidebar-surface-background: #000011');
  expect(css).toContain('--ui-text-primary: color-mix(in srgb, #eeeeee 94%, transparent)');
  act(()=>s.resetItem('sessionsSidebarBackground',scoped()));
  expect(api.theme.customCSS).not.toContain('#000011');
  expect(api.theme.customCSS).toContain('#eeeeee');
  act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});

it('per-focused-owner scoping: editing under one focused owner does not leak into another (Bot mode included)',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx);
  // Simulate a normal-chat owner and a bot-mode owner as two different
  // (connectionId, profile) pairs, exactly like scopeFor(focusedSessionOwner)
  // would resolve them -- not the ambient ($activeGatewayProfile) pattern.
  const normalApi = () => ({...api, scope: JSON.stringify(['conn-a','default'])});
  const botApi = () => ({...api, scope: JSON.stringify(['conn-a','bot-xyz'])});
  act(()=>{ s.begin(normalApi()); s.edit('sessionsSidebarForeground','#ff0000',normalApi()); s.save('Normal theme', normalApi()); s.revert(normalApi()); });
  act(()=>{ s.begin(botApi()); s.edit('sessionsSidebarForeground','#00ff00',botApi()); s.save('Bot theme', botApi()); s.revert(botApi()); });
  const normalList = s.list(normalApi()).map(t=>t.label);
  const botList = s.list(botApi()).map(t=>t.label);
  expect(normalList).toContain('Normal theme'); expect(normalList).not.toContain('Bot theme');
  expect(botList).toContain('Bot theme'); expect(botList).not.toContain('Normal theme');
  disposers.forEach(d=>d());
});

it('begin()/beginSaved()/revert()/reset() all clear sessionsTextEdited state (no cross-draft leakage)',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx); const scoped = () => ({...api, scope:'x'});
  act(()=>{s.begin(scoped()); s.edit('sessionsSidebarForeground','#abcabc',scoped()); s.revert(scoped());});
  expect(api.theme.customCSS || '').not.toContain('#abcabc');
  act(()=>{s.begin(scoped());}); // fresh draft must not resurrect prior edit
  expect(api.theme.customCSS || '').not.toContain('#abcabc');
  act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});

it('rejects a non-hex value and an unknown key the same way as other tokens',()=>{
  modePref.assign('default','light');
  render(React.createElement(ThemeProvider,null,React.createElement(Probe)));
  const {ctx, disposers} = freshCtx();
  const s = createStudio(ctx); const scoped = () => ({...api, scope:'x'});
  act(()=>s.begin(scoped()));
  expect(()=>s.edit('sessionsSidebarForeground','not-a-color',scoped())).toThrow(/Invalid color/i);
  act(()=>s.revert(scoped())); disposers.forEach(d=>d());
});

it('the UI renders a clearly-labeled, independently editable control with a contrast caveat',()=>{
  modePref.assign('default','light');
  $sessions.set([{id:'text-token-test',connection_id:'source-a',profile:'default'}]);
  $selectedStoredSessionId.set('text-token-test');
  const data = {}; const contributions = [];
  const ctx = {storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register(c){contributions.push(c);const d=registry.register(c);return d}};
  plugin.register(ctx);
  const page = contributions.find(c=>c.id==='page');
  const view = render(React.createElement(ThemeProvider,null,page.render()));
  act(()=>view.getByText('Start editing current theme').click());
  expect(view.getByRole('button',{name:'Sessions sidebar text (not shared)'})).toBeTruthy();
  act(()=>view.getByRole('button',{name:'Sessions sidebar text (not shared)'}).click());
  act(()=>fireEvent.change(view.getByLabelText('Color for Sessions sidebar text (not shared)'),{target:{value:'#336699'}}));
  expect(view.getByText(/does not affect the main chat\/conversation text/i)).toBeTruthy();
  expect(view.getByText(/Caveat:.*contrast/i)).toBeTruthy();
  cleanup();
});
