// Regression coverage for "session markers use the wrong scope in Bot mode"
// -- same root cause and fix as bg-image-scope.test.jsx (ambient
// host.state.connectionId/profile vs. host.state.focusedSessionOwner),
// applied to the ScopeStyle (marker CSS injector) / MarkerPage (settings)
// pair. See marker-integration.test.jsx for the pre-existing non-scope
// marker test this must keep passing unmodified.
import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import { render, act, cleanup, fireEvent } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import { it, expect, afterEach, describe } from 'vitest';
import { ThemeProvider } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import { setConnection, $sessions, $selectedStoredSessionId } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import { $activeGatewayProfile } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import { host } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/sdk/index.ts';
import plugin, { markerCSS } from './plugin.js';

function ctxWith(data) {
  const registrations = [];
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => (data[k] = JSON.parse(JSON.stringify(v))) },
    register(c) { registrations.push(c); return () => {}; },
    _registrations: registrations };
}
function mount(ctx) {
  const style = ctx._registrations.find(c => c.id === 'marker-style');
  const page = ctx._registrations.find(c => c.id === 'page');
  return render(React.createElement(ThemeProvider, null, style.render(), page.render()));
}
function markerStyleText() {
  const el = document.querySelector('[data-theme-studio-session-markers]');
  return el ? el.textContent : null;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-theme-studio-session-markers]').forEach(el => el.remove());
  localStorage.clear();
  $sessions.set([]);
  $selectedStoredSessionId.set(null);
  setConnection(null);
});

describe('Session markers: scope resolution follows focusedSessionOwner, not the ambient profile', () => {
  it('BUG REPRODUCTION (pre-fix would fail): a focused Bot tab reads its OWN saved markers, not the ambient-profile scope', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const botScope = JSON.stringify(['conn-main', 'bot-worker']);
    const data = { 'markers-v1': { [botScope]: { unread: { enabled: true, icon: '*', color: '#112233' } } } };
    const ctx = ctxWith(data);
    plugin.register(ctx);

    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-1', profile: 'bot-worker' }]);
    $selectedStoredSessionId.set('bot-session-1');

    const view = mount(ctx);
    expect(markerStyleText()).toContain('#112233');
    expect(host.state.profile.get()).toBe('default'); // ambient never moved
    view.unmount();
  });

  it('switching focus between two owners (ambient profile never changes) re-resolves marker CSS per-owner', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const scopeA = JSON.stringify(['conn-main', 'bot-a']);
    const scopeB = JSON.stringify(['conn-main', 'bot-b']);
    const data = { 'markers-v1': {
      [scopeA]: { unread: { enabled: true, icon: '', color: '#aaaaaa' } },
      [scopeB]: { unread: { enabled: true, icon: '', color: '#bbbbbb' } }
    } };
    const ctx = ctxWith(data);
    plugin.register(ctx);
    $sessions.set([
      { connection_id: 'conn-main', id: 'tile-a', profile: 'bot-a' },
      { connection_id: 'conn-main', id: 'tile-b', profile: 'bot-b' }
    ]);
    $selectedStoredSessionId.set('tile-a');
    const view = mount(ctx);
    expect(markerStyleText()).toContain('#aaaaaa');
    expect(markerStyleText()).not.toContain('#bbbbbb');

    act(() => { $selectedStoredSessionId.set('tile-b'); });
    expect(markerStyleText()).toContain('#bbbbbb');
    expect(markerStyleText()).not.toContain('#aaaaaa');
    expect(host.state.profile.get()).toBe('default');
    view.unmount();
  });

  it('fallback: with no session focused at all, marker scope resolves to the ambient connection/profile pair', () => {
    setConnection({ connectionId: 'conn-draft', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([]);
    $selectedStoredSessionId.set(null);
    const ambientScope = JSON.stringify(['conn-draft', 'default']);
    const data = { 'markers-v1': { [ambientScope]: { working: { enabled: true, icon: '', color: '#ffffff' } } } };
    const ctx = ctxWith(data);
    plugin.register(ctx);
    const view = mount(ctx);
    expect(markerStyleText()).toContain('#ffffff');
    view.unmount();
  });

  it('SETTINGS PAGE consistency: MarkerPage save() targets the SAME owner-resolved scope the style injector uses (round-trip)', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-2', profile: 'bot-page' }]);
    $selectedStoredSessionId.set('bot-session-2');

    const data = {};
    const ctx = ctxWith(data);
    plugin.register(ctx);
    const view = mount(ctx);

    fireEvent.click(view.getAllByLabelText('Customize')[0]);
    fireEvent.change(view.getByLabelText('Finished, unread symbol'), { target: { value: '#' } });
    fireEvent.change(view.getByLabelText('Finished, unread color'), { target: { value: '#654321' } });
    fireEvent.click(view.getByText('Save marker settings'));

    const ownerScope = JSON.stringify(['conn-main', 'bot-page']);
    const ambientScope = JSON.stringify(['conn-main', 'default']);
    expect(data['markers-v1'][ownerScope].unread.color).toBe('#654321');
    expect(data['markers-v1'][ambientScope]).toBeUndefined();
    expect(markerStyleText()).toContain('#654321');
    view.unmount();
  });

  it('SETTINGS PAGE: re-mounting after the focused owner changes re-reads markers scoped to the NEW owner (no stale cross-owner leak)', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = { 'markers-v1': {
      [JSON.stringify(['conn-main', 'owner-x'])]: { unread: { enabled: true, icon: 'X', color: '#111111' } },
      [JSON.stringify(['conn-main', 'owner-y'])]: { unread: { enabled: true, icon: 'Y', color: '#222222' } }
    } };
    const ctx = ctxWith(data);
    plugin.register(ctx);

    $sessions.set([
      { connection_id: 'conn-main', id: 'owner-x-tile', profile: 'owner-x' },
      { connection_id: 'conn-main', id: 'owner-y-tile', profile: 'owner-y' }
    ]);
    $selectedStoredSessionId.set('owner-x-tile');
    let view = mount(ctx);
    expect(view.getByLabelText('Finished, unread symbol').value).toBe('X');
    view.unmount();

    $selectedStoredSessionId.set('owner-y-tile');
    view = mount(ctx);
    expect(view.getByLabelText('Finished, unread symbol').value).toBe('Y');
    view.unmount();
  });
});
