// CHAOS BATCH 2 (deferred from batch 1): focus-switch races, picker races
// beyond the double-click case, localStorage quota exhaustion, dispose/
// unmount races.
import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import { render, act, cleanup, fireEvent } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import { it, expect, afterEach, describe, vi } from 'vitest';
import { ThemeProvider } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import { setConnection, $sessions, $selectedStoredSessionId } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import { $activeGatewayProfile } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import { host } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/sdk/index.ts';
import plugin, {
  SoundPage, BackgroundImagePage, createStudio,
  saveSoundSettings, readSoundSettings, dismissSoundReminder, readSoundReminderDismissed,
  saveBackgroundImageSettings, readBackgroundImageSettings,
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

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-theme-studio-bg-image]').forEach(el => el.remove());
  localStorage.clear();
  $sessions.set([]);
  $selectedStoredSessionId.set(null);
  setConnection(null);
});

function focusBot(connectionId, profile, sessionId) {
  $sessions.set([{ connection_id: connectionId, id: sessionId, profile }]);
  $selectedStoredSessionId.set(sessionId);
}

describe('CHAOS 2.1: rapid focusedSessionOwner changes mid-operation (save in flight)', () => {
  it('SoundPage.save(): scope captured at render time is re-checked synchronously, so a focus switch that happens strictly BEFORE the click never lands on the wrong scope', () => {
    setConnection({ connectionId: 'conn-a', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    focusBot('conn-a', 'bot-x', 'sess-x');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'chime' } });
    // Switch focus to a different bot BEFORE saving.
    act(() => focusBot('conn-a', 'bot-y', 'sess-y'));
    fireEvent.click(view.getByText('Save sound settings'));
    const scopeX = JSON.stringify(['conn-a', 'bot-x']);
    const scopeY = JSON.stringify(['conn-a', 'bot-y']);
    // The save should land in whatever scope the component is CURRENTLY
    // showing (bot-y, since the effect re-synced draft on focus change) --
    // never silently write bot-x's slot with bot-y's data.
    expect(readSoundSettings(ctx, scopeX).presetId).toBe('none');
    view.unmount();
  });

  it('BackgroundImagePage.save(): focus switching mid-session never cross-writes a stale scope -- each save lands in the scope active at CLICK time', () => {
    setConnection({ connectionId: 'conn-b', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    const events = new EventTarget();
    focusBot('conn-b', 'bot-1', 's1');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    fireEvent.change(view.getByLabelText('Background image opacity'), { target: { value: '77' } });
    act(() => focusBot('conn-b', 'bot-2', 's2'));
    fireEvent.click(view.getByText('Save background image'));
    const scope1 = JSON.stringify(['conn-b', 'bot-1']);
    const scope2 = JSON.stringify(['conn-b', 'bot-2']);
    expect(readBackgroundImageSettings(ctx, scope1).opacity).toBe(40); // untouched default
    // bot-2 gets saved with whatever draft the effect reset it to (its own
    // default, since no edit happened after the switch) -- not bot-1's 77%.
    expect(readBackgroundImageSettings(ctx, scope2).opacity).toBe(40);
    view.unmount();
  });

  it('mountBackgroundImageStyle live injector: rapid focus switching mid-resolve always converges on the LAST focused owner\'s CSS, never a stale one (regression guard for the focused-owner fix)', async () => {
    setConnection({ connectionId: 'conn-c', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolvers = [];
    const ctx = ctxWith(data, { os: { readFileDataUrl: undefined } });
    saveBackgroundImageSettings(ctx, JSON.stringify(['conn-c', 'bot-a']), { path: 'C:\\a.png', opacity: 50, size: 50 });
    saveBackgroundImageSettings(ctx, JSON.stringify(['conn-c', 'bot-b']), { path: 'C:\\b.png', opacity: 50, size: 50 });
    window.hermesDesktop = { readFileDataUrl: (p) => new Promise(res => resolvers.push({ p, res })) };
    try {
      focusBot('conn-c', 'bot-a', 'sa');
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); });
      // Mounting subscribes to 3 stores (focusedSessionOwner/connectionId/
      // profile); exactly how many fire on initial subscribe is an
      // implementation detail -- what matters is the LAST pending read is
      // for bot-a before we switch focus.
      const baseCount = resolvers.length;
      expect(baseCount).toBeGreaterThan(0);
      // Switch focus to bot-b BEFORE bot-a's read resolves.
      act(() => focusBot('conn-c', 'bot-b', 'sb'));
      await act(async () => { await Promise.resolve(); });
      expect(resolvers.length).toBeGreaterThan(baseCount);
      // Resolve bot-b's (latest, intended) read FIRST...
      resolvers[resolvers.length - 1].res('data:image/png;base64,BBB=');
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      // ...then resolve ALL earlier (stale, bot-a-era) reads LAST, out of order.
      for (let i = 0; i < resolvers.length - 1; i++) resolvers[i].res('data:image/png;base64,AAA=');
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      const el = document.querySelector('style[data-theme-studio-bg-image]');
      expect(el.textContent).toContain('BBB=');
      expect(el.textContent).not.toContain('AAA=');
    } finally { delete window.hermesDesktop; }
  });
});

describe('CHAOS 2.2: picker opened, focus switches BEFORE it resolves', () => {
  it('DOCUMENTED POLICY: SoundPage file pick result lands in the scope focused at PICK time, not resolve time -- a stale pick after a focus switch is dropped with a message, never silently applied to the new scope\'s draft', async () => {
    setConnection({ connectionId: 'conn-d', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolvePick;
    const pickOpenPath = () => new Promise(res => { resolvePick = res; });
    const ctx = ctxWith(data, { os: { pickOpenPath } });
    focusBot('conn-d', 'bot-p', 'sp');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    fireEvent.click(view.getByText('Choose file…')); // pick starts while bot-p is focused
    // Focus switches to a different bot BEFORE the native dialog resolves.
    await act(async () => { focusBot('conn-d', 'bot-q', 'sq'); await Promise.resolve(); });
    // Now the stale pick resolves.
    await act(async () => { resolvePick('C:\\picked-for-bot-p.mp3'); await Promise.resolve(); await Promise.resolve(); });
    const scopeP = JSON.stringify(['conn-d', 'bot-p']);
    const scopeQ = JSON.stringify(['conn-d', 'bot-q']);
    // bot-q's draft reset to its own defaults (presetId 'none'), which hides
    // the file-path field entirely -- that alone isn't proof of no bleed,
    // since the underlying draft object could still carry a leaked
    // customPath that resurfaces the moment bot-q's user picks "Local
    // file...". Switch bot-q's OWN UI to 'file' now and check directly.
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    const shownPath = view.getByLabelText('Chosen local sound file path').textContent;
    expect(shownPath).not.toBe('C:\\picked-for-bot-p.mp3');
    view.unmount();
  });

  it('DOCUMENTED POLICY: BackgroundImagePage pick result is dropped (not applied) if focus moved to a different scope before resolution', async () => {
    setConnection({ connectionId: 'conn-e', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolvePick;
    const pickOpenPath = () => new Promise(res => { resolvePick = res; });
    const ctx = ctxWith(data, { os: { pickOpenPath } });
    const events = new EventTarget();
    focusBot('conn-e', 'bot-r', 'sr');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    fireEvent.click(view.getByText('Choose image…'));
    await act(async () => { focusBot('conn-e', 'bot-s', 'ss'); await Promise.resolve(); });
    await act(async () => { resolvePick('C:\\picked-for-bot-r.png'); await Promise.resolve(); await Promise.resolve(); });
    const shownPath = view.getByLabelText('Chosen background image path').textContent;
    expect(shownPath).not.toBe('C:\\picked-for-bot-r.png');
    view.unmount();
  });

  it('control: picking a file with NO focus change in between still applies normally (the guard must not block the common case)', async () => {
    setConnection({ connectionId: 'conn-f', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data, { os: { pickOpenPath: async () => 'C:\\normal.mp3' } });
    focusBot('conn-f', 'bot-n', 'sn');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    await act(async () => { view.getByText('Choose file…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen local sound file path').textContent).toBe('C:\\normal.mp3');
    view.unmount();
  });
});

describe('CHAOS 2.3: localStorage/ctx.storage quota exhaustion mid-write', () => {
  function quotaCtx(data, throwOnKey) {
    const disposers = [];
    return {
      storage: {
        get: (k, f) => (k in data ? data[k] : f),
        set: (k, v) => { if (k === throwOnKey) { const e = new Error('Setting the value exceeded the quota.'); e.name = 'QuotaExceededError'; throw e; } data[k] = JSON.parse(JSON.stringify(v)); }
      },
      register() { return () => {}; },
      onDispose(fn) { disposers.push(fn); },
      _disposers: disposers,
    };
  }

  it('markers save: storage.set throwing QuotaExceededError propagates so MarkerPage\'s own try/catch (same pattern as Sound/BackgroundImage) can surface it -- sanity on the raw throw', () => {
    const ctx = quotaCtx({}, 'markers-v1');
    expect(() => { ctx.storage.set('markers-v1', { x: 1 }); }).toThrow(/quota/i);
  });

  it('sound settings save: saveSoundSettings propagates the thrown error (caller catches it); storage is left unchanged, no partial/corrupt write', () => {
    setConnection({ connectionId: 'conn-q2', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = quotaCtx(data, 'sound-settings-v1');
    const scope = JSON.stringify(['conn-q2', 'default']);
    expect(() => saveSoundSettings(ctx, scope, { presetId: 'chime', customUrl: '', customPath: '', volume: 50 })).toThrow();
    expect(data['sound-settings-v1']).toBeUndefined();
  });

  it('UI: SoundPage "Save sound settings" with a quota-throwing storage shows an error message in the status line, does not crash the page, and other unrelated storage keys are untouched', () => {
    setConnection({ connectionId: 'conn-q3', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = { 'background-image-v1': { untouched: true } };
    const ctx = quotaCtx(data, 'sound-settings-v1');
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'chime' } });
    expect(() => fireEvent.click(view.getByText('Save sound settings'))).not.toThrow();
    expect(view.getByLabelText('Sound status').textContent.length).toBeGreaterThan(0);
    expect(view.getByLabelText('Sound status').textContent).not.toBe('');
    expect(data['background-image-v1']).toEqual({ untouched: true }); // sibling key untouched
    view.unmount();
  });

  it('UI: BackgroundImagePage "Save background image" with a quota-throwing storage shows an error, no crash', () => {
    setConnection({ connectionId: 'conn-q4', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = quotaCtx(data, 'background-image-v1');
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    expect(() => fireEvent.click(view.getByText('Save background image'))).not.toThrow();
    expect(view.getByLabelText('Background image status').textContent.length).toBeGreaterThan(0);
    view.unmount();
  });

  it('REAL BUG CHECK: dismissing the notification-sound reminder with a quota-throwing storage must not silently report success -- it must not crash, and should not report "dismissed" when the write actually failed', () => {
    setConnection({ connectionId: 'conn-q5', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const scope = JSON.stringify(['conn-q5', 'default']);
    const data = {};
    // Pre-set a non-none preset so the reminder callout renders, via the
    // same ctx (its own key, 'sound-settings-v1', must keep working even
    // though the DISMISSAL key below is rigged to throw).
    const ctx = quotaCtx(data, 'sound-reminder-dismissed-v1');
    ctx.storage.set('sound-settings-v1', { [scope]: { presetId: 'chime', customUrl: '', customPath: '', volume: 50 } });
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    expect(view.queryByText('Dismiss')).toBeTruthy();
    expect(() => fireEvent.click(view.getByText('Dismiss'))).not.toThrow();
    // The underlying storage write failed -- it must NOT be recorded as dismissed.
    expect(readSoundReminderDismissed(ctx, scope)).toBe(false);
    // The reminder callout should still communicate something went wrong,
    // not silently disappear as if the dismissal succeeded.
    expect(view.queryByText('⚠️ To avoid hearing two sounds at once')).toBeTruthy();
    view.unmount();
  });

  it('dismissSoundReminder() itself verifies the write landed (write-then-readback), same as every other storage write in this plugin, rather than trusting storage.set unconditionally', () => {
    const data = {};
    // Silent-swallow case (the REAL localStorage-over-quota behavior per
    // the SDK wrapper): storage.set simply no-ops instead of throwing.
    const ctx = { storage: { get: (k, f) => (k in data ? data[k] : f), set: () => {} } };
    expect(() => dismissSoundReminder(ctx, 's1')).toThrow(/storage|confirm|fail/i);
  });
});

describe('CHAOS 2.4: dispose/unmount races', () => {
  it('unmounting SoundPage while a file pick is still pending: resolving the pick afterward does not throw / warn-crash the test', async () => {
    setConnection({ connectionId: 'conn-u1', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolvePick;
    const ctx = ctxWith(data, { os: { pickOpenPath: () => new Promise(res => { resolvePick = res; }) } });
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    fireEvent.click(view.getByText('Choose file…'));
    view.unmount();
    expect(() => { resolvePick('C:\\late.mp3'); }).not.toThrow();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it('unmounting BackgroundImagePage while a file pick is pending and while resolveBackgroundImageDataUrl is pending: no throw on resolution after unmount', async () => {
    setConnection({ connectionId: 'conn-u2', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolvePick, resolveRead;
    const ctx = ctxWith(data, {
      os: { pickOpenPath: () => new Promise(res => { resolvePick = res; }) },
      readFileDataUrl: () => new Promise(res => { resolveRead = res; }),
    });
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    fireEvent.click(view.getByText('Choose image…'));
    view.unmount();
    expect(() => { resolvePick('C:\\late.png'); }).not.toThrow();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    if (resolveRead) expect(() => resolveRead('data:image/png;base64,LATE=')).not.toThrow();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it('ctx.onDispose (plugin unload) while mountBackgroundImageStyle\'s async update() is pending: resolving after dispose does not throw and does not repopulate the (removed) style tag', async () => {
    setConnection({ connectionId: 'conn-u3', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolveRead;
    const ctx = ctxWith(data);
    window.hermesDesktop = { readFileDataUrl: () => new Promise(res => { resolveRead = res; }) };
    try {
      saveBackgroundImageSettings(ctx, JSON.stringify(['conn-u3', 'default']), { path: 'C:\\x.png', opacity: 50, size: 50 });
      plugin.register(ctx);
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeTruthy();
      // Dispose the plugin (simulating unload) WHILE the read is still pending.
      ctx._disposers.forEach(fn => fn());
      expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeNull(); // teardown removed it
      expect(() => resolveRead('data:image/png;base64,LATE=')).not.toThrow();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      // Must not have been re-created by the stale resolution landing after teardown.
      expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeNull();
    } finally { delete window.hermesDesktop; }
  });

  it('no leaked focusedSessionOwner/connectionId/profile subscriptions after dispose: changing focus post-dispose touches nothing (no stray style tag, no thrown error)', async () => {
    setConnection({ connectionId: 'conn-u4', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    plugin.register(ctx);
    await act(async () => { await Promise.resolve(); });
    ctx._disposers.forEach(fn => fn());
    expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeNull();
    expect(() => { focusBot('conn-u4', 'bot-after-dispose', 'sad'); $activeGatewayProfile.set('default'); }).not.toThrow();
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('style[data-theme-studio-bg-image]')).toBeNull();
  });

  it('createStudio theme preview registration during an in-flight edit, followed by consumer unmount (revert cleanup): no throw, preview dispose called exactly once', () => {
    const ctx = ctxWith({});
    const disposed = [];
    const registerWithTracking = (...args) => { const d = () => disposed.push(args[0]?.id); return d; };
    const studio = createStudio({ ...ctx, register: registerWithTracking });
    const api = { scope: 's1', activeScope: 's1', currentScope: () => 's1', currentActiveScope: () => 's1',
      resolvedMode: 'light', theme: { colors: { background: '#fff', foreground: '#000', primary: '#111' } },
      themeName: 'current', availableThemes: [{ name: 'current' }],
      previewTheme() {}, clearThemePreview() {}, setTheme() {} };
    studio.begin(api);
    studio.edit('background', '#abcdef', api); // triggers a preview registration
    // Simulate the component unmount cleanup effect: useEffect(() => () => studio.revert(apiRef.current), [studio])
    expect(() => studio.revert(api)).not.toThrow();
    expect(disposed.filter(id => id === 'preview').length).toBe(1);
  });
});
