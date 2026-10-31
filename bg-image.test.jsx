import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,describe} from 'vitest';
import {ThemeProvider} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {setConnection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import plugin, {
  BG_IMAGE_EXTENSIONS, DEFAULT_BG_IMAGE_SETTINGS, clampBgOpacity, clampBgSize, validBackgroundImageSettings,
  readBackgroundImageSettings, saveBackgroundImageSettings, clearBackgroundImageSettings,
  resolveBackgroundImageDataUrl, backgroundImageCSS, BackgroundImagePage
} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); });

function ctxWith(data, extra) {
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) }, ...extra };
}

describe('Background image: path-only storage (never base64/data URLs in ctx.storage)', () => {
  it('saveBackgroundImageSettings persists ONLY a path string + integer opacity', () => {
    const data = {};
    const ctx = ctxWith(data);
    const saved = saveBackgroundImageSettings(ctx, 'scope-a', { path: 'C:\\Users\\alex\\Pictures\\wall.png', opacity: 55 });
    expect(saved).toEqual({ path: 'C:\\Users\\alex\\Pictures\\wall.png', opacity: 55, size: 50 });
    expect(readBackgroundImageSettings(ctx, 'scope-a')).toEqual(saved);
    const storedJson = JSON.stringify(data['background-image-v1']['scope-a']);
    expect(storedJson).not.toMatch(/data:|base64/);
    expect(storedJson).toContain('wall.png');
    expect(storedJson.length).toBeLessThan(200);
  });

  it('rejects a path longer than 1000 chars and non-integer opacity shapes gracefully (clamped, never thrown for opacity)', () => {
    const ctx = ctxWith({});
    const longPath = 'C:\\' + 'a'.repeat(1001) + '.png';
    expect(() => saveBackgroundImageSettings(ctx, 'scope-a', { path: longPath, opacity: 50 })).toThrow(/invalid/i);
    // opacity is clamped, not rejected, for out-of-range or non-numeric input.
    expect(saveBackgroundImageSettings(ctx, 'scope-b', { path: 'C:\\a.png', opacity: 500 }).opacity).toBe(100);
    expect(saveBackgroundImageSettings(ctx, 'scope-c', { path: 'C:\\a.png', opacity: -5 }).opacity).toBe(0);
    expect(saveBackgroundImageSettings(ctx, 'scope-d', { path: 'C:\\a.png', opacity: 'nonsense' }).opacity).toBe(40);
  });

  it('validBackgroundImageSettings validates shape independent of storage', () => {
    expect(validBackgroundImageSettings({ path: '', opacity: 0 })).toBe(true);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 100 })).toBe(true);
    expect(validBackgroundImageSettings({ path: 1, opacity: 50 })).toBe(false);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 1.5 })).toBe(false);
    expect(validBackgroundImageSettings(null)).toBe(false);
  });

  it('validBackgroundImageSettings: size is optional (back-compat with pre-size entries) but validated when present', () => {
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50 })).toBe(true); // no size key at all -> still valid
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50, size: 50 })).toBe(true);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50, size: 10 })).toBe(true);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50, size: 100 })).toBe(true);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50, size: 9 })).toBe(false);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50, size: 101 })).toBe(false);
    expect(validBackgroundImageSettings({ path: 'a.png', opacity: 50, size: 50.5 })).toBe(false);
  });

  it('clampBgSize clamps to [10,100] integers and falls back to 50 for non-numeric input', () => {
    expect(clampBgSize(50)).toBe(50);
    expect(clampBgSize(5)).toBe(10);
    expect(clampBgSize(500)).toBe(100);
    expect(clampBgSize('abc')).toBe(50);
    expect(clampBgSize(undefined)).toBe(50);
    expect(clampBgSize(33.6)).toBe(34);
  });

  it('saveBackgroundImageSettings defaults size to 50 when not provided, and clamps when given', () => {
    const ctx = ctxWith({});
    expect(saveBackgroundImageSettings(ctx, 'scope-sz1', { path: 'C:\\a.png', opacity: 50 }).size).toBe(50);
    expect(saveBackgroundImageSettings(ctx, 'scope-sz2', { path: 'C:\\a.png', opacity: 50, size: 5 }).size).toBe(10);
    expect(saveBackgroundImageSettings(ctx, 'scope-sz3', { path: 'C:\\a.png', opacity: 50, size: 90 }).size).toBe(90);
  });

  it('readBackgroundImageSettings back-fills size:50 for entries saved before the size feature existed', () => {
    const data = { 'background-image-v1': { 'legacy-scope': { path: 'C:\\old.png', opacity: 70 } } };
    const ctx = ctxWith(data);
    expect(readBackgroundImageSettings(ctx, 'legacy-scope')).toEqual({ path: 'C:\\old.png', opacity: 70, size: 50 });
  });

  it('BG_IMAGE_EXTENSIONS covers png/jpg/jpeg/gif/webp (the picker filter)', () => {
    expect(BG_IMAGE_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  });
});

describe('Background image: opacity application at multiple values', () => {
  it('backgroundImageCSS maps opacity percent to a 0..1 CSS opacity, injecting the data URL as a background-image', () => {
    const css0 = backgroundImageCSS('data:image/png;base64,AAA=', 0);
    expect(css0).toBe(''); // fully transparent == no override at all
    const css50 = backgroundImageCSS('data:image/png;base64,AAA=', 50);
    expect(css50).toContain('opacity: 0.5');
    expect(css50).toContain('data:image/png;base64,AAA=');
    expect(css50).toContain('[data-chat-surface]');
    const css100 = backgroundImageCSS('data:image/png;base64,AAA=', 100);
    expect(css100).toContain('opacity: 1');
  });

  it('REGRESSION: backgroundImageCSS is NOT gated by :not([data-hermes-glass]) -- the image must render in glass mode too, unlike the plain chatBackground color override', () => {
    const css = backgroundImageCSS('data:image/png;base64,AAA=', 50);
    expect(css).not.toContain(':not([data-hermes-glass])');
    expect(css).not.toContain('[data-hermes-glass]');
    // Selector applies unconditionally under :root, both in and out of glass mode.
    expect(css).toMatch(/:root \[data-chat-surface\]/);
  });

  it('backgroundImageCSS returns empty string when there is no data URL at all', () => {
    expect(backgroundImageCSS(null, 60)).toBe('');
    expect(backgroundImageCSS('', 60)).toBe('');
  });

  it('backgroundImageCSS centers the image and disables tiling/stretch instead of covering the surface', () => {
    const css = backgroundImageCSS('data:image/png;base64,AAA=', 50, 50);
    expect(css).toContain('background-position: center');
    expect(css).toContain('background-repeat: no-repeat');
    expect(css).not.toContain('background-size: cover');
  });

  it('backgroundImageCSS defaults to a 50% size when no size argument is given at all (back-compat call sites)', () => {
    const css = backgroundImageCSS('data:image/png;base64,AAA=', 50);
    expect(css).toContain('background-size: 50% auto');
  });

  it('backgroundImageCSS honors an explicit size percentage, clamped to [10,100]', () => {
    expect(backgroundImageCSS('data:image/png;base64,AAA=', 50, 75)).toContain('background-size: 75% auto');
    expect(backgroundImageCSS('data:image/png;base64,AAA=', 50, 5)).toContain('background-size: 10% auto');
    expect(backgroundImageCSS('data:image/png;base64,AAA=', 50, 500)).toContain('background-size: 100% auto');
  });

  it('clampBgOpacity clamps to [0,100] integers and falls back to 40 for non-numeric input', () => {
    expect(clampBgOpacity(50)).toBe(50);
    expect(clampBgOpacity(150)).toBe(100);
    expect(clampBgOpacity(-10)).toBe(0);
    expect(clampBgOpacity('abc')).toBe(40);
    expect(clampBgOpacity(33.6)).toBe(34);
  });
});

describe('Background image: resolveBackgroundImageDataUrl (transient preview/CSS resolution, never persisted)', () => {
  it('resolves a data: URL via the injected reader', async () => {
    const reader = async p => { expect(p).toBe('C:\\a.png'); return 'data:image/png;base64,ZZZ='; };
    expect(await resolveBackgroundImageDataUrl('C:\\a.png', reader)).toBe('data:image/png;base64,ZZZ=');
  });
  it('returns null for an empty path without calling the reader', async () => {
    let called = false;
    await resolveBackgroundImageDataUrl('', async () => { called = true; return 'data:x'; });
    expect(called).toBe(false);
  });
  it('returns null (never throws) when the reader rejects or returns a non-string/error object', async () => {
    expect(await resolveBackgroundImageDataUrl('C:\\a.png', async () => { throw Error('ENOENT'); })).toBeNull();
    expect(await resolveBackgroundImageDataUrl('C:\\a.png', async () => ({ ok: false, error: 'missing' }))).toBeNull();
  });
  it('returns null (no throw) when no reader is available at all (older/non-Electron host)', async () => {
    expect(await resolveBackgroundImageDataUrl('C:\\a.png', undefined)).toBeNull();
  });
});

describe('Background image: per-profile scoping', () => {
  it('a saved image for one (connection, profile) scope does not leak into another', () => {
    const ctx = ctxWith({});
    saveBackgroundImageSettings(ctx, JSON.stringify(['conn1', 'alpha']), { path: 'C:\\alpha.png', opacity: 70 });
    expect(readBackgroundImageSettings(ctx, JSON.stringify(['conn1', 'beta']))).toEqual(DEFAULT_BG_IMAGE_SETTINGS);
    expect(readBackgroundImageSettings(ctx, JSON.stringify(['conn1', 'alpha'])).path).toBe('C:\\alpha.png');
  });

  it('UI: BackgroundImagePage reads/writes the scope derived from the active connection+profile', async () => {
    setConnection({ connectionId: 'conn-bg', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const pickOpenPath = async opts => { expect(opts.filters).toEqual([{ extensions: BG_IMAGE_EXTENSIONS, name: 'Images' }]); return 'C:\\pics\\wall.jpg'; };
    const ctx = ctxWith(data, { os: { pickOpenPath } });
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\pics\\wall.jpg');
    act(() => view.getByText('Save background image').click());
    const scope = JSON.stringify(['conn-bg', 'alpha']);
    expect(data['background-image-v1'][scope].path).toBe('C:\\pics\\wall.jpg');
    cleanup();
  });

  it('UI: a Size slider exists alongside Opacity, defaults to 50%, and is adjustable and savable', async () => {
    setConnection({ connectionId: 'conn-size', mode: 'remote', profile: 'alpha' });
    $activeGatewayProfile.set('alpha');
    const data = {};
    const ctx = ctxWith(data);
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    expect(view.getByText('Size: 50%')).toBeTruthy();
    const slider = view.getByLabelText('Background image size');
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('100');
    expect(slider.value).toBe('50');
    fireEvent.change(slider, { target: { value: '80' } });
    expect(view.getByText('Size: 80%')).toBeTruthy();
    act(() => view.getByText('Save background image').click());
    const scope = JSON.stringify(['conn-size', 'alpha']);
    expect(data['background-image-v1'][scope].size).toBe(80);
    cleanup();
  });
});

describe('Background image: picker cancel leaves the prior image untouched', () => {
  it('cancelling (pickOpenPath resolves null) keeps the previously chosen path shown and saved value unchanged', async () => {
    setConnection({ connectionId: 'conn-cancel', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = {};
    let calls = 0;
    const ctx = ctxWith(data, { os: { pickOpenPath: async () => { calls++; return calls === 1 ? 'C:\\first.png' : null; } } });
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\first.png');
    act(() => view.getByText('Save background image').click());
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); await Promise.resolve(); });
    // Second pick cancelled (null) -- the path shown must still be the first one.
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\first.png');
    const scope = JSON.stringify(['conn-cancel', 'default']);
    expect(data['background-image-v1'][scope].path).toBe('C:\\first.png');
    cleanup();
  });

  it('UI: picking is unavailable gracefully (no throw) when ctx.os is missing on an older host', async () => {
    setConnection({ connectionId: 'conn-noos', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const ctx = ctxWith({});
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); });
    expect(view.getByRole('status', { name: 'Background image status' }).textContent).toMatch(/unavailable/i);
    cleanup();
  });
});

describe('Background image: clear/reset removes the override cleanly', () => {
  it('clearBackgroundImageSettings resets stored settings to the default (empty path)', () => {
    const ctx = ctxWith({});
    saveBackgroundImageSettings(ctx, 'scope-x', { path: 'C:\\a.png', opacity: 80 });
    const cleared = clearBackgroundImageSettings(ctx, 'scope-x');
    expect(cleared).toEqual(DEFAULT_BG_IMAGE_SETTINGS);
    expect(readBackgroundImageSettings(ctx, 'scope-x')).toEqual(DEFAULT_BG_IMAGE_SETTINGS);
  });

  it('backgroundImageCSS for an empty/no path produces no override at all (no stray style text)', () => {
    expect(backgroundImageCSS('', 50)).toBe('');
    expect(backgroundImageCSS(null, 50)).toBe('');
  });

  it('UI: clicking Clear removes the path, resets opacity, and persists the cleared state', async () => {
    setConnection({ connectionId: 'conn-clear', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = { 'background-image-v1': { [JSON.stringify(['conn-clear', 'default'])]: { path: 'C:\\old.png', opacity: 90 } } };
    const ctx = ctxWith(data);
    const events = new EventTarget();
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\old.png');
    act(() => view.getByText('Clear background image').click());
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('No image chosen.');
    const scope = JSON.stringify(['conn-clear', 'default']);
    expect(data['background-image-v1'][scope]).toEqual(DEFAULT_BG_IMAGE_SETTINGS);
    cleanup();
  });

  it('UI: an injected "change" event listener (as BgImageStyle uses) sees an empty-CSS state after Clear', async () => {
    setConnection({ connectionId: 'conn-clear2', mode: 'remote', profile: 'default' });
    $activeGatewayProfile.set('default');
    const data = { 'background-image-v1': { [JSON.stringify(['conn-clear2', 'default'])]: { path: 'C:\\old.png', opacity: 90 } } };
    const ctx = ctxWith(data);
    const events = new EventTarget();
    let changeCount = 0;
    events.addEventListener('change', () => { changeCount++; });
    const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
    act(() => view.getByText('Clear background image').click());
    expect(changeCount).toBe(1);
    const scope = JSON.stringify(['conn-clear2', 'default']);
    expect(readBackgroundImageSettings(ctx, scope).path).toBe('');
    cleanup();
  });
});
