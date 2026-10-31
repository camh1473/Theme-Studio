import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach} from 'vitest';
import {ThemeProvider} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {setConnection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import {
  SoundPage, readSoundReminderDismissed, dismissSoundReminder, openNotificationSettings,
  NOTIFICATION_SETTINGS_PATH
} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); });

function setup(connectionId, profile) {
  setConnection({ connectionId, mode: 'remote', profile });
  $activeGatewayProfile.set(profile);
}

it('reminder is absent when the configured sound is None (the default)', () => {
  setup('conn-r1', 'default');
  const data = {};
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  expect(view.queryByRole('alert', { name: 'Notification sound reminder' })).toBeNull();
  cleanup();
});

it('reminder appears once a non-None sound is saved for this scope', () => {
  setup('conn-r2', 'default');
  const data = {};
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  expect(view.queryByRole('alert', { name: 'Notification sound reminder' })).toBeNull();
  fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'chime' } });
  act(() => view.getByText('Save sound settings').click());
  expect(view.getByRole('alert', { name: 'Notification sound reminder' })).toBeTruthy();
  cleanup();
});

it('reminder also appears on load when a non-None sound was already saved for this scope', () => {
  setup('conn-r3', 'default');
  const scope = JSON.stringify(['conn-r3', 'default']);
  const data = { 'sound-settings-v1': { [scope]: { presetId: 'bell', customUrl: '', customPath: '', volume: 50 } } };
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  expect(view.getByRole('alert', { name: 'Notification sound reminder' })).toBeTruthy();
  cleanup();
});

it('Dismiss hides the reminder and persists the dismissal via ctx.storage, scoped per (connection, profile)', () => {
  setup('conn-r4', 'alpha');
  const data = {};
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'ping' } });
  act(() => view.getByText('Save sound settings').click());
  expect(view.getByRole('alert', { name: 'Notification sound reminder' })).toBeTruthy();
  act(() => view.getByText('Dismiss').click());
  expect(view.queryByRole('alert', { name: 'Notification sound reminder' })).toBeNull();
  const scope = JSON.stringify(['conn-r4', 'alpha']);
  expect(data['sound-reminder-dismissed-v1'][scope]).toBe(true);
  expect(readSoundReminderDismissed(ctx, scope)).toBe(true);
  cleanup();

  // Re-mounting the same scope keeps it dismissed (persisted, not just React state).
  const view2 = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  expect(view2.queryByRole('alert', { name: 'Notification sound reminder' })).toBeNull();
  cleanup();
});

it('dismissal is scoped per (connection, profile): a different profile still sees the reminder', () => {
  setup('conn-r5', 'alpha');
  const scope = JSON.stringify(['conn-r5', 'alpha']);
  const otherScope = JSON.stringify(['conn-r5', 'beta']);
  const data = {
    'sound-settings-v1': {
      [scope]: { presetId: 'pop', customUrl: '', customPath: '', volume: 50 },
      [otherScope]: { presetId: 'pop', customUrl: '', customPath: '', volume: 50 }
    },
    'sound-reminder-dismissed-v1': { [scope]: true }
  };
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  expect(view.queryByRole('alert', { name: 'Notification sound reminder' })).toBeNull();
  cleanup();

  $activeGatewayProfile.set('beta'); setConnection({ connectionId: 'conn-r5', mode: 'remote', profile: 'beta' });
  const view2 = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  expect(view2.getByRole('alert', { name: 'Notification sound reminder' })).toBeTruthy();
  cleanup();
});

it('dismissSoundReminder requires a scope and does not clobber other scopes\' dismissals', () => {
  const data = { 'sound-reminder-dismissed-v1': { 'scope-x': true } };
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  expect(() => dismissSoundReminder(ctx, '')).toThrow(/active connection/i);
  dismissSoundReminder(ctx, 'scope-y');
  expect(data['sound-reminder-dismissed-v1']).toEqual({ 'scope-x': true, 'scope-y': true });
  expect(readSoundReminderDismissed(ctx, 'scope-x')).toBe(true);
  expect(readSoundReminderDismissed(ctx, 'scope-y')).toBe(true);
  expect(readSoundReminderDismissed(ctx, 'scope-z')).toBe(false);
});

it('"Open Notification Settings" navigates to the core notifications completion-sound deep link via host.navigate', () => {
  setup('conn-r6', 'default');
  const data = {};
  const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
  const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
  fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'chime' } });
  act(() => view.getByText('Save sound settings').click());
  expect(view.getByText('Open Notification Settings')).toBeTruthy();
  act(() => view.getByText('Open Notification Settings').click());
  expect(window.location.hash).toBe('#' + NOTIFICATION_SETTINGS_PATH);
  cleanup();
});

it('openNotificationSettings is a direct, safe helper call (does not require the rendered page)', () => {
  const ok = openNotificationSettings();
  expect(ok).toBe(true);
  expect(window.location.hash).toBe('#' + NOTIFICATION_SETTINGS_PATH);
});
