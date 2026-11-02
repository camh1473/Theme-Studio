// CHAOS BATCH 1, scenario 3: extreme/boundary slider and color-field values.
// Opacity/size: 0, negative, >100, NaN, Infinity, non-numeric.
// Colors: malformed hex, empty, very-long, unicode.
// Marker symbols: long, null-byte, script-like strings.
import { it, expect, describe } from 'vitest';
import {
  clampBgOpacity, clampBgSize, clampVolume, validBackgroundImageSettings,
  validSoundSettings, saveBackgroundImageSettings, saveSoundSettings,
  backgroundImageCSS, markerCSS, createStudio,
} from './plugin.js';

function rawCtx(data = {}) {
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => { data[k] = v; } }, register() { return () => {}; } };
}

describe('clampBgOpacity / clampBgSize / clampVolume boundary values', () => {
  const cases = [
    [0, 'zero'], [-1, 'negative'], [-9999, 'very negative'], [101, 'just over 100'],
    [999999, 'huge'], [NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity'],
    ['abc', 'non-numeric string'], [null, 'null'], [undefined, 'undefined'], [{}, 'object'],
    [[], 'array'], ['50', 'numeric string'], ['50.7', 'numeric string with decimal'],
    [50.9, 'float needing rounding'], ['', 'empty string'], [' ', 'whitespace string'],
    ['1e3', 'scientific notation string'], [true, 'boolean true'], [false, 'boolean false'],
  ];
  for (const [input, desc] of cases) {
    it(`clampBgOpacity(${desc}) stays within [0,100] and is always a finite integer`, () => {
      const r = clampBgOpacity(input);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(100);
    });
    it(`clampBgSize(${desc}) stays within [10,100] and is always a finite integer`, () => {
      const r = clampBgSize(input);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(10);
      expect(r).toBeLessThanOrEqual(100);
    });
    it(`clampVolume(${desc}) stays within [0,100] and is always a finite integer`, () => {
      const r = clampVolume(input);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(100);
    });
  }
  it('opacity 0 is a valid (not-rejected) saved value -- 0 must not be confused with "unset"', () => {
    const ctx = rawCtx();
    const saved = saveBackgroundImageSettings(ctx, 'scope-x', { path: 'C:\\x.png', opacity: 0, size: 50 });
    expect(saved.opacity).toBe(0);
    expect(validBackgroundImageSettings(saved)).toBe(true);
  });
  it('backgroundImageCSS with opacity 0 (after clamping a negative input) returns empty string (nothing to paint)', () => {
    expect(backgroundImageCSS('data:image/png;base64,xx', -50, 50)).toBe('');
    expect(backgroundImageCSS('data:image/png;base64,xx', NaN, 50)).not.toBe(''); // NaN clamps to default 40, not 0
  });
  it('size 10 is the floor even when caller passes 0 or negative (no 0% / collapsed background)', () => {
    expect(clampBgSize(0)).toBe(10);
    expect(clampBgSize(-50)).toBe(10);
  });
});

describe('malformed/empty/long/unicode color fields', () => {
  const badColors = [
    '', '#fff', '#ffff', '#fffffff', 'fff000', 'red', 'rgb(0,0,0)', 'rgba(0,0,0,0.5)',
    '#GGGGGG', '#12345Z', '#' + '1'.repeat(100), '🎨🎨🎨', '#ff00ff\u0000', '#ff00ff; }</style><script>alert(1)</script>',
    'javascript:alert(1)', '#'.repeat(50), null, undefined, 42, {}, [],
  ];
  for (const c of badColors) {
    it(`validBackgroundImageSettings/validSoundSettings never crash on malformed color-ish string: ${JSON.stringify(c)}`, () => {
      // Colors aren't part of background/sound settings directly, but the same
      // kind of malformed-string input flows through edit()/markerCSS for marker
      // colors -- exercise markerCSS directly with it as the color field.
      expect(() => markerCSS({ unread: { enabled: true, icon: '*', color: c } })).not.toThrow();
    });
  }
  it('createStudio.edit() rejects every malformed color and leaves the draft unchanged', () => {
    const ctx = rawCtx();
    const studio = createStudio(ctx);
    const api = { scope: 's1', currentScope: () => 's1', resolvedMode: 'light', theme: { colors: { background: '#ffffff', foreground: '#000000', primary: '#111111' } }, themeName: 'cur', previewTheme() {}, clearThemePreview() {} };
    studio.begin(api);
    for (const c of badColors) {
      expect(() => studio.edit('background', c, api)).toThrow(/invalid color/i);
    }
  });
  it('a valid uppercase-hex and mixed-case hex color IS accepted (case-insensitive by design)', () => {
    const ctx = rawCtx();
    const studio = createStudio(ctx);
    const api = { scope: 's1', currentScope: () => 's1', resolvedMode: 'light', theme: { colors: { background: '#ffffff', foreground: '#000000', primary: '#111111' } }, themeName: 'cur', previewTheme() {}, clearThemePreview() {} };
    studio.begin(api);
    expect(() => studio.edit('background', '#AaBbCc', api)).not.toThrow();
  });
});

describe('marker symbol extremes: long / null-byte / script-like / unicode strings', () => {
  const states = ['unread', 'working', 'input', 'background'];
  const badIcons = [
    'a'.repeat(17), // 17 Unicode chars > 16-char limit
    'a'.repeat(10000), // very long
    '\u0000', // null byte
    'ok\u0000hidden', // embedded null byte mid-string
    '<script>alert(1)</script>', // script-like, also >16 chars so doubly rejected
    '\ud800', // lone unpaired surrogate (malformed UTF-16)
    '\u001b[31m', // ANSI escape / control char
    String.fromCharCode(0x7f), // DEL control char
  ];
  const goodIcons = ['🔥', '★', 'AB', '', '日本語', '💯🔥'.length <= 16 ? '💯🔥' : '💯'];
  for (const icon of badIcons) {
    it(`markerCSS silently omits (never throws, never embeds raw) a bad icon: ${JSON.stringify(icon).slice(0, 40)}`, () => {
      let css;
      // markerCSS joins one entry per state ('' for the 3 untouched states too,
      // via Array#join('\n')), so a single bad icon still yields an all-empty,
      // "\n"-joined result -- assert on *content*, not exact string equality.
      expect(() => { css = markerCSS({ unread: { enabled: true, icon, color: '#ff0000' } }); }).not.toThrow();
      expect(css.trim()).toBe('');
      expect(css).not.toContain('script');
      expect(css).not.toContain(String(icon));
    });
  }
  for (const icon of goodIcons) {
    it(`markerCSS accepts a short Unicode icon and CSS-escapes it safely: ${JSON.stringify(icon)}`, () => {
      const css = markerCSS({ unread: { enabled: true, icon, color: '#ff0000' } });
      if (icon === '') {
        // Blank icon + a color still set -> falls to the color-only branch
        // (background-color override on the dot), not the ::after icon branch.
        expect(css).toContain('background-color:#ff0000');
        expect(css).not.toContain('::after');
      } else {
        expect(css).toContain('::after');
        // The raw icon characters must NOT appear unescaped in a way that could break out of the CSS content string
        // (every char is emitted as a numeric CSS escape, so literal '<', '>', '"' never appear raw).
        expect(css).not.toContain('<script>');
      }
    });
  }
  it('a script-like string that happens to be <=16 chars is still CSS-escaped, not echoed raw', () => {
    const payload = '"}</style><a>'; // 14 chars, would pass length check
    const css = markerCSS({ unread: { enabled: true, icon: payload, color: '#ff0000' } });
    expect(css).not.toContain('"}</style><a>'); // never appears verbatim
    expect(css).not.toContain('</style>');
  });
  it('every state key tolerates a bad icon independently (one bad state does not break the others)', () => {
    const config = {
      unread: { enabled: true, icon: 'a'.repeat(999), color: '#ff0000' }, // bad -> omitted
      working: { enabled: true, icon: '★', color: '#00ff00' }, // good -> included
      input: { enabled: false, icon: '★', color: '#0000ff' }, // disabled -> omitted
      background: { enabled: true, icon: '', color: '#ffff00' }, // good, blank icon, color-only
    };
    const css = markerCSS(config);
    expect(css).toContain('::after');
    expect(css).not.toContain('a'.repeat(50));
  });
});

describe('sound settings boundary combinations', () => {
  it('volume exactly 0 is valid and distinct from "no volume provided" (defaults to 50)', () => {
    const ctx = rawCtx();
    const saved = saveSoundSettings(ctx, 'scope-x', { presetId: 'bell', customUrl: '', volume: 0 });
    expect(saved.volume).toBe(0);
    expect(validSoundSettings(saved)).toBe(true);
  });
  it('customUrl at exactly the 500-char boundary is accepted; 501 chars is rejected by the length check but clamped (sliced) safely, never throws unexpectedly', () => {
    const ctx = rawCtx();
    const url500 = 'https://example.com/' + 'a'.repeat(500 - 'https://example.com/'.length);
    expect(url500.length).toBe(500);
    expect(() => saveSoundSettings(ctx, 'scope-x', { presetId: 'custom', customUrl: url500, volume: 50 })).not.toThrow();
    const url501 = url500 + 'a';
    expect(() => saveSoundSettings(ctx, 'scope-x', { presetId: 'custom', customUrl: url501, volume: 50 })).toThrow();
  });
  it('a non-string volume (object/array/NaN) is clamped rather than crashing saveSoundSettings', () => {
    const ctx = rawCtx();
    for (const v of [NaN, Infinity, -Infinity, 'loud', null, undefined, {}, [], true]) {
      const saved = saveSoundSettings(ctx, 'scope-x', { presetId: 'bell', customUrl: '', volume: v });
      expect(Number.isInteger(saved.volume)).toBe(true);
      expect(saved.volume).toBeGreaterThanOrEqual(0);
      expect(saved.volume).toBeLessThanOrEqual(100);
    }
  });
});
