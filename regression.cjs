const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const { chromium } = require('C:/Users/camh1/AppData/Local/hermes/hermes-agent/node_modules/playwright');
const source = fs.readFileSync(__dirname + '/plugin.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createStudio','function createStudio').replace('export default {','const pluginDefault = {');
const studioFactory = vm.runInNewContext(source + '\ncreateStudio', {THEMES_AREA:'themes', ROUTES_AREA:'routes', SIDEBAR_NAV_AREA:'nav'});
const registrations = new Map(), storage = new Map();
const ctx = { storage:{get:(k,d)=>storage.has(k)?storage.get(k):d,set:(k,v)=>storage.set(k,v)}, register:x=>{registrations.set(x.id,x.data);return ()=>registrations.delete(x.id)} };
const studio = studioFactory(ctx);
const theme={name:'base',label:'base',colors:{background:'#ffffff',foreground:'#111111',primary:'#222222'},customCSS:'.keep-me { color: rgb(1, 2, 3); }'};
const api={scope:'scope',resolvedMode:'light',theme,themeName:'base',previewTheme:()=>{},clearThemePreview:()=>{}};
studio.begin(api); studio.edit('chatBackground','#ff69b4',api);
const preview=registrations.get('preview');
assert.ok(preview.customCSS.includes('.keep-me'), 'existing custom CSS must survive');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const page=await browser.newPage();
  // Source-derived declarations from styles.css:297-301,399 and 664-674.
  const styles=fs.readFileSync('C:/Users/camh1/AppData/Local/hermes/hermes-agent/apps/desktop/src/styles.css','utf8');
  const chrome=styles.match(/--ui-bg-chrome:\s*color-mix\([\s\S]*?\);/)[0];
  const chat=styles.match(/--ui-chat-surface-background:\s*var\(--ui-bg-chrome\);/)[0];
  const glass=styles.match(/:root\[data-hermes-glass\]\s*\{[^}]+\}/)[0];
  await page.setContent(`<style>:root { --theme-background-seed: ${preview.colors.background}; --theme-mix-chrome: 92%; --theme-neutral-chrome: #f3f3f3; ${chrome} ${chat} } ${glass} [data-chat-surface], [data-slot="composer-bounds"] { background-color:var(--ui-chat-surface-background) } #other {background-color:var(--ui-bg-chrome)} ${preview.customCSS||''}</style><div data-chat-surface><div data-slot="composer-bounds"></div></div><div id="other"></div><div class="keep-me"></div>`);
  const result=await page.evaluate(()=>Object.fromEntries(['[data-chat-surface]','[data-slot="composer-bounds"]','#other','.keep-me'].map(s=>[s,getComputedStyle(document.querySelector(s)).backgroundColor])));
  console.log('computed',JSON.stringify(result));
  assert.equal(result['[data-chat-surface]'],'rgb(255, 105, 180)','chat should paint the exact chosen pink');
  assert.equal(result['[data-slot="composer-bounds"]'],'rgb(255, 105, 180)','thread should inherit exact pink');
  assert.notEqual(result['#other'],'rgb(255, 105, 180)','unrelated chrome must keep its mix');
  console.log('PASS');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
