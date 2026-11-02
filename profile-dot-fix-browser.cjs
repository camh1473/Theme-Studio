// Real-browser compiled-CSS verification for PROFILE_DOT_HARDENING_CSS.
// jsdom (used by the vitest suite) doesn't reliably apply :has() during
// cascade/computed-style resolution, so -- same pattern as
// glass-browser.cjs -- this launches real Chromium-family Edge, injects the
// exact CSS string the plugin ships, and checks actual getComputedStyle
// opacity against a faithful reconstruction of the real DOM shapes from
// profile-switcher.tsx (ProfileSquare, RestSquare, ProfilePill, and a
// control button with no dot and a dot OUTSIDE the rail wrapper).
const { chromium } = require('C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/playwright');
const fs = require('fs'), assert = require('assert/strict');
const code = fs.readFileSync(__dirname + '/plugin.js', 'utf8');
const match = code.match(/export const PROFILE_DOT_HARDENING_CSS = '([^']+)';/);
assert(match, 'PROFILE_DOT_HARDENING_CSS constant not found in plugin.js');
const css = match[1];

const html = `<html><head><style>
  .tile { opacity: 0.35; }
  .tile.active { opacity: 1; }
  ${css}
</style></head><body>
  <div data-tour="profile-rail" role="group">
    <button id="profile-square-with-dot" class="tile" type="button">
      PS
      <span><span data-slot="profile-status-dot" aria-hidden="true"></span></span>
    </button>
    <button id="profile-square-no-dot" class="tile active" type="button">
      PS2
    </button>
    <button id="rest-square-with-dot" class="tile" data-slot="profile-rail-rest-square" type="button">
      RS
      <span><span data-slot="profile-status-dot" aria-hidden="true"></span></span>
    </button>
    <button id="rest-square-no-dot" class="tile" data-slot="profile-rail-rest-square" type="button">
      RS2
    </button>
    <button id="pill-with-dot" class="tile" data-slot="profile-rail-rest-home" type="button">
      P
      <span><span data-slot="profile-status-dot" aria-hidden="true"></span></span>
    </button>
  </div>
  <button id="outside-rail-with-dot" class="tile" type="button">
    OUT
    <span><span data-slot="profile-status-dot" aria-hidden="true"></span></span>
  </button>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage();
  await page.setContent(html);
  const result = await page.evaluate(() => {
    const op = id => getComputedStyle(document.querySelector('#' + id)).opacity;
    return {
      profileSquareWithDot: op('profile-square-with-dot'),
      profileSquareNoDot: op('profile-square-no-dot'),
      restSquareWithDot: op('rest-square-with-dot'),
      restSquareNoDot: op('rest-square-no-dot'),
      pillWithDot: op('pill-with-dot'),
      outsideRailWithDot: op('outside-rail-with-dot')
    };
  });
  await browser.close();
  console.log(JSON.stringify(result));

  // ProfileSquare (no own data-slot, reached via the data-tour ancestor):
  // dot present -> forced to full opacity.
  assert.equal(result.profileSquareWithDot, '1', 'ProfileSquare tile WITH a dot must be forced to opacity 1');
  // Tile already active/opacity:1 and no dot -- unaffected either way, stays 1.
  assert.equal(result.profileSquareNoDot, '1', 'Active ProfileSquare tile without a dot is untouched (was already opacity 1)');
  // RestSquare: confirmed selector, dot present -> forced to full opacity.
  assert.equal(result.restSquareWithDot, '1', 'RestSquare tile WITH a dot must be forced to opacity 1');
  // RestSquare WITHOUT a dot keeps its normal dimmed 0.35 -- the rule must
  // NOT blanket-fix every tile, only ones actually showing the dot.
  assert.equal(result.restSquareNoDot, '0.35', 'RestSquare tile WITHOUT a dot must keep its normal dimmed opacity (rule is not a blanket fix)');
  // ProfilePill-shaped tile with a dot, also inside the rail -- bonus coverage.
  assert.equal(result.pillWithDot, '1', 'Pill-shaped tile WITH a dot must be forced to opacity 1');
  // A button with a dot OUTSIDE the profile rail wrapper must be untouched --
  // proves the rule is scoped to the rail, not a global `button:has(dot)`.
  assert.equal(result.outsideRailWithDot, '0.35', 'A dot-bearing button OUTSIDE [data-tour="profile-rail"] must be unaffected (scoping proof)');

  console.log('profile-dot-fix-browser.cjs: all real-browser compiled-CSS assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
