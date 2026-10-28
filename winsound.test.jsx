import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,describe} from 'vitest';
import {ThemeProvider} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {setConnection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import {
  SOUND_PRESETS, WINDOWS_SOUND_PRESETS, WINDOWS_MEDIA_DIR, windowsSoundPath,
  hermesMediaStreamUrl, windowsSoundMediaUrl, playWindowsSoundPreset, playSoundSettings,
  validSoundSettings, saveSoundSettings, readSoundSettings, handleSoundCompletionEvent, SoundPage
} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); });

describe('Windows system sound presets', () => {
  it('enumerates 70 real Windows\\Media filenames, each as a distinct win: preset with no duplicate ids', () => {
    expect(WINDOWS_SOUND_PRESETS.length).toBe(70);
    const ids = WINDOWS_SOUND_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of WINDOWS_SOUND_PRESETS) {
      expect(p.id).toBe('win:' + p.file);
      expect(p.file.toLowerCase().endsWith('.wav')).toBe(true);
      expect(windowsSoundPath(p.file)).toBe(WINDOWS_MEDIA_DIR + p.file);
    }
    // Spot-check a few concrete filenames actually enumerated from the machine.
    expect(ids).toContain('win:Windows Notify.wav');
    expect(ids).toContain('win:notify.wav');
    expect(ids).toContain('win:ding.wav');
    expect(ids).toContain('win:Windows Ding.wav');
    expect(ids).toContain('win:tada.wav');
    expect(ids).toContain('win:chimes.wav');
    expect(ids).toContain('win:Ring05.wav');
    expect(ids).toContain('win:Alarm01.wav');
  });

  it('Windows preset ids are accepted by validSoundSettings; a stray win: id is not', () => {
    expect(validSoundSettings({ presetId: 'win:tada.wav', customUrl: '', customPath: '', volume: 50 })).toBe(true);
    expect(validSoundSettings({ presetId: 'win:not-a-real-file.wav', customUrl: '', customPath: '', volume: 50 })).toBe(false);
  });

  it('hermesMediaStreamUrl encodes the colon and backslashes in a Windows path (hermes-media://stream/<encodeURIComponent(path)>)', () => {
    // Matches apps/desktop/src/lib/media.ts:296 mediaStreamUrl's exact scheme+host+encoding,
    // and the literal fixture asserted in media.remote.test.ts.
    const path = 'C:' + String.fromCharCode(92) + 'renders' + String.fromCharCode(92) + 'demo.mp4';
    expect(hermesMediaStreamUrl(path)).toBe('hermes-media://stream/C%3A%5Crenders%5Cdemo.mp4');
  });

  it('windowsSoundMediaUrl builds the hermes-media:// URL for the real C:\\Windows\\Media path, correctly percent-encoding spaces and the drive colon', () => {
    const url = windowsSoundMediaUrl('tada.wav');
    expect(url).toBe('hermes-media://stream/' + encodeURIComponent('C:\\Windows\\Media\\tada.wav'));
    // Spot check actual percent-encoding characters present.
    expect(url).toContain('C%3A%5CWindows%5CMedia%5Ctada.wav');
    const spaced = windowsSoundMediaUrl('Windows Notify.wav');
    expect(spaced).toBe('hermes-media://stream/' + encodeURIComponent('C:\\Windows\\Media\\Windows Notify.wav'));
    expect(spaced).toContain('Windows%20Notify.wav');
  });

  it('playWindowsSoundPreset plays the hermes-media:// URL synchronously (no IPC round trip) through an injected Audio element at the clamped volume', () => {
    let created = null;
    const fakeMakeAudio = url => { created = { url, volume: null, played: false, play() { this.played = true; return Promise.resolve(); } }; return created; };
    const played = playWindowsSoundPreset('notify2.wav', 65, { makeAudio: fakeMakeAudio });
    expect(played).toBe(true);
    expect(created.url).toBe('hermes-media://stream/' + encodeURIComponent('C:\\Windows\\Media\\notify2.wav'));
    expect(created.volume).toBeCloseTo(0.65);
    expect(created.played).toBe(true);
  });

  it('playWindowsSoundPreset is silent at volume 0 and creates no Audio element', () => {
    let calledMakeAudio = false;
    const played = playWindowsSoundPreset('tada.wav', 0, { makeAudio: () => { calledMakeAudio = true; return { play() { return Promise.resolve(); } }; } });
    expect(played).toBe(false);
    expect(calledMakeAudio).toBe(false);
  });

  it('playWindowsSoundPreset returns false for an empty file, never throws', () => {
    expect(playWindowsSoundPreset('', 50, {})).toBe(false);
    expect(playWindowsSoundPreset(null, 50, {})).toBe(false);
  });

  it('playSoundSettings dispatches a win: presetId through the hermes-media:// path and returns a plain boolean (no longer a Promise)', () => {
    let created = null;
    const fakeMakeAudio = url => { created = { url, volume: null, play() { return Promise.resolve(); } }; return created; };
    const result = playSoundSettings(
      { presetId: 'win:chimes.wav', customUrl: '', customPath: '', volume: 40 },
      { makeAudio: fakeMakeAudio }
    );
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
    expect(created.url).toBe('hermes-media://stream/' + encodeURIComponent('C:\\Windows\\Media\\chimes.wav'));
    expect(created.volume).toBeCloseTo(0.4);
  });

  it('existing synthesized-preset, custom-URL, and None paths are unaffected and still return a plain boolean', () => {
    expect(playSoundSettings({ presetId: 'none', customUrl: '', customPath: '', volume: 80 })).toBe(false);
    const ac = { currentTime: 0, destination: {}, createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }, createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; } };
    expect(playSoundSettings({ presetId: 'chime', customUrl: '', customPath: '', volume: 50 }, { audioContext: ac })).toBe(true);
    let played = false;
    const r = playSoundSettings({ presetId: 'custom', customUrl: 'https://example.com/a.mp3', customPath: '', volume: 50 }, { makeAudio: () => ({ play() { played = true; return Promise.resolve(); } }) });
    expect(r).toBe(true);
    expect(played).toBe(true);
    // SOUND_PRESETS (the original 5 synthesized chimes) is untouched.
    expect(SOUND_PRESETS.length).toBe(5);
  });

  it('is scoped per (connection, profile) exactly like every other sound preset, with no persisted audio blob and no bytes -- just the tiny filename', () => {
    setConnection({ connectionId: 'conn-win', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) } };
    const saved = saveSoundSettings(ctx, JSON.stringify(['conn-win', 'alpha']), { presetId: 'win:ding.wav', customUrl: '', customPath: '', volume: 55 });
    expect(saved).toEqual({ presetId: 'win:ding.wav', customUrl: '', customPath: '', volume: 55 });
    // Only the tiny filename-bearing presetId is persisted — never any audio bytes/data URL.
    const storedJson = JSON.stringify(data['sound-settings-v1']);
    expect(storedJson).not.toMatch(/^data:|base64/);
    expect(storedJson.length).toBeLessThan(200);
    expect(readSoundSettings(ctx, JSON.stringify(['conn-win', 'beta']))).not.toEqual(saved);
  });

  it('handleSoundCompletionEvent does not throw for a configured Windows-preset profile', () => {
    setConnection({ connectionId: 'conn-win2', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const scope = JSON.stringify(['conn-win2', 'alpha']);
    const data = { 'sound-settings-v1': { [scope]: { presetId: 'win:tada.wav', customUrl: '', customPath: '', volume: 50 } } };
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
    expect(() => handleSoundCompletionEvent(ctx, { type: 'message.complete', profile: 'alpha' })).not.toThrow();
  });

  it('the preset dropdown lists all 70 Windows sounds in an optgroup alongside the untouched synthesized/custom/none/file options', () => {
    setConnection({ connectionId: 'conn-ui', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    const select = view.getByLabelText('Notification sound preset');
    const optionValues = Array.from(select.querySelectorAll('option')).map(o => o.value);
    const winOptionValues = Array.from(select.querySelectorAll('optgroup option')).map(o => o.value);
    expect(optionValues).toContain('none');
    expect(optionValues).toContain('chime');
    expect(optionValues).toContain('custom');
    expect(optionValues).toContain('file');
    expect(winOptionValues.length).toBe(70);
    expect(winOptionValues).toContain('win:tada.wav');
    fireEvent.change(select, { target: { value: 'win:tada.wav' } });
    expect(select.value).toBe('win:tada.wav');
    cleanup();
  });

  it('selecting and previewing a Windows preset plays synchronously through hermes-media:// (no async readFileDataUrl bridge)', () => {
    let createdAudio = null;
    const originalAudio = window.Audio;
    window.Audio = function (url) { createdAudio = { url, volume: null, play() { return Promise.resolve(); } }; return createdAudio; };
    try {
      setConnection({ connectionId: 'conn-prev', mode: 'remote', profile: 'default' });
      $activeGatewayProfile.set('default');
      const data = {};
      const ctx = { storage: { get: (k, f) => data[k] ?? f, set: (k, v) => data[k] = v } };
      const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
      fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'win:Windows Startup.wav' } });
      fireEvent.change(view.getByLabelText('Notification sound volume'), { target: { value: '60' } });
      act(() => { view.getByText('Preview sound').click(); });
      expect(createdAudio).not.toBeNull();
      expect(createdAudio.url).toBe('hermes-media://stream/' + encodeURIComponent('C:\\Windows\\Media\\Windows Startup.wav'));
      expect(createdAudio.volume).toBeCloseTo(0.6);
      expect(view.getByRole('status', { name: 'Sound status' }).textContent).toMatch(/playing preview/i);
      cleanup();
    } finally {
      window.Audio = originalAudio;
    }
  });
});
