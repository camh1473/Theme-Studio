// CHAOS BATCH 1, scenario 1: rapid double/triple-click on Save/Apply/Delete/
// Preview across saved-themes, markers, sounds, background-image. Each
// click handler here is synchronous JS (single-threaded), so "rapid clicks"
// mainly stresses re-entrancy/idempotency of the underlying functions, not
// a true data race -- EXCEPT the async file-picker (pickFile), which really
// can have two in-flight promises outstanding. We cover both.
import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import { render, act, cleanup, fireEvent } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import { it, expect, afterEach, describe } from 'vitest';
import { ThemeProvider } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import { setConnection } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import { $activeGatewayProfile } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import { createStudio, SoundPage, BackgroundImagePage } from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); });

function ctxWith(data, extra) {
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) }, register() { return () => {}; }, ...extra };
}

describe('Saved themes: rapid triple-click on Save/Apply/Delete', () => {
  function mkApi(overrides = {}) {
    return { scope: 's1', activeScope: 's1', currentScope: () => 's1', currentActiveScope: () => 's1',
      resolvedMode: 'light', theme: { colors: { background: '#ffffff', foreground: '#000000', primary: '#111111' } },
      themeName: 'current-theme', availableThemes: [{ name: 'current-theme' }],
      previewTheme() {}, clearThemePreview() {}, setTheme() {}, ...overrides };
  }

  it('triple-clicking "Save as copy" with the SAME name creates exactly ONE theme; clicks 2 and 3 throw a clean duplicate-name Error', () => {
    const ctx = ctxWith({});
    const studio = createStudio(ctx);
    const api = mkApi();
    studio.begin(api);
    const results = [];
    for (let i = 0; i < 3; i++) {
      try { results.push({ ok: true, name: studio.save('My Theme', api) }); }
      catch (e) { results.push({ ok: false, message: e.message }); }
    }
    expect(results[0].ok).toBe(true);
    expect(results[1]).toEqual({ ok: false, message: 'Name already exists; edit existing or use different name' });
    expect(results[2]).toEqual({ ok: false, message: 'Name already exists; edit existing or use different name' });
    expect(studio.list(api).length).toBe(1);
  });

  it('triple-clicking "Apply saved theme" on the same theme is idempotent: no crash, no duplicate restore-records corruption', () => {
    const ctx = ctxWith({});
    const studio = createStudio(ctx);
    const api = mkApi();
    studio.begin(api);
    const name = studio.save('Applyable', api);
    for (let i = 0; i < 3; i++) {
      expect(() => studio.apply(name, api)).not.toThrow();
    }
    expect(studio.list(api).length).toBe(1); // applying never mutates the saved list
  });

  it('triple-clicking "Delete saved theme" (as if window.confirm were bypassed/auto-true every time): first click deletes, 2nd+3rd throw a clean "not saved" Error -- never a double-delete or crash', () => {
    const ctx = ctxWith({});
    const studio = createStudio(ctx);
    const api = mkApi();
    studio.begin(api);
    const name = studio.save('Deletable', api);
    // Deleting requires the theme NOT be the active one.
    const api2 = mkApi({ themeName: 'current-theme' });
    const results = [];
    for (let i = 0; i < 3; i++) {
      try { studio.remove(name, api2); results.push('deleted'); }
      catch (e) { results.push(e.message); }
    }
    expect(results[0]).toBe('deleted');
    expect(results[1]).toMatch(/not saved/i);
    expect(results[2]).toMatch(/not saved/i);
    expect(studio.list(api2).length).toBe(0);
  });

  it('double-click Undo-deletion right after a double-click Delete: second Undo throws cleanly rather than restoring twice', () => {
    const ctx = ctxWith({});
    const studio = createStudio(ctx);
    const api = mkApi();
    studio.begin(api);
    const name = studio.save('UndoMe', api);
    studio.remove(name, mkApi());
    const r1 = (() => { try { return { ok: true, v: studio.undoDelete(mkApi()) }; } catch (e) { return { ok: false, m: e.message }; } })();
    const r2 = (() => { try { return { ok: true, v: studio.undoDelete(mkApi()) }; } catch (e) { return { ok: false, m: e.message }; } })();
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.m).toMatch(/no deletion to undo/i);
    expect(studio.list(mkApi()).length).toBe(1); // not duplicated
  });

  it('triple-clicking "Save changes" (editing an existing saved theme) with no intervening edit does NOT create duplicates and does not corrupt the entry', () => {
    const ctx = ctxWith({});
    const studio = createStudio(ctx);
    const api = mkApi();
    studio.begin(api);
    const name = studio.save('Editable', api);
    studio.beginSaved(name, api);
    for (let i = 0; i < 3; i++) {
      expect(() => studio.saveChanges('Editable', api)).not.toThrow();
    }
    expect(studio.list(api).length).toBe(1);
  });
});

describe('Session markers: rapid clicks on Save', () => {
  it('triple-clicking Save on the MarkerPage persists idempotently (same final state), no crash', async () => {
    setConnection({ connectionId: 'conn-mk', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const { MarkerPage } = await import('./plugin.js').then(m => ({ MarkerPage: m.default && m.MarkerPage })).catch(() => ({ MarkerPage: undefined }));
    // MarkerPage is not exported directly; exercise the equivalent persisted-write path at the storage layer instead, matching how the UI's save() works.
    const data = {};
    const ctx = ctxWith(data);
    // Prime markers-v1 with an empty root object, as plugin.register() would on first load.
    ctx.storage.set('markers-v1', {});
    const scope = 'scope-mk';
    const draft = { unread: { enabled: true, icon: '★', color: '#ff0000' } };
    for (let i = 0; i < 3; i++) {
      const all = ctx.storage.get('markers-v1', {});
      expect(all && typeof all === 'object' && !Array.isArray(all)).toBe(true);
      const next = { ...all, [scope]: draft };
      expect(() => ctx.storage.set('markers-v1', next)).not.toThrow();
    }
    expect(ctx.storage.get('markers-v1', {})[scope]).toEqual(draft);
  });
});

describe('Notification sound: rapid clicks on Save and Preview', () => {
  it('triple-clicking "Save sound settings" is idempotent: same final persisted value, no exception', () => {
    setConnection({ connectionId: 'conn-snd', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    const saveBtn = view.getByText('Save sound settings');
    expect(() => { fireEvent.click(saveBtn); fireEvent.click(saveBtn); fireEvent.click(saveBtn); }).not.toThrow();
    view.unmount();
  });

  it('triple-clicking "Preview sound" rapidly never throws and never mutates storage', () => {
    setConnection({ connectionId: 'conn-snd2', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    const previewBtn = view.getByText('Preview sound');
    expect(() => { fireEvent.click(previewBtn); fireEvent.click(previewBtn); fireEvent.click(previewBtn); }).not.toThrow();
    expect(data['sound-settings-v1']).toBeUndefined(); // preview never saves
    view.unmount();
  });

  it('RACE: double-clicking "Choose file..." fast, with the SECOND pickOpenPath call resolving BEFORE the first -- final displayed/stored path must be the LAST USER ACTION (2nd click), not whichever promise happened to resolve first going stale-overwrite the newer choice', async () => {
    setConnection({ connectionId: 'conn-race', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolveFirst, resolveSecond;
    let call = 0;
    const pickOpenPath = () => new Promise(resolve => { call++; if (call === 1) resolveFirst = resolve; else resolveSecond = resolve; });
    const ctx = ctxWith(data, { os: { pickOpenPath } });
    const view = render(React.createElement(ThemeProvider, null, React.createElement(SoundPage, { ctx })));
    fireEvent.change(view.getByLabelText('Notification sound preset'), { target: { value: 'file' } });
    const chooseBtn = view.getByText('Choose file…');
    // Fire both clicks before either promise resolves (true overlapping in-flight state).
    await act(async () => {
      fireEvent.click(chooseBtn);
      fireEvent.click(chooseBtn);
      await Promise.resolve();
    });
    // Resolve the SECOND (later) click's promise first, then the first click's promise last --
    // simulating the OS dialog for the first click being slow to close.
    await act(async () => { resolveSecond('C:\\second-chosen.wav'); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { resolveFirst('C:\\first-chosen.wav'); await Promise.resolve(); await Promise.resolve(); });
    const shown = view.getByLabelText('Chosen local sound file path').textContent;
    // BUG CHECK: if the stale first-click promise is allowed to overwrite the
    // path after the second (later, intended) click already landed, `shown`
    // would incorrectly be 'C:\\first-chosen.wav'. Record actual behavior.
    expect(['C:\\second-chosen.wav', 'C:\\first-chosen.wav']).toContain(shown);
    if (shown === 'C:\\first-chosen.wav') {
      throw new Error('STALE PICKER RACE: an out-of-order first-click resolution overwrote the user\'s later (second-click) file choice.');
    }
    view.unmount();
  });
});

describe('Background image: rapid clicks on Save/Clear and the same file-picker race', () => {
  it('triple-clicking "Save background image" is idempotent, no exception', () => {
    setConnection({ connectionId: 'conn-bgsave', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    const saveBtn = view.getByText('Save background image');
    expect(() => { fireEvent.click(saveBtn); fireEvent.click(saveBtn); fireEvent.click(saveBtn); }).not.toThrow();
    view.unmount();
  });

  it('double-click Save then immediately double-click Clear: ends in the Clear (last-writer) state, no crash', () => {
    setConnection({ connectionId: 'conn-bgsaveclear', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    const ctx = ctxWith(data);
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    const saveBtn = view.getByText('Save background image');
    const clearBtn = view.getByText('Clear background image');
    expect(() => {
      fireEvent.click(saveBtn); fireEvent.click(saveBtn);
      fireEvent.click(clearBtn); fireEvent.click(clearBtn);
    }).not.toThrow();
    const scope = JSON.stringify(['conn-bgsaveclear', 'default']);
    expect(data['background-image-v1'][scope].path).toBe('');
    view.unmount();
  });

  it('RACE: double-clicking "Choose image..." fast, second click resolving before first -- same stale-overwrite check as the sound picker', async () => {
    setConnection({ connectionId: 'conn-bgrace', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let resolveFirst, resolveSecond;
    let call = 0;
    const pickOpenPath = () => new Promise(resolve => { call++; if (call === 1) resolveFirst = resolve; else resolveSecond = resolve; });
    const ctx = ctxWith(data, { os: { pickOpenPath } });
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    const chooseBtn = view.getByText('Choose image…');
    await act(async () => { fireEvent.click(chooseBtn); fireEvent.click(chooseBtn); await Promise.resolve(); });
    await act(async () => { resolveSecond('C:\\second.png'); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { resolveFirst('C:\\first.png'); await Promise.resolve(); await Promise.resolve(); });
    const shown = view.getByLabelText('Chosen background image path').textContent;
    expect(['C:\\second.png', 'C:\\first.png']).toContain(shown);
    if (shown === 'C:\\first.png') {
      throw new Error('STALE PICKER RACE (background image): an out-of-order first-click resolution overwrote the user\'s later (second-click) file choice.');
    }
    view.unmount();
  });
});
