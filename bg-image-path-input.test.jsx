import React from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/react/index.js';
import {render,act,cleanup,fireEvent} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import {it,expect,afterEach,describe} from 'vitest';
import {ThemeProvider} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/themes/context.tsx';
import {setConnection} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/session.ts';
import {$activeGatewayProfile} from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/store/profile.ts';
import plugin, {
  BG_IMAGE_EXTENSIONS, DEFAULT_BG_IMAGE_SETTINGS, BackgroundImagePage
} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); setConnection(null); });

function ctxWith(data, extra) {
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) }, ...extra };
}

function mountPage(connectionId, profile, data, extraCtx) {
  setConnection({ connectionId, mode: 'remote', profile });
  $activeGatewayProfile.set(profile);
  const ctx = ctxWith(data, extraCtx);
  const events = new EventTarget();
  const view = render(React.createElement(ThemeProvider, null, React.createElement(BackgroundImagePage, { ctx, events })));
  return { ctx, events, view };
}

describe('Background image: manual path text field (typed/pasted alongside the picker)', () => {
  it('UI: a path text input exists, pre-filled with the current path', async () => {
    const data = { 'background-image-v1': { [JSON.stringify(['conn-p1', 'default'])]: { path: 'C:\\pre.png', opacity: 50, size: 50 } } };
    const { view } = mountPage('conn-p1', 'default', data);
    const input = view.getByLabelText('Background image file path');
    expect(input.value).toBe('C:\\pre.png');
    cleanup();
  });

  it('typing a path then pressing Enter resolves the preview the same way a picker-selected path does', async () => {
    let reads = [];
    // Patch the real bridge used by resolveBackgroundImageDataUrl via window.hermesDesktop.
    window.hermesDesktop = { readFileDataUrl: async p => { reads.push(p); return 'data:image/png;base64,TYPED='; } };
    const data = {};
    const { view } = mountPage('conn-p2', 'default', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\typed\\pic.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\typed\\pic.png');
    const img = view.getByAltText('Background image preview');
    expect(img.src).toContain('data:image/png;base64,TYPED=');
    expect(reads).toEqual(['C:\\typed\\pic.png']);
    delete window.hermesDesktop;
    cleanup();
  });

  it('typing a path then blurring (no Enter) also commits and resolves the preview', async () => {
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,BLUR=' };
    const data = {};
    const { view } = mountPage('conn-p3', 'default', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\blurred.png' } });
      fireEvent.blur(input);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\blurred.png');
    expect(view.getByAltText('Background image preview').src).toContain('BLUR=');
    delete window.hermesDesktop;
    cleanup();
  });

  it('an invalid/unreadable typed path shows a clear error state without crashing or showing a stale preview', async () => {
    window.hermesDesktop = { readFileDataUrl: async () => { throw Error('ENOENT: no such file'); } };
    const data = {};
    const { view } = mountPage('conn-p4', 'default', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\does\\not\\exist.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\does\\not\\exist.png');
    expect(() => view.getByAltText('Background image preview')).toThrow();
    expect(view.getByLabelText('Background image path error').textContent).toMatch(/could not load/i);
    delete window.hermesDesktop;
    cleanup();
  });

  it('no error is shown for the initial empty/no-path state (distinct from a failed resolve)', async () => {
    const data = {};
    const { view } = mountPage('conn-p5', 'default', data);
    expect(() => view.getByLabelText('Background image path error')).toThrow();
    expect(() => view.getByAltText('Background image preview')).toThrow();
    cleanup();
  });

  it('clearing the text field back to empty and committing removes the error/preview without crashing', async () => {
    window.hermesDesktop = { readFileDataUrl: async (p) => p ? Promise.reject(Error('missing')) : null };
    const data = {};
    const { view } = mountPage('conn-p5b', 'default', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\missing.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(view.getByLabelText('Background image path error')).toBeTruthy();
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve();
    });
    expect(() => view.getByLabelText('Background image path error')).toThrow();
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('No image chosen.');
    delete window.hermesDesktop;
    cleanup();
  });

  it('the picker still works exactly as before AND updates the text field to match the picked path', async () => {
    const data = {};
    const pickOpenPath = async opts => { expect(opts.filters).toEqual([{ extensions: BG_IMAGE_EXTENSIONS, name: 'Images' }]); return 'C:\\picked\\wall.jpg'; };
    const { view } = mountPage('conn-p6', 'default', data, { os: { pickOpenPath } });
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\picked\\wall.jpg');
    // The manual text field must now mirror the picker's result too.
    const input = view.getByLabelText('Background image file path');
    expect(input.value).toBe('C:\\picked\\wall.jpg');
    cleanup();
  });

  it('typing into the field then using the picker afterward: the picker result wins and the field updates again', async () => {
    const data = {};
    const pickOpenPath = async () => 'C:\\from-picker.png';
    const { view } = mountPage('conn-p7', 'default', data, { os: { pickOpenPath } });
    const input = view.getByLabelText('Background image file path');
    fireEvent.change(input, { target: { value: 'C:\\typed-but-not-committed.png' } });
    // Note: NOT blurred/committed yet -- still just local pathText.
    await act(async () => { view.getByText('Choose image…').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('C:\\from-picker.png');
    expect(input.value).toBe('C:\\from-picker.png');
    cleanup();
  });

  it('debounce/commit behavior: typing many characters with no blur/Enter never calls the resolver, only the final committed value does', async () => {
    let calls = 0;
    window.hermesDesktop = { readFileDataUrl: async () => { calls++; return 'data:image/png;base64,X='; } };
    const data = {};
    const { view } = mountPage('conn-p8', 'default', data);
    const input = view.getByLabelText('Background image file path');
    const target = 'C:\\some\\long\\typed\\path.png';
    await act(async () => {
      for (let i = 1; i <= target.length; i++) {
        fireEvent.change(input, { target: { value: target.slice(0, i) } });
      }
      await Promise.resolve();
    });
    // Mid-typing: not committed yet, resolver untouched.
    expect(calls).toBe(0);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    // Exactly one resolve call for the whole typed sequence, not one per keystroke.
    expect(calls).toBe(1);
    expect(view.getByLabelText('Chosen background image path').textContent).toBe(target);
    delete window.hermesDesktop;
    cleanup();
  });

  it('repeated Enter/blur commits on unchanged text do not re-call the resolver', async () => {
    let calls = 0;
    window.hermesDesktop = { readFileDataUrl: async () => { calls++; return 'data:image/png;base64,Y='; } };
    const data = {};
    const { view } = mountPage('conn-p9', 'default', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\stable.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(calls).toBe(1);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
      fireEvent.blur(input);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(calls).toBe(1);
    delete window.hermesDesktop;
    cleanup();
  });

  it('per-profile scoping: a typed path committed for one scope does not leak into another, and switching scope restores the other profile\'s own typed/saved path', async () => {
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,SCOPE=' };
    const data = {};
    const { view, ctx } = mountPage('conn-p10', 'alpha', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\alpha-typed.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve();
    });
    act(() => view.getByText('Save background image').click());
    const scopeAlpha = JSON.stringify(['conn-p10', 'alpha']);
    expect(data['background-image-v1'][scopeAlpha].path).toBe('C:\\alpha-typed.png');

    // Switch scope (same connection, different profile) -- the field must
    // NOT keep showing alpha's typed path.
    await act(async () => { $activeGatewayProfile.set('beta'); setConnection({ connectionId: 'conn-p10', mode: 'remote', profile: 'beta' }); await Promise.resolve(); });
    const scopeBeta = JSON.stringify(['conn-p10', 'beta']);
    expect(data['background-image-v1'][scopeBeta]).toBeUndefined();
    const inputAfter = view.getByLabelText('Background image file path');
    expect(inputAfter.value).toBe('');
    expect(view.getByLabelText('Chosen background image path').textContent).toBe('No image chosen.');
    delete window.hermesDesktop;
    cleanup();
  });

  it('path-only storage still holds for a typed-and-committed path (no base64/data URL ever persisted)', async () => {
    window.hermesDesktop = { readFileDataUrl: async () => 'data:image/png;base64,SHOULDNOTPERSIST=' };
    const data = {};
    const { view } = mountPage('conn-p11', 'default', data);
    const input = view.getByLabelText('Background image file path');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'C:\\typed-save.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve(); await Promise.resolve();
    });
    act(() => view.getByText('Save background image').click());
    const scope = JSON.stringify(['conn-p11', 'default']);
    const storedJson = JSON.stringify(data['background-image-v1'][scope]);
    expect(storedJson).not.toMatch(/data:|base64/);
    expect(storedJson).toContain('typed-save.png');
    delete window.hermesDesktop;
    cleanup();
  });
});
