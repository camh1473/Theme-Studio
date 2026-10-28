const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load() {
  if (!fs.existsSync(__dirname + '/plugin.js')) return {};
  let s = fs.readFileSync(__dirname + '/plugin.js', 'utf8');
  s = s.replace(/^import .*?;\s*$/gm, '').replace('export function createStudio', 'function createStudio').replace('export default ', 'const plugin = ');
  const box = { THEMES_AREA:'themes', ROUTES_AREA:'routes', SIDEBAR_NAV_AREA:'nav', jsx(){}, useState(){}, useRef(){}, useEffect(){}, useTheme(){}, console };
  vm.runInNewContext(s + '\nthis.createStudio = createStudio; this.plugin = plugin; this.Studio = Studio; this.scopeFor = typeof scopeFor === "function" ? scopeFor : null;', box);
  return box;
}
test('stale focused owner cannot authorize an edit', () => {
  const {createStudio}=load(), data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register:()=>()=>{}};
  const api={scope:'a',currentScope:()=>null,theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){}};
  assert.throws(()=>createStudio(ctx).begin(api),/profile/i);
});
test('apply refuses when restore record cannot be persisted', () => {
  const {createStudio}=load(), data={}; let applied=false;
  const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>{if(k!=='restore-v1')data[k]=v}},register:()=>()=>{}};
  const api={scope:'a',theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){},setTheme(){applied=true}};
  const s=createStudio(ctx); s.begin(api); const id=s.save('Test',api); assert.throws(()=>s.apply(id,api),/storage/i); assert.equal(applied,false);
});
test('reset one color restores only that original token', () => {
  const {createStudio}=load(); const data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register:()=>()=>{}};
  const api={scope:'a',theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){}};
  const s=createStudio(ctx); s.begin(api); s.edit('background','#abcdef',api); s.edit('foreground','#123abc',api);
  const d=s.resetItem('background',api); assert.equal(d.colors.background,base.colors.background); assert.equal(d.colors.foreground,'#123abc');
});
test('visual preview selects a color target by clicking it', () => {
  const box=load(), state=[]; let i=0;
  box.jsx=(type,props)=>({type,props}); box.useState=initial=>{const n=i++; if(!(n in state)) state[n]=initial; return [state[n],v=>state[n]=v]};
  box.useRef=x=>({current:x}); box.useEffect=()=>{};
  box.host={state:{connectionId:{},profile:{},focusedSessionOwner:{}}}; box.useValue=atom=>atom===box.host.state.connectionId?'local':atom===box.host.state.profile?'default':{connectionId:'local',profile:'default'};
  box.useTheme=()=>({theme:base,themeName:'base',resolvedMode:'light'});
  const studio={begin:()=>base,list:()=>[],revert(){}}; const render=()=>{i=0;return box.Studio({studio})};
  const flatten=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(flatten):[n,...flatten(n.props?.children)];
  let tree=flatten(render()); tree.find(n=>n.type==='button' && n.props.children==='Start editing current theme').props.onClick();
  tree=flatten(render()); const target=tree.find(n=>n.props?.['aria-label']==='Select sidebar color'); assert.ok(target); target.props.onClick();
  tree=flatten(render()); assert.ok(tree.some(n=>n.props?.['aria-label']==='Color for sidebarBackground'));
});
test('apply refuses to assign a focused owner on a different active gateway profile', () => {
  const {createStudio}=load(), data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register:()=>()=>{}};
  const api={scope:'owner',activeScope:'other',theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){},setTheme(){throw Error('must not apply')}};
  const s=createStudio(ctx); s.begin(api); const id=s.save('Test',api); assert.throws(()=>s.apply(id,api),/active/i);
});
test('scope follows the focused owner and fails closed when unresolved', () => {
  const {scopeFor}=load(); assert.equal(typeof scopeFor,'function');
  assert.equal(scopeFor({connectionId:'remote',profile:'bot'}), JSON.stringify(['remote','bot']));
  assert.equal(scopeFor(null),null); assert.equal(scopeFor({connectionId:'',profile:'bot'}),null);
});
test('save reports swallowed storage failure without registering the theme', () => {
  const {createStudio} = load(); const regs = new Map();
  const ctx = {storage:{get:(k,f)=>f,set(){}}, register(c){regs.set(c.id,c.data); return ()=>regs.delete(c.id)}};
  const s=createStudio(ctx), api={scope:'a',theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){}};
  s.begin(api); assert.throws(()=>s.save('Unsaved',api), /storage/i); assert.equal(s.list(api).length,0);
});
const base = { name:'base', label:'Base', description:'base', colors:{background:'#112233',foreground:'#eeeeee',primary:'#123456'}, darkColors:{background:'#000000',foreground:'#ffffff',primary:'#aaaaaa'} };
test('editor previews independently and reverts without changing the original', () => {
  const {createStudio} = load(); assert.equal(typeof createStudio, 'function');
  const registrations = new Map(); const calls = [];
  const ctx = {storage:{get:()=>[],set(){}}, register(c){ registrations.set(c.id,c.data); return ()=>registrations.delete(c.id); }};
  const studio = createStudio(ctx); const api = {scope:'local:default',theme:base,themeName:'base',resolvedMode:'dark',previewTheme:(...a)=>calls.push(a),clearThemePreview:()=>calls.push('clear')};
  studio.begin(api); studio.edit('background','#445566',api);
  assert.equal(registrations.get('preview').darkColors.background,'#445566');
  assert.equal(base.darkColors.background,'#000000'); assert.equal(calls.length,1);
  studio.revert(api); assert.equal(calls[1],'clear'); assert.equal(registrations.has('preview'),false);
});

test('save survives reload and apply can restore the prior theme safely', () => {
  const {createStudio} = load(); const data = {}; const regs = new Map();
  const ctx = {storage:{get:(k,f)=>data[k] ?? f,set:(k,v)=>data[k]=JSON.parse(JSON.stringify(v))}, register(c){regs.set(c.id,c.data); return ()=>regs.delete(c.id);}};
  const calls=[]; const api={scope:'local:default',theme:base,themeName:'base',resolvedMode:'light',availableThemes:[{name:'base'}],previewTheme(){},clearThemePreview(){},setTheme:n=>calls.push(n)};
  let s=createStudio(ctx); s.begin(api); s.edit('background','#abcdef',api); const id=s.save('My colors',api);
  s.apply(id,api); assert.equal(calls[0],id); api.themeName=id; s=createStudio(ctx); assert.equal(s.list(api)[0].label,'My colors');
  assert.equal(regs.get(id).colors.background,'#abcdef'); s.restore(api); assert.equal(calls[1],'base');
  api.availableThemes=[]; assert.throws(()=>s.restore(api)); assert.equal(calls.length,2);
});

test('saved themes are isolated by connection and profile', () => {
  const {createStudio}=load(); const data={}; const ctx={storage:{get:(k,f)=>data[k]??f,set:(k,v)=>data[k]=v},register:()=>()=>{}};
  const a={scope:'connection-a:default',theme:base,themeName:'base',resolvedMode:'light',previewTheme(){},clearThemePreview(){}};
  const b={...a,scope:'connection-b:default'}; const s=createStudio(ctx); s.begin(a); s.save('A',a);
  assert.equal(s.list(a).length,1); assert.equal(s.list(b).length,0);
  assert.throws(()=>s.save('B',b));
});
