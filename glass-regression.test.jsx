import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent,waitFor} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,describe} from 'vitest';
import {ThemeProvider} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {setConnection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import plugin, {createStudio, backgroundImageCSS, saveBackgroundImageSettings, resolveBackgroundImageDataUrl} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); document.documentElement.removeAttribute('data-hermes-glass'); document.querySelectorAll('[data-theme-studio-bg-image]').forEach(el => el.remove()); });

function ctxWith(data, extra) {
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) }, register: () => () => {}, ...extra };
}

describe('ROOT CAUSE 1: the glass gate previously suppressed the image entirely', () => {
  it('backgroundImageCSS output applies to :root unconditionally -- no :not([data-hermes-glass]) and no [data-hermes-glass] gate anywhere', () => {
    const css = backgroundImageCSS('data:image/png;base64,AAA=', 60);
    expect(css).not.toMatch(/data-hermes-glass/);
    expect(css).toContain('[data-chat-surface]::before');
    expect(css).toContain('opacity: 0.6');
  });
});

describe('ROOT CAUSE 2 (superseded): the style injector no longer depends on ANY UI contribution being mounted at all -- not the Studio page, not a statusbar item, nothing', () => {
  it('register(ctx) alone injects CSS with ZERO React tree rendered -- no page, no statusbar render, no chat-empty slot', async () => {
    setConnection({ connectionId: 'conn-mount', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = { 'background-image-v1': { [JSON.stringify(['conn-mount', 'default'])]: { path: 'C:\\wall.png', opacity: 70 } } };
    const registrations = [];
    const ctx = { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = v }, register: c => { registrations.push(c); return () => {}; }, onDispose() {} };
    // Deliberately a bot-mode-like scenario: a statusBar.right item can be
    // hidden/unmounted and the chat-empty splash can be whatever it wants --
    // neither is rendered here, and the background must still show.
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,ZZZ=' };
    plugin.register(ctx);
    // There is no longer a 'bg-image-style' render contribution to find or render.
    expect(registrations.find(c => c.id === 'bg-image-style')).toBeUndefined();
    await waitFor(() => {
      const el = document.querySelector('[data-theme-studio-bg-image]');
      expect(el).toBeTruthy();
      expect(el.textContent).toContain('ZZZ=');
    });
    delete window.hermesDesktop;
  });
});

describe('ROOT CAUSE 1 END-TO-END: the injected style still carries the image rule in BOTH glass-off and glass-on modes', () => {
  async function registerWithImage(connectionId, profile) {
    setConnection({ connectionId, mode: 'remote', profile });
    $activeGatewayProfile.set(profile);
    const scope = JSON.stringify([connectionId, profile]);
    const data = { 'background-image-v1': { [scope]: { path: 'C:\\wall.png', opacity: 55 } } };
    const ctx = { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = v }, register: c => () => {}, onDispose() {} };
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,GLASSTEST=' };
    plugin.register(ctx);
    await waitFor(() => expect(document.querySelector('[data-theme-studio-bg-image]').textContent).toContain('GLASSTEST='));
  }

  it('glass OFF: image CSS is present', async () => {
    await registerWithImage('conn-glass-off', 'default');
    const text = document.querySelector('[data-theme-studio-bg-image]').textContent;
    expect(text).toContain('opacity: 0.55');
    expect(text).not.toMatch(/data-hermes-glass/);
    delete window.hermesDesktop;
  });

  it('glass ON: image CSS is STILL present (this is the bug that is being fixed -- previously this rule was entirely absent under glass)', async () => {
    document.documentElement.setAttribute('data-hermes-glass', '');
    await registerWithImage('conn-glass-on', 'default');
    const text = document.querySelector('[data-theme-studio-bg-image]').textContent;
    expect(text).toContain('opacity: 0.55');
    expect(text).toContain('[data-chat-surface]::before');
    expect(text).not.toMatch(/data-hermes-glass/); // no gate -- same CSS text regardless of the attribute
    delete window.hermesDesktop;
  });
});

describe('Opacity slider still works correctly in both modes', () => {
  it('backgroundImageCSS reflects the chosen opacity identically whether or not glass is active (CSS text does not branch on the attribute)', () => {
    for (const glass of [false, true]) {
      if (glass) document.documentElement.setAttribute('data-hermes-glass', ''); else document.documentElement.removeAttribute('data-hermes-glass');
      for (const pct of [0, 1, 40, 99, 100]) {
        const css = backgroundImageCSS('data:image/png;base64,AAA=', pct);
        if (pct === 0) { expect(css).toBe(''); continue; }
        expect(css).toContain(`opacity: ${pct / 100}`);
      }
    }
    document.documentElement.removeAttribute('data-hermes-glass');
  });
});

describe('UNTOUCHED: existing chatBackground / sessions-sidebar glass gating is unaffected by the fix', () => {
  it('saving a chat-background color edit through createStudio still gates with :not([data-hermes-glass]) exactly as before', () => {
    const data = {};
    const ctx = ctxWith(data);
    const s = createStudio(ctx);
    const api = { scope: 'scope-chat', resolvedMode: 'light', theme: { name: 'theme-studio-base', label: 'Base', colors: { background: '#111111', foreground: '#eeeeee', primary: '#2222aa' } }, themeName: 'nous', clearThemePreview() {}, previewTheme() {} };
    s.begin(api);
    s.edit('chatBackground', '#445566', api);
    const name = s.save('Chat color test', api);
    const saved = data['scoped-themes-v1'].find(x => x.theme.name === name).theme;
    expect(saved.customCSS).toContain(':not([data-hermes-glass]) [data-chat-surface] { --ui-chat-surface-background: #445566; }');
  });

  it('saving a sessions-sidebar color edit still produces both the :not(glass) rule AND the [data-hermes-glass] color-mix rule exactly as before', () => {
    const data = {};
    const ctx = ctxWith(data);
    const s = createStudio(ctx);
    const api = { scope: 'scope-sidebar', resolvedMode: 'light', theme: { name: 'theme-studio-base2', label: 'Base2', colors: { background: '#111111', foreground: '#eeeeee', primary: '#2222aa' } }, themeName: 'nous', clearThemePreview() {}, previewTheme() {} };
    s.begin(api);
    s.edit('sessionsSidebarBackground', '#778899', api);
    const name = s.save('Sidebar color test', api);
    const saved = data['scoped-themes-v1'].find(x => x.theme.name === name).theme;
    expect(saved.customCSS).toContain(':not([data-hermes-glass]) [data-tour="sessions-sidebar"][data-slot="sidebar"] { --ui-sidebar-surface-background: #778899; }');
    expect(saved.customCSS).toContain(':root[data-hermes-glass] [data-tour="sessions-sidebar"][data-slot="sidebar"] { background-color: color-mix(in srgb, #778899 var(--translucency-glass-keep, 100%), transparent); }');
  });
});

describe('Per-profile scoping still holds after the fix', () => {
  it('two different (connection, profile) scopes keep independent background-image settings', async () => {
    setConnection({ connectionId: 'conn-scope-x', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const ctx = ctxWith(data);
    saveBackgroundImageSettings(ctx, JSON.stringify(['conn-scope-x', 'alpha']), { path: 'C:\\alpha.png', opacity: 60 });
    saveBackgroundImageSettings(ctx, JSON.stringify(['conn-scope-x', 'beta']), { path: 'C:\\beta.png', opacity: 20 });
    expect(data['background-image-v1'][JSON.stringify(['conn-scope-x', 'alpha'])].path).toBe('C:\\alpha.png');
    expect(data['background-image-v1'][JSON.stringify(['conn-scope-x', 'beta'])].path).toBe('C:\\beta.png');
  });
});

describe('Picker/storage remain path-only (no base64/data: URLs ever written to ctx.storage)', () => {
  it('resolveBackgroundImageDataUrl resolution never gets persisted by saveBackgroundImageSettings', async () => {
    const data = {};
    const ctx = ctxWith(data);
    const resolved = await resolveBackgroundImageDataUrl('C:\\photo.jpg', async () => 'data:image/jpeg;base64,FFFF=');
    expect(resolved).toBe('data:image/jpeg;base64,FFFF=');
    saveBackgroundImageSettings(ctx, 'scope-path-only', { path: 'C:\\photo.jpg', opacity: 50 });
    expect(JSON.stringify(data['background-image-v1'])).not.toMatch(/data:|base64/);
  });
});
