// Regression coverage for "background image uses the wrong scope in Bot mode".
//
// Root cause: mountBackgroundImageStyle() and BackgroundImagePage computed
// their storage scope from host.state.connectionId + host.state.profile --
// the AMBIENT $activeGatewayProfile, a single global "which profile is the
// live gateway currently routed to" value (documented in sdk/index.ts as a
// compatibility-ladder fallback only). Bot Mode routes bot chats as tabs
// that don't necessarily move the ambient gateway profile, so the focused
// tab's OWN saved background settings were never found (scope lookup miss
// -> blank background), while a different tab's settings could leak in if
// the ambient scope happened to match something else.
//
// Fix: resolve scope from host.state.focusedSessionOwner (the
// connection-qualified owner of the FOCUSED chat -- explicitly documented
// in sdk/index.ts as the primitive to "prefer ... for any readout or
// mutation where separate sources can share a profile name"), falling back
// to the ambient connection/profile pair only when no session is focused
// (e.g. a brand-new draft with nothing focused yet).
//
// These tests simulate a focused owner that DIVERGES from the ambient
// profile the same way host-state.test.ts does for focusedSessionOwner
// itself: via session.$sessions + session.$selectedStoredSessionId, kept
// independent of $activeGatewayProfile/setConnection.
import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import { render, act, cleanup, fireEvent } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import { it, expect, afterEach, describe } from 'vitest';
import { ThemeProvider } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import { setConnection, $sessions, $selectedStoredSessionId } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import { $activeGatewayProfile } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import { host } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/sdk/index.ts';
import plugin, {
  BackgroundImagePage, saveBackgroundImageSettings, readBackgroundImageSettings
} from './plugin.js';

function ctxWith(data, extra) {
  const disposers = [];
  return {
    storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => (data[k] = JSON.parse(JSON.stringify(v))) },
    register() { return () => {}; },
    onDispose(fn) { disposers.push(fn); },
    _disposers: disposers,
    ...extra
  };
}
function styleTagText() {
  const el = document.querySelector('style[data-theme-studio-bg-image]');
  return el ? el.textContent : null;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-theme-studio-bg-image]').forEach(el => el.remove());
  localStorage.clear();
  $sessions.set([]);
  $selectedStoredSessionId.set(null);
  setConnection(null);
});

describe('Background image: scope resolution follows focusedSessionOwner, not the ambient profile', () => {
  it('sanity: a focused session row with a DIFFERENT owner than the ambient gateway profile is visible on host.state.focusedSessionOwner (independent of host.state.profile)', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default'); // ambient stays on "default"
    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-1', profile: 'bot-worker' }]);
    $selectedStoredSessionId.set('bot-session-1'); // the FOCUSED tab belongs to "bot-worker"

    expect(host.state.profile.get()).toBe('default'); // ambient unchanged
    expect(host.state.focusedSessionOwner.get()).toEqual({ connectionId: 'conn-main', profile: 'bot-worker' });
  });

  it('BUG REPRODUCTION (pre-fix behavior would fail this): a Bot tab focused with its own owner reads its OWN saved background, not the ambient-profile scope and not blank', async () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data, { os: { readFileDataUrl: async () => 'data:image/png;base64,BOT=' } });

    // Save under the bot tab's OWN owner-derived scope.
    const botScope = JSON.stringify(['conn-main', 'bot-worker']);
    saveBackgroundImageSettings(ctx, botScope, { path: 'C:\\bot.png', opacity: 77, size: 40 });
    // The ambient-profile scope ("default") has nothing saved -- if the fix
    // regressed to the old ambient lookup this would resolve to blank.
    const ambientScope = JSON.stringify(['conn-main', 'default']);
    expect(readBackgroundImageSettings(ctx, ambientScope).path).toBe('');

    // Now focus the bot tab (owner diverges from ambient profile).
    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-1', profile: 'bot-worker' }]);
    $selectedStoredSessionId.set('bot-session-1');

    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,BOT=' };
    try {
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('BOT=');
      expect(styleTagText()).toContain('opacity: 0.77');
      expect(styleTagText()).toContain('background-size: 40% auto');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('switching focus between two owners (both sharing the SAME ambient profile the whole time) re-resolves per-owner, proving the ambient profile is not what drives it', async () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default'); // never changes for the whole test
    const data = {};
    const ctx = ctxWith(data);
    const scopeA = JSON.stringify(['conn-main', 'bot-a']);
    const scopeB = JSON.stringify(['conn-main', 'bot-b']);
    saveBackgroundImageSettings(ctx, scopeA, { path: 'C:\\a.png', opacity: 90, size: 50 });
    saveBackgroundImageSettings(ctx, scopeB, { path: 'C:\\b.png', opacity: 20, size: 50 });

    window.hermesDesktop = { readFileDataUrl: async p => `data:image/png;base64,${p.includes('a.png') ? 'AAA' : 'BBB'}=` };
    try {
      $sessions.set([
        { connection_id: 'conn-main', id: 'tile-a', profile: 'bot-a' },
        { connection_id: 'conn-main', id: 'tile-b', profile: 'bot-b' }
      ]);
      $selectedStoredSessionId.set('tile-a');
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('AAA');
      expect(host.state.profile.get()).toBe('default'); // ambient truly never moved

      $selectedStoredSessionId.set('tile-b');
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('BBB');
      expect(host.state.profile.get()).toBe('default');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('normal single-profile chat (no distinct focused-session owner beyond the active one) still resolves and applies the saved background', async () => {
    setConnection({ connectionId: 'conn-solo', mode: 'remote', profile: 'Nova' });
    $activeGatewayProfile.set('Nova');
    const data = {};
    const ctx = ctxWith(data);
    const scope = JSON.stringify(['conn-solo', 'Nova']);
    saveBackgroundImageSettings(ctx, scope, { path: 'C:\\nova.png', opacity: 60, size: 50 });

    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,NOVA=' };
    try {
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('NOVA=');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('fallback: with no session focused at all (fresh draft), the scope resolves to the ambient connection/profile pair', async () => {
    setConnection({ connectionId: 'conn-draft', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([]);
    $selectedStoredSessionId.set(null);
    // With nothing stored/ambiguous, focusedSessionOwner itself degrades to
    // the active gateway owner (not null) -- the fallback branch in our
    // scope resolution (scopeFor(owner) || scopeFor({connectionId,profile}))
    // is only actually exercised when focusedSessionOwner is genuinely
    // null/unresolved (ambiguous or conflicting owner hints -- see
    // sdk/host-state.test.ts). Either path must land on the SAME scope here.
    expect(host.state.focusedSessionOwner.get()).toEqual({ connectionId: 'conn-draft', profile: 'default' });

    const data = {};
    const ctx = ctxWith(data);
    const ambientScope = JSON.stringify(['conn-draft', 'default']);
    saveBackgroundImageSettings(ctx, ambientScope, { path: 'C:\\draft.png', opacity: 55, size: 50 });

    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,DRAFT=' };
    try {
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('DRAFT=');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('fallback (true null-owner path): when focusedSessionOwner itself resolves to null (ambiguous/conflicting owner hints), scope resolution falls back to the ambient connection/profile pair instead of going scopeless', async () => {
    setConnection({ connectionId: 'source-a', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([
      { connection_id: 'source-a', id: 'shared-tip-a', _lineage_root_id: 'shared-root', profile: 'worker' },
      { connection_id: 'source-b', id: 'shared-root', profile: 'worker' }
    ]);
    $selectedStoredSessionId.set('shared-root');
    expect(host.state.focusedSessionOwner.get()).toBeNull(); // genuinely unresolved

    const data = {};
    const ctx = ctxWith(data);
    const ambientScope = JSON.stringify(['source-a', 'default']);
    saveBackgroundImageSettings(ctx, ambientScope, { path: 'C:\\fallback.png', opacity: 45, size: 50 });

    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,FALLBACK=' };
    try {
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('FALLBACK=');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('SETTINGS PAGE consistency: BackgroundImagePage save()/read() target the SAME owner-resolved scope the style injector uses (round-trip)', async () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-2', profile: 'bot-page' }]);
    $selectedStoredSessionId.set('bot-session-2');

    const data = {};
    const pickOpenPath = async () => 'C:\\pics\\page.png';
    const ctx = ctxWith(data, { os: { pickOpenPath } });
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); await Promise.resolve(); });
    act(() => view.getByText('Save background image').click());

    // Saved under the FOCUSED owner's scope -- NOT the ambient-profile scope.
    const ownerScope = JSON.stringify(['conn-main', 'bot-page']);
    const ambientScope = JSON.stringify(['conn-main', 'default']);
    expect(data['background-image-v1'][ownerScope].path).toBe('C:\\pics\\page.png');
    expect(data['background-image-v1'][ambientScope]).toBeUndefined();

    // The style injector reading the same ctx resolves to the identical scope/value.
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,PAGE=' };
    try {
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(styleTagText()).toContain('PAGE=');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('SETTINGS PAGE: re-mounting the page after the focused owner changes re-reads settings scoped to the NEW owner (no stale cross-owner leak)', async () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = { 'background-image-v1': {
      [JSON.stringify(['conn-main', 'owner-x'])]: { path: 'C:\\x.png', opacity: 50, size: 50 },
      [JSON.stringify(['conn-main', 'owner-y'])]: { path: 'C:\\y.png', opacity: 30, size: 50 }
    } };
    const ctx = ctxWith(data);
    const events = new EventTarget();

    $sessions.set([
      { connection_id: 'conn-main', id: 'owner-x-tile', profile: 'owner-x' },
      { connection_id: 'conn-main', id: 'owner-y-tile', profile: 'owner-y' }
    ]);
    $selectedStoredSessionId.set('owner-x-tile');
    let view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\x.png');
    cleanup();

    $selectedStoredSessionId.set('owner-y-tile');
    view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\y.png');
  });

  it('REGRESSION: opacity/size/centering/glass-hardening CSS shape is unaffected by the scope-resolution change', async () => {
    setConnection({ connectionId: 'conn-shape', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    const scope = JSON.stringify(['conn-shape', 'default']);
    saveBackgroundImageSettings(ctx, scope, { path: 'C:\\shape.png', opacity: 65, size: 73 });

    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,SHAPE=' };
    try {
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      const css = styleTagText();
      expect(css).toContain('opacity: 0.65');
      expect(css).toContain('background-size: 73% auto');
      expect(css).toContain('background-position: center');
      expect(css).toContain('background-repeat: no-repeat');
      expect(css).not.toContain('[data-hermes-glass]'); // unconditional, both modes
      expect(css).toContain('background-color: transparent !important'); // glass hardening rule intact
    } finally {
      delete window.hermesDesktop;
    }
  });
});
