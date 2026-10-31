// Regression coverage for "background image disappears in Bot mode".
//
// Root cause: BgImageStyle (the <style>-tag injector) was mounted as a
// `statusBar.right` RENDER contribution. That area is a user-toggleable
// statusbar slot -- the desktop fully UNMOUNTS a hidden/absent item's render
// tree rather than just CSS-hiding it (see apps/desktop's own
// use-statusbar-items.tsx comment: "the bar itself is unmounted while
// toggled off"). Unmounting ran BgImageStyle's effect cleanup, which does
// `el.remove()` on the injected <style> tag -- deleting the background CSS
// from the document outright, not just hiding it, for however long that
// statusbar slot/item stays away. A wallpaper is a document-wide visual; it
// has no business depending on whether a chat view's statusbar happens to be
// mounted.
//
// The fix: mount the style-tag injector directly from register(ctx) imperatively,
// subscribed to the real host.state atoms, torn down only via ctx.onDispose
// (plugin unload) -- never tied to any UI contribution's mount lifecycle. This
// file proves that end-to-end with ZERO UI rendered: the whole point is that no
// React tree (statusbar, bot splash, or otherwise) needs to exist for the
// background to be present.
import { it, expect, afterEach, describe } from 'vitest';
import { setConnection } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import { $activeGatewayProfile } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import plugin, { saveBackgroundImageSettings } from './plugin.js';

function ctxWith(data, extra) {
  const disposers = [];
  return {
    storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => (data[k] = JSON.parse(JSON.stringify(v))) },
    register(c) { return () => {}; },
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
  document.querySelectorAll('style[data-theme-studio-bg-image]').forEach(el => el.remove());
  localStorage.clear();
  setConnection(null);
});

describe('Background image persists through Bot mode (no UI mounted at all)', () => {
  it('register(ctx) injects the <style> tag immediately, with zero React tree rendered -- not gated on any statusbar/chat-empty UI being mounted', async () => {
    setConnection({ connectionId: 'conn-bot', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data, { os: { readFileDataUrl: async () => 'data:image/png;base64,AAA=' } });
    const scope = JSON.stringify(['conn-bot', 'default']);
    saveBackgroundImageSettings(ctx, scope, { path: 'C:\\wall.png', opacity: 80, size: 60 });

    // Simulate the data: URL bridge the real resolveBackgroundImageDataUrl uses
    // (never replace the global `window` object itself -- that would strip every
    // real jsdom API out from under every OTHER test sharing this worker).
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,AAA=' };
    try {
      plugin.register(ctx);
      // Flush the async resolveBackgroundImageDataUrl() microtask chain.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(styleTagText()).toContain('[data-chat-surface]::before');
      expect(styleTagText()).toContain('opacity: 0.8');
      expect(styleTagText()).toContain('background-size: 60% auto');
      // Never gated behind glass -- same contract as before.
      expect(styleTagText()).not.toContain('[data-hermes-glass]');
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('REGRESSION: the style tag is NOT a statusBar.right render contribution -- register() never registers one for it', () => {
    const contributions = [];
    const data = {};
    const ctx = ctxWith(data, {
      register(c) { contributions.push(c); return () => {}; }
    });
    plugin.register(ctx);
    const bgContribution = contributions.find(c => c.id === 'bg-image-style');
    expect(bgContribution).toBeUndefined();
    // The marker-style sibling feature is untouched -- still a statusBar.right
    // contribution (its CSS is a sidebar paint, not a document-wide wallpaper,
    // so it's fine to follow the statusbar's lifecycle).
    const markerContribution = contributions.find(c => c.id === 'marker-style');
    expect(markerContribution).toBeTruthy();
    expect(markerContribution.area).toBe('statusBar.right');
  });

  it('switching the active connection/profile re-resolves the background from the real host.state atoms (per-profile scoping holds, no UI needed to react)', async () => {
    setConnection({ connectionId: 'conn-switch', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const ctx = ctxWith(data);
    const scopeAlpha = JSON.stringify(['conn-switch', 'alpha']);
    const scopeBeta = JSON.stringify(['conn-switch', 'beta']);
    saveBackgroundImageSettings(ctx, scopeAlpha, { path: 'C:\\alpha.png', opacity: 90, size: 50 });
    saveBackgroundImageSettings(ctx, scopeBeta, { path: '', opacity: 40, size: 50 }); // beta has none saved

    window.hermesDesktop = { readFileDataUrl: async p => `data:image/png;base64,${p.includes('alpha') ? 'ALPHA' : 'NONE'}=` };
    try {
      plugin.register(ctx);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(styleTagText()).toContain('ALPHA');

      // Switch profile the same way opening a different-profile view would --
      // via the real store, with no React tree listening.
      $activeGatewayProfile.set('beta');
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(styleTagText()).toBe(''); // beta has nothing saved -- no leak from alpha

      $activeGatewayProfile.set('alpha');
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(styleTagText()).toContain('ALPHA'); // comes back when the scope comes back
    } finally {
      delete window.hermesDesktop;
    }
  });

  it('ctx.onDispose (plugin unload) -- not any UI unmount -- is what tears the style tag down', () => {
    const data = {};
    const ctx = ctxWith(data);
    plugin.register(ctx);
    expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeTruthy();
    expect(ctx._disposers.length).toBeGreaterThan(0);
    ctx._disposers.forEach(d => d());
    expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeNull();
  });
});
