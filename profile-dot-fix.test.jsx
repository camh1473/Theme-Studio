import { it, expect, afterEach, describe } from 'vitest';
import plugin, { PROFILE_DOT_HARDENING_CSS } from './plugin.js';

afterEach(() => { localStorage.clear(); document.querySelectorAll('[data-theme-studio-profile-dot-fix]').forEach(el => el.remove()); });

function ctxWith(data = {}, extra) {
  return { storage: { get: (k, f) => (k in data ? data[k] : f), set: (k, v) => data[k] = JSON.parse(JSON.stringify(v)) }, register: () => () => {}, ...extra };
}

describe('Profile dot hardening: exact CSS content', () => {
  it('scopes to the rail ancestor and gates on the dot\u2019s own stable data-slot', () => {
    expect(PROFILE_DOT_HARDENING_CSS).toContain('[data-tour="profile-rail"]');
    expect(PROFILE_DOT_HARDENING_CSS).toContain(':has([data-slot="profile-status-dot"])');
    expect(PROFILE_DOT_HARDENING_CSS).toContain('opacity: 1 !important');
  });

  it('is a single rule -- not multiple overlapping/competing overrides', () => {
    expect(PROFILE_DOT_HARDENING_CSS.match(/\{/g).length).toBe(1);
  });

  it('does NOT use a blanket selector with no :has() gate (would un-dim every tile, dot or not)', () => {
    expect(PROFILE_DOT_HARDENING_CSS).not.toMatch(/^\[data-tour="profile-rail"\] button \{/);
  });
});

describe('Profile dot hardening: mount lifecycle via register(ctx)', () => {
  it('register() injects exactly one <style> tag carrying the hardening CSS', () => {
    const ctx = ctxWith();
    plugin.register(ctx);
    const styles = document.querySelectorAll('[data-theme-studio-profile-dot-fix]');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toBe(PROFILE_DOT_HARDENING_CSS);
    expect(styles[0].tagName).toBe('STYLE');
  });

  it('is mounted in <head>, not tied to any statusBar/UI contribution render lifecycle', () => {
    const ctx = ctxWith();
    plugin.register(ctx);
    const style = document.querySelector('[data-theme-studio-profile-dot-fix]');
    expect(style.parentElement).toBe(document.head);
  });

  it('ctx.onDispose(teardown) removes the injected style tag', () => {
    let teardown;
    const ctx = ctxWith(undefined, { onDispose: fn => { teardown = fn; } });
    plugin.register(ctx);
    expect(document.querySelector('[data-theme-studio-profile-dot-fix]')).toBeTruthy();
    teardown();
    expect(document.querySelector('[data-theme-studio-profile-dot-fix]')).toBeFalsy();
  });

  it('register() does not throw when ctx has no onDispose at all (older/minimal test harness ctx)', () => {
    const ctx = ctxWith(); // no onDispose key
    expect(() => plugin.register(ctx)).not.toThrow();
    expect(document.querySelector('[data-theme-studio-profile-dot-fix]')).toBeTruthy();
  });

  it('is static (no scope/profile/connection dependency) -- re-registering never changes the CSS text', () => {
    const ctxA = ctxWith();
    plugin.register(ctxA);
    const textA = document.querySelector('[data-theme-studio-profile-dot-fix]').textContent;
    document.querySelectorAll('[data-theme-studio-profile-dot-fix]').forEach(el => el.remove());
    const ctxB = ctxWith({ 'scoped-themes-v1': [] });
    plugin.register(ctxB);
    const textB = document.querySelector('[data-theme-studio-profile-dot-fix]').textContent;
    expect(textA).toBe(textB);
  });
});

describe('Profile dot hardening: no interference with existing features on register()', () => {
  it('register() still registers the theme-studio page, nav, and marker-style contributions unchanged', () => {
    const registered = [];
    const ctx = ctxWith(undefined, { register: r => { registered.push(r.id); return () => {}; } });
    plugin.register(ctx);
    expect(registered).toContain('page');
    expect(registered).toContain('nav');
    expect(registered).toContain('marker-style');
  });

  it('plugin metadata (id/name/defaultEnabled) is unchanged by this addition', () => {
    expect(plugin.id).toBe('theme-studio');
    expect(plugin.name).toBe('Theme Studio');
    expect(plugin.defaultEnabled).toBe(false);
  });
});
