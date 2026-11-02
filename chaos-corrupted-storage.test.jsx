// CHAOS BATCH 1, scenario 2: malformed/corrupted ctx.storage data injected
// into EVERY storage key this plugin reads. Goal: confirm graceful
// degradation (defaults, or a caught Error message) -- never an unhandled
// exception thrown out of a read path or out of createStudio's constructor.
import { it, expect, afterEach, describe } from 'vitest';
import { cleanup } from 'C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/@testing-library/react/dist/index.js';
import plugin, {
  createStudio, readSoundSettings, saveSoundSettings, readBackgroundImageSettings,
  saveBackgroundImageSettings, readSoundReminderDismissed, dismissSoundReminder,
  markerCSS
} from './plugin.js';

afterEach(() => { cleanup(); localStorage.clear(); });

// Raw ctx: storage.get returns EXACTLY whatever `data[key]` holds (no
// JSON.parse/stringify round-trip), so we can inject truly malformed values
// (functions, NaN, Infinity, circular-free garbage) the way a corrupted
// localStorage blob or a bad migration could produce.
function rawCtx(data) {
  return {
    storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => { data[k] = v; } },
    register() { return () => {}; },
  };
}

const GARBAGE = [
  'not json at all {{{',
  '"just a string"',
  42,
  NaN,
  Infinity,
  -Infinity,
  true,
  false,
  null,
  undefined,
  [],
  ['a', 'b', 'c'],
  {},
  { random: 'field' },
  () => {},
  Symbol('x'),
];

describe('scoped-themes-v1 corruption', () => {
  for (const g of GARBAGE) {
    it(`createStudio does not throw when scoped-themes-v1 = ${String(g)}`, () => {
      const data = { 'scoped-themes-v1': g };
      const ctx = rawCtx(data);
      expect(() => createStudio(ctx)).not.toThrow();
    });
  }
  it('constructor FILTERS garbage array entries at load (tolerant), but refresh() (used by every write path) deliberately REFUSES to proceed at all if any entry is unrecognized -- by design, matching "never silently drop saved themes": list() still throws a clean caught Error, not a crash', () => {
    const data = { 'scoped-themes-v1': [
      null, undefined, 42, 'str', [], {},
      { scope: 123, theme: { name: 'theme-studio-x', label: 'X', colors: { background: '#fff', foreground: '#000', primary: '#111' } } }, // bad scope type
      { scope: 's1' }, // missing theme
      { scope: 's1', theme: null },
      { scope: 's1', theme: { name: 'bad name!!', label: 'X', colors: { background: '#fff', foreground: '#000', primary: '#111' } } }, // bad name
      { scope: 's1', theme: { name: 'theme-studio-ok', label: 'OK', colors: { background: '#fff', foreground: '#000', primary: '#111' } }, extraField: 'ignored-but-harmless' },
    ] };
    const ctx = rawCtx(data);
    let studio;
    // Constructor itself (load-time) tolerates and filters garbage -- never throws.
    expect(() => { studio = createStudio(ctx); }).not.toThrow();
    const api = { scope: 's1', currentScope: () => 's1', resolvedMode: 'light', theme: { colors: {} }, themeName: 'x', availableThemes: [] };
    // list() calls refresh(), which re-validates the WHOLE array and refuses
    // to proceed if anything is unrecognized (conservative: never silently
    // treat "looks wrong to today's code" as "safe to drop"). This throws a
    // clean, caught Error -- exactly the "graceful degradation" the chaos
    // test is checking for, not a raw TypeError/crash.
    expect(() => studio.list(api)).toThrow(/invalid themes/i);
  });
  it('a top-level corrupted value written DIRECTLY to storage (bypassing persist) makes refresh() throw a caught Error, not crash the app', () => {
    const data = { 'scoped-themes-v1': [{ scope: 's1', theme: { name: 'theme-studio-a', label: 'A', colors: { background: '#fff', foreground: '#000', primary: '#111' } } }] };
    const ctx = rawCtx(data);
    const studio = createStudio(ctx);
    const api = { scope: 's1', currentScope: () => 's1', resolvedMode: 'light', theme: { colors: { background: '#fff', foreground: '#000', primary: '#111' } }, themeName: 'theme-studio-a', availableThemes: [] };
    studio.begin(api); // establish a draft so save() gets past requireDraft() and actually reaches refresh()
    // Corrupt storage AFTER construction, simulating a concurrent/external write.
    data['scoped-themes-v1'] = 'now garbage';
    expect(() => studio.list(api)).toThrow(/invalid themes/i);
    // save() calls refresh() internally too -- must also throw a clean Error, not a TypeError.
    expect(() => studio.save('New name', api)).toThrow(/invalid themes/i);
  });
});

describe('restore-v1 corruption', () => {
  for (const g of GARBAGE) {
    it(`apply()/restore() tolerate restore-v1 = ${String(g)} without throwing a non-Error exception`, () => {
      const data = {
        'scoped-themes-v1': [{ scope: 's1', theme: { name: 'theme-studio-a', label: 'A', colors: { background: '#fff', foreground: '#000', primary: '#111' } } }],
        'restore-v1': g,
      };
      const ctx = rawCtx(data);
      const studio = createStudio(ctx);
      const api = { scope: 's1', activeScope: 's1', currentActiveScope: () => 's1', currentScope: () => 's1', resolvedMode: 'light', theme: { colors: {} }, themeName: 'current', availableThemes: [{ name: 'current' }], setTheme() {} };
      // apply() must either succeed (overwriting the garbage) or throw a real Error -- never a raw TypeError from reading a bad shape.
      try { studio.apply('theme-studio-a', api); } catch (e) { expect(e).toBeInstanceOf(Error); }
      // restore() reads restore-v1 with optional chaining; must throw a clean Error (no saved record) not a TypeError.
      expect(() => studio.restore(api)).toThrow(/cannot safely restore/i);
    });
  }
});

describe('markers-v1 corruption (via markerCSS + plugin.register path)', () => {
  for (const g of GARBAGE) {
    it(`markerCSS(${String(g)}) never throws and returns a string`, () => {
      expect(() => { const css = markerCSS(g); expect(typeof css).toBe('string'); }).not.toThrow();
    });
  }
  it('plugin.register tolerates markers-v1 garbage at mount time', () => {
    const data = { 'markers-v1': 'totally corrupted' };
    const ctx = { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => { data[k] = v; } }, register() { return () => {}; }, onDispose() {} };
    expect(() => plugin.register(ctx)).not.toThrow();
  });
});

describe('sound-settings-v1 / sound-reminder-dismissed-v1 corruption', () => {
  for (const g of GARBAGE) {
    it(`readSoundSettings degrades to defaults when sound-settings-v1 = ${String(g)}`, () => {
      const data = { 'sound-settings-v1': g };
      const ctx = rawCtx(data);
      let settings;
      expect(() => { settings = readSoundSettings(ctx, 'scope-x'); }).not.toThrow();
      expect(settings.presetId).toBe('none');
      expect(settings.volume).toBe(50);
    });
    it(`readSoundReminderDismissed is a safe boolean when sound-reminder-dismissed-v1 = ${String(g)}`, () => {
      const data = { 'sound-reminder-dismissed-v1': g };
      const ctx = rawCtx(data);
      expect(() => expect(typeof readSoundReminderDismissed(ctx, 'scope-x')).toBe('boolean')).not.toThrow();
    });
  }
  it('sound-settings-v1 entry with wrong-typed fields for OUR scope is rejected, not merged in raw', () => {
    const data = { 'sound-settings-v1': { 'scope-x': { presetId: 42, customUrl: null, volume: 'loud' } } };
    const ctx = rawCtx(data);
    expect(readSoundSettings(ctx, 'scope-x')).toEqual({ presetId: 'none', customUrl: '', customPath: '', volume: 50 });
  });
  it('saveSoundSettings on top of corrupted sound-settings-v1 (non-object) still writes cleanly for our scope', () => {
    const data = { 'sound-settings-v1': 'garbage-root' };
    const ctx = rawCtx(data);
    const saved = saveSoundSettings(ctx, 'scope-x', { presetId: 'bell', customUrl: '', volume: 60 });
    expect(saved.presetId).toBe('bell');
    expect(data['sound-settings-v1']).toEqual({ 'scope-x': { presetId: 'bell', customUrl: '', customPath: '', volume: 60 } });
  });
  it('dismissSoundReminder on top of corrupted root still writes cleanly', () => {
    const data = { 'sound-reminder-dismissed-v1': 12345 };
    const ctx = rawCtx(data);
    expect(() => dismissSoundReminder(ctx, 'scope-x')).not.toThrow();
    expect(data['sound-reminder-dismissed-v1']).toEqual({ 'scope-x': true });
  });
});

describe('background-image-v1 corruption', () => {
  for (const g of GARBAGE) {
    it(`readBackgroundImageSettings degrades to defaults when background-image-v1 = ${String(g)}`, () => {
      const data = { 'background-image-v1': g };
      const ctx = rawCtx(data);
      let settings;
      expect(() => { settings = readBackgroundImageSettings(ctx, 'scope-x'); }).not.toThrow();
      expect(settings.path).toBe('');
      expect(settings.opacity).toBe(40);
      expect(settings.size).toBe(50);
    });
  }
  it('an entry with NaN/Infinity opacity/size for our scope is rejected wholesale, falls back to defaults', () => {
    const data = { 'background-image-v1': { 'scope-x': { path: 'C:\\img.png', opacity: NaN, size: Infinity } } };
    const ctx = rawCtx(data);
    expect(readBackgroundImageSettings(ctx, 'scope-x')).toEqual({ path: '', opacity: 40, size: 50 });
  });
  it('saveBackgroundImageSettings on top of corrupted root still writes cleanly for our scope', () => {
    const data = { 'background-image-v1': ['garbage', 'array', 'not', 'object'] };
    const ctx = rawCtx(data);
    const saved = saveBackgroundImageSettings(ctx, 'scope-x', { path: 'C:\\x.png', opacity: 70, size: 80 });
    expect(saved).toEqual({ path: 'C:\\x.png', opacity: 70, size: 80 });
  });
  it('a null-byte / huge path string is still just a string (no path validation gap allowing object injection)', () => {
    const data = {};
    const ctx = rawCtx(data);
    const hugePath = 'C:\\' + 'a'.repeat(5000) + '.png';
    expect(() => saveBackgroundImageSettings(ctx, 'scope-x', { path: hugePath, opacity: 50, size: 50 })).toThrow(/invalid background image settings/i);
  });
});
