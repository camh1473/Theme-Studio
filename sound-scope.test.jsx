// Regression coverage for "notification sound settings use the wrong scope
// in Bot mode" -- same root cause and fix as bg-image-scope.test.jsx,
// applied to the SoundPage settings UI.
//
// handleSoundCompletionEvent is DELIBERATELY left untouched and is NOT
// exercised here as a "bug reproduction" -- it already scopes by the
// completion event's OWN event.profile (what actually finished), not by
// UI focus, so it never had the ambient-profile-vs-focused-tab bug this
// suite is about. See handleSoundCompletionEvent's own comment in
// plugin.js for the full reasoning. We DO re-confirm its existing,
// already-correct behavior below so a future change can't silently swap
// it onto focusedSessionOwner by accident.
import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import { render, act, cleanup, fireEvent } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import { it, expect, afterEach, describe, vi } from 'vitest';
import { ThemeProvider } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import { setConnection, $sessions, $selectedStoredSessionId } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import { $activeGatewayProfile } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import { host } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/sdk/index.ts';
import plugin, { SoundPage, saveSoundSettings, readSoundSettings, handleSoundCompletionEvent } from './plugin.js';

function ctxWith(data, extra) {
  return {
    storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => (data[k] = JSON.parse(JSON.stringify(v))) },
    register() { return () => {}; },
    onDispose() {},
    ...extra
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  $sessions.set([]);
  $selectedStoredSessionId.set(null);
  setConnection(null);
});

describe('Notification sound SETTINGS: scope resolution follows focusedSessionOwner, not the ambient profile', () => {
  it('BUG REPRODUCTION (pre-fix would fail): a focused Bot tab reads/saves its OWN sound settings, not the ambient-profile scope', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const botScope = JSON.stringify(['conn-main', 'bot-worker']);
    const data = {};
    const ctx = ctxWith(data);
    saveSoundSettings(ctx, botScope, { presetId: 'bell', customUrl: '', customPath: '', volume: 70 });

    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-1', profile: 'bot-worker' }]);
    $selectedStoredSessionId.set('bot-session-1');

    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    expect(view.getByLabelText('Notification sound preset').value).toBe('bell');
    expect(view.getByLabelText('Notification sound volume').value).toBe('70');
    expect(host.state.profile.get()).toBe('default'); // ambient never moved
    view.unmount();
  });

  it('switching focus between two owners (ambient profile never changes) re-resolves the displayed sound settings per-owner', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'bot-a']), { presetId: 'ping', customUrl: '', customPath: '', volume: 20 });
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'bot-b']), { presetId: 'pop', customUrl: '', customPath: '', volume: 80 });

    $sessions.set([
      { connection_id: 'conn-main', id: 'tile-a', profile: 'bot-a' },
      { connection_id: 'conn-main', id: 'tile-b', profile: 'bot-b' }
    ]);
    $selectedStoredSessionId.set('tile-a');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    expect(view.getByLabelText('Notification sound preset').value).toBe('ping');

    act(() => { $selectedStoredSessionId.set('tile-b'); });
    expect(view.getByLabelText('Notification sound preset').value).toBe('pop');
    expect(host.state.profile.get()).toBe('default');
    view.unmount();
  });

  it('fallback: with no session focused at all, sound settings resolve to the ambient connection/profile pair', () => {
    setConnection({ connectionId: 'conn-draft', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([]);
    $selectedStoredSessionId.set(null);
    const ambientScope = JSON.stringify(['conn-draft', 'default']);
    const data = {};
    const ctx = ctxWith(data);
    saveSoundSettings(ctx, ambientScope, { presetId: 'chime', customUrl: '', customPath: '', volume: 33 });

    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    expect(view.getByLabelText('Notification sound preset').value).toBe('chime');
    view.unmount();
  });

  it('SAVE: SoundPage save() writes under the FOCUSED owner scope, not the ambient-profile scope', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([{ connection_id: 'conn-main', id: 'bot-session-2', profile: 'bot-page' }]);
    $selectedStoredSessionId.set('bot-session-2');

    const data = {};
    const ctx = ctxWith(data);
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'blip' } });
    fireEvent.change(view.getByLabelText('Notification sound volume'), { target: { value: '55' } });
    fireEvent.click(view.getByText('Save sound settings'));

    const ownerScope = JSON.stringify(['conn-main', 'bot-page']);
    const ambientScope = JSON.stringify(['conn-main', 'default']);
    expect(data['sound-settings-v1'][ownerScope].presetId).toBe('blip');
    expect(data['sound-settings-v1'][ownerScope].volume).toBe(55);
    expect(data['sound-settings-v1'][ambientScope]).toBeUndefined();
    view.unmount();
  });

  it('re-mounting after the focused owner changes re-reads sound settings scoped to the NEW owner (no stale cross-owner leak)', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'owner-x']), { presetId: 'chime', customUrl: '', customPath: '', volume: 10 });
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'owner-y']), { presetId: 'bell', customUrl: '', customPath: '', volume: 90 });

    $sessions.set([
      { connection_id: 'conn-main', id: 'owner-x-tile', profile: 'owner-x' },
      { connection_id: 'conn-main', id: 'owner-y-tile', profile: 'owner-y' }
    ]);
    $selectedStoredSessionId.set('owner-x-tile');
    let view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    expect(view.getByLabelText('Notification sound preset').value).toBe('chime');
    view.unmount();

    $selectedStoredSessionId.set('owner-y-tile');
    view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    expect(view.getByLabelText('Notification sound preset').value).toBe('bell');
    view.unmount();
  });
});

describe('Notification sound COMPLETION EVENT: already scoped by the event\'s own profile, not UI focus (confirm, do not "fix")', () => {
  it('plays the sound saved for the EVENT\'s profile even when a DIFFERENT profile tab is focused in the UI', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    // Focus a completely different tab/owner than the one whose event fires.
    $sessions.set([{ connection_id: 'conn-main', id: 'focused-tile', profile: 'focused-bot' }]);
    $selectedStoredSessionId.set('focused-tile');
    expect(host.state.focusedSessionOwner.get()).toEqual({ connectionId: 'conn-main', profile: 'focused-bot' });

    const data = {};
    const ctx = ctxWith(data);
    // The FINISHING profile's own saved sound -- not the focused tab's.
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'finishing-bot']), { presetId: 'bell', customUrl: '', customPath: '', volume: 60 });
    // Give the focused tab a DIFFERENT sound, to prove it is NOT what plays.
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'focused-bot']), { presetId: 'ping', customUrl: '', customPath: '', volume: 60 });

    // Install a fake AudioContext (jsdom has none) so a real play attempt is
    // observable via handleSoundCompletionEvent's own boolean result, the
    // same technique sound.test.jsx uses for its gateway-event-bus test.
    const originalAC = window.AudioContext;
    const created = [];
    class FakeAC {
      constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
      createGain() { created.push('gain'); return { gain: { setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; }
      createOscillator() { created.push('osc'); return { frequency: { setValueAtTime(){} }, connect(){}, start(){}, stop(){} }; }
    }
    window.AudioContext = FakeAC;
    try {
      const realPlay = handleSoundCompletionEvent(ctx, { type: 'message.complete', profile: 'finishing-bot' });
      // Resolved + actually attempted to play the FINISHING profile's sound
      // (bell = 2 notes), not the focused tab's (ping = 1 note) and not nothing.
      expect(realPlay).toBe(true);
      expect(created.filter(c => c === 'osc').length).toBe(2);
    } finally {
      window.AudioContext = originalAC;
    }
  });

  it('a profile with no saved sound entry stays silent even while a DIFFERENT profile IS focused with a configured sound', () => {
    setConnection({ connectionId: 'conn-main', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    $sessions.set([{ connection_id: 'conn-main', id: 'focused-tile', profile: 'focused-bot' }]);
    $selectedStoredSessionId.set('focused-tile');

    const data = {};
    const ctx = ctxWith(data);
    saveSoundSettings(ctx, JSON.stringify(['conn-main', 'focused-bot']), { presetId: 'ping', customUrl: '', customPath: '', volume: 60 });
    // 'silent-bot' has no saved settings at all.
    const result = handleSoundCompletionEvent(ctx, { type: 'message.complete', profile: 'silent-bot' });
    expect(result).toBe(false);
  });
});
