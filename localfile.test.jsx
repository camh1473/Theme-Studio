import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,describe} from 'vitest';
import {ThemeProvider} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {setConnection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import {
  hermesMediaStreamUrl, playLocalFilePath, playSoundSettings, validSoundSettings,
  saveSoundSettings, readSoundSettings, DEFAULT_SOUND_SETTINGS, SoundPage
} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); });

describe('Local file picker (genuine filesystem browse, distinct from the Custom URL field)', () => {
  it('playLocalFilePath plays the picked path through hermes-media:// (same mechanism as the Windows presets)', () => {
    let created = null;
    const fakeMakeAudio = url => { created = { url, volume: null, played: false, play() { this.played = true; return Promise.resolve(); } }; return created; };
    const played = playLocalFilePath('C:\\Users\\alex\\Music\\ping.mp3', 70, { makeAudio: fakeMakeAudio });
    expect(played).toBe(true);
    expect(created.url).toBe(hermesMediaStreamUrl('C:\\Users\\alex\\Music\\ping.mp3'));
    expect(created.url).toBe('hermes-media://stream/' + encodeURIComponent('C:\\Users\\alex\\Music\\ping.mp3'));
    expect(created.volume).toBeCloseTo(0.7);
    expect(created.played).toBe(true);
  });

  it('playLocalFilePath is silent (no Audio element) at volume 0 or with an empty path', () => {
    let calls = 0;
    const makeAudio = () => { calls++; return { play() { return Promise.resolve(); } }; };
    expect(playLocalFilePath('C:\\a.wav', 0, { makeAudio })).toBe(false);
    expect(playLocalFilePath('', 50, { makeAudio })).toBe(false);
    expect(playLocalFilePath(null, 50, { makeAudio })).toBe(false);
    expect(calls).toBe(0);
  });

  it('validSoundSettings requires a non-empty customPath for presetId "file", and accepts a real one', () => {
    expect(validSoundSettings({ presetId: 'file', customUrl: '', customPath: '', volume: 50 })).toBe(false);
    expect(validSoundSettings({ presetId: 'file', customUrl: '', customPath: 'C:\\sounds\\a.wav', volume: 50 })).toBe(true);
    // customPath is irrelevant (and may be empty) for every other presetId.
    expect(validSoundSettings({ presetId: 'chime', customUrl: '', customPath: '', volume: 50 })).toBe(true);
  });

  it('saveSoundSettings persists ONLY a path string for presetId "file" -- never bytes/base64 -- and round-trips via readSoundSettings', () => {
    setConnection({ connectionId: 'conn-file', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) } };
    const scope = JSON.stringify(['conn-file', 'alpha']);
    const saved = saveSoundSettings(ctx, scope, { presetId: 'file', customUrl: '', customPath: 'C:\\Users\\alex\\Music\\chime.wav', volume: 42 });
    expect(saved).toEqual({ presetId: 'file', customUrl: '', customPath: 'C:\\Users\\alex\\Music\\chime.wav', volume: 42 });
    expect(readSoundSettings(ctx, scope)).toEqual(saved);
    // The persisted JSON contains only the plain path string -- no data:, no base64, no byte-length blowup.
    const storedJson = JSON.stringify(data['sound-settings-v1'][scope]);
    expect(storedJson).not.toMatch(/data:|base64/);
    expect(storedJson).toContain('chime.wav');
    expect(storedJson.length).toBeLessThan(200);
  });

  it('saveSoundSettings rejects presetId "file" with no path chosen', () => {
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
    expect(() => saveSoundSettings(ctx, 'scope-a', { presetId: 'file', customUrl: '', customPath: '', volume: 50 })).toThrow(/choose a local file/i);
  });

  it('playSoundSettings routes presetId "file" to playLocalFilePath and applies volume', () => {
    let created = null;
    const makeAudio = url => { created = { url, volume: null, play() { return Promise.resolve(); } }; return created; };
    const result = playSoundSettings({ presetId: 'file', customUrl: '', customPath: 'D:\\notify.mp3', volume: 25 }, { makeAudio });
    expect(result).toBe(true);
    expect(created.url).toBe(hermesMediaStreamUrl('D:\\notify.mp3'));
    expect(created.volume).toBeCloseTo(0.25);
  });

  it('is scoped per (connection, profile) like every other sound preset', () => {
    setConnection({ connectionId: 'conn-file2', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
    const scopeAlpha = JSON.stringify(['conn-file2', 'alpha']);
    saveSoundSettings(ctx, scopeAlpha, { presetId: 'file', customUrl: '', customPath: 'C:\\a.wav', volume: 50 });
    expect(readSoundSettings(ctx, JSON.stringify(['conn-file2', 'beta']))).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(readSoundSettings(ctx, scopeAlpha).customPath).toBe('C:\\a.wav');
  });

  it('UI: choosing "Local file..." shows a Choose-file button; picking via ctx.os.pickOpenPath stores only the path (no File object, no bytes) in ctx.storage', async () => {
    setConnection({ connectionId: 'conn-ui-file', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const pickOpenPath = async opts => { expect(opts.filters).toEqual([{ extensions: ['mp3', 'wav'], name: 'Audio' }]); return 'C:\\Users\\alex\\Music\\pick.mp3'; };
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) }, os: { pickOpenPath } };
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    await act(async () => { view.getByText('Choose file…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen local sound file path').textContent).toBe('C:\\Users\\alex\\Music\\pick.mp3');
    act(() => view.getByText('Save sound settings').click());
    const scope = JSON.stringify(['conn-ui-file', 'default']);
    expect(data['sound-settings-v1'][scope].customPath).toBe('C:\\Users\\alex\\Music\\pick.mp3');
    // No File object / blob / base64 anywhere in what got persisted.
    const storedJson = JSON.stringify(data['sound-settings-v1'][scope]);
    expect(storedJson).not.toMatch(/data:|base64/);
    cleanup();
  });

  it('UI: previewing a picked local file plays it through hermes-media:// at the configured volume', async () => {
    setConnection({ connectionId: 'conn-ui-file2', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v }, os: { pickOpenPath: async () => 'C:\\sounds\\x.wav' } };
    let createdAudio = null;
    const originalAudio = window.Audio;
    window.Audio = function (url) { createdAudio = { url, volume: null, play() { return Promise.resolve(); } }; return createdAudio; };
    try {
      const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
      fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
      await act(async () => { view.getByText('Choose file…').click(); await Promise.resolve(); await Promise.resolve(); });
      fireEvent.change(view.getByLabelText('Notification sound volume'), { target: { value: '80' } });
      act(() => { view.getByText('Preview sound').click(); });
      expect(createdAudio).not.toBeNull();
      expect(createdAudio.url).toBe('hermes-media://stream/' + encodeURIComponent('C:\\sounds\\x.wav'));
      expect(createdAudio.volume).toBeCloseTo(0.8);
      cleanup();
    } finally {
      window.Audio = originalAudio;
    }
  });

  it('UI: picking is unavailable gracefully (no throw) when ctx.os is missing on an older host', async () => {
    setConnection({ connectionId: 'conn-ui-file3', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } }; // no ctx.os
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    await act(async () => { view.getByText('Choose file…').click(); await Promise.resolve(); });
    expect(view.getByRole('status', { name: 'Sound status' }).textContent).toMatch(/unavailable/i);
    cleanup();
  });

  it('UI: cancelling the picker (resolves null) leaves the previously chosen path untouched', async () => {
    setConnection({ connectionId: 'conn-ui-file4', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let calls = 0;
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v }, os: { pickOpenPath: async () => { calls++; return calls === 1 ? 'C:\\first.mp3' : null; } } };
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    await act(async () => { view.getByText('Choose file…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen local sound file path').textContent).toBe('C:\\first.mp3');
    await act(async () => { view.getByText('Choose file…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen local sound file path').textContent).toBe('C:\\first.mp3');
    cleanup();
  });

  it('existing Custom URL field is completely unaffected: still plays http(s)/data URLs via Audio(), independent of the "file" preset', () => {
    setConnection({ connectionId: 'conn-custom-still', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'custom' } });
    expect(view.queryByLabelText('Custom sound URL (http(s) or data:)')).toBeTruthy();
    fireEvent.change(view.getByLabelText('Custom sound URL (http(s) or data:)'), { target: { value: 'https://example.com/a.mp3' } });
    act(() => view.getByText('Save sound settings').click());
    const scope = JSON.stringify(['conn-custom-still', 'default']);
    expect(data['sound-settings-v1'][scope]).toEqual({ presetId: 'custom', customUrl: 'https://example.com/a.mp3', customPath: '', volume: 50 });
    cleanup();
  });
});
