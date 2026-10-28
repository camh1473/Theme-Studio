import { THEMES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, useTheme, useValue, host } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { useState, useRef, useEffect } from 'react';

const copy = value => JSON.parse(JSON.stringify(value));
const scopeFor = owner => owner && typeof owner.connectionId === 'string' && owner.connectionId.trim() && typeof owner.profile === 'string' && owner.profile.trim() ? JSON.stringify([owner.connectionId,owner.profile]) : null;
const keys = ['background','foreground','card','cardForeground','muted','mutedForeground','popover','popoverForeground','primary','primaryForeground','secondary','secondaryForeground','accent','accentForeground','border','input','ring','midground','midgroundForeground','composerRing','destructive','destructiveForeground','sidebarBackground','sidebarBorder','userBubble','userBubbleBorder'];
const labels = {background:'App background tint',foreground:'Main text color (shared)',card:'Editor & card tint',sidebarBackground:'Sidebar and menu backgrounds (shared)',userBubble:'Your message bubble tint',chatBackground:'Conversation background (not glass)',sessionsSidebarBackground:'Sessions sidebar (30% glass tint)',primary:'Panel header / primary accent (shared)',midground:'Interactive accent (shared)',muted:'Muted surface token',popover:'Popover surface token',primaryForeground:'Primary accent text token',secondary:'Secondary surface token',secondaryForeground:'Secondary text token',accent:'Accent surface token',accentForeground:'Accent text token',border:'Shared border token',input:'Input surface token',ring:'Focus ring token',midgroundForeground:'Interactive accent text token',composerRing:'Composer focus ring token',destructive:'Destructive action token',destructiveForeground:'Destructive action text token',sidebarBorder:'Sidebar border token',userBubbleBorder:'Your message bubble border token'};
const mainColors = ['foreground','background','card','sidebarBackground','userBubble','chatBackground','sessionsSidebarBackground','primary','midground'];
const advancedColors = keys.filter(k => !mainColors.includes(k) && !['cardForeground','mutedForeground','popoverForeground'].includes(k));
const valid = t => t && typeof t.name === 'string' && /^theme-studio-[a-z0-9-]+$/.test(t.name) && typeof t.label === 'string' && t.colors && ['background','foreground','primary'].every(k => typeof t.colors[k] === 'string');
const addChatRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + '\n:root:not([data-hermes-glass]) [data-chat-surface] { --ui-chat-surface-background: ' + color + '; }'; return result; };

const addSessionsRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + `\n:root:not([data-hermes-glass]) [data-tour="sessions-sidebar"][data-slot="sidebar"] { --ui-sidebar-surface-background: ${color}; }\n:root[data-hermes-glass] [data-tour="sessions-sidebar"][data-slot="sidebar"] { background-color: color-mix(in srgb, ${color} 30%, transparent); }`; return result; };

export function createStudio(ctx) {
  let saved = ctx.storage.get('scoped-themes-v1', []);
  if (!Array.isArray(saved)) saved = [];
  saved = saved.filter(x => x && typeof x.scope === 'string' && valid(x.theme));
  const registrations = new Map();
  for (const {theme} of saved) { try { registrations.set(theme.name, ctx.register({id:theme.name, area:THEMES_AREA, data:copy(theme)})); } catch (e) { console.error('Theme registration failed:', theme.name, e); } }
  function refresh() {
    const latest = ctx.storage.get('scoped-themes-v1', []);
    if (!Array.isArray(latest) || latest.some(x => !x || typeof x.scope !== 'string' || !valid(x.theme))) throw Error('Storage contains invalid themes; refusing to overwrite.');
    saved = copy(latest);
    return saved;
  }
  let bubbleEdited = false, editingId = null, deleted = null;
  let baseline = null, draft = null, mode = 'light', previewDispose = null, previous = null, draftScope = null, chatEdited = false, sessionsEdited = false;
  const withChatCSS = theme => { let result = chatEdited ? addChatRule(theme, chatEdited) : copy(theme); if (sessionsEdited) result = addSessionsRule(result, sessionsEdited); if (bubbleEdited) result.customCSS = (result.customCSS || '') + `\n:root .composer-human-message { --dt-user-bubble: color-mix(in srgb, ${bubbleEdited} var(--user-bubble-keep, 100%), transparent); }`; return result; };
  const requireScope = api => { if (!api.scope || (api.currentScope && api.currentScope() !== api.scope)) throw Error('Active connection and profile are required, and focus must not change.'); return api.scope; };
  function clear(api) { if (previewDispose) { api.clearThemePreview(); previewDispose(); previewDispose = null; } }
  function begin(api) { editingId = null; const scope = requireScope(api); clear(api); chatEdited = false; sessionsEdited = false; bubbleEdited = false; mode = api.resolvedMode; baseline = copy(api.theme); if (mode === 'dark') baseline.darkColors = copy(api.theme.colors); else if (!baseline.darkColors) baseline.darkColors = copy(api.theme.colors); draft = copy(baseline); previous = api.themeName; draftScope = scope; return copy(draft); }
  function beginSaved(name, api) {
    const scope = requireScope(api); refresh(); const entry = saved.find(x => x.scope === scope && x.theme.name === name);
    if (!entry) throw Error('Theme is not saved for this connection and profile.');
    clear(api); chatEdited = false; sessionsEdited = false; bubbleEdited = false; mode = api.resolvedMode;
    baseline = copy(entry.theme); draft = copy(entry.theme); previous = api.themeName; draftScope = scope; editingId = name;
    return copy(draft);
  }
  function persist(next) {
    ctx.storage.set('scoped-themes-v1', next);
    if (JSON.stringify(ctx.storage.get('scoped-themes-v1', null)) !== JSON.stringify(next)) throw Error('Storage failed; changes were not confirmed.');
    saved = copy(next);
  }
  function saveChanges(label, api) {
    requireDraft(api); if (!editingId) throw Error('Select a saved theme to edit.');
    label = label.trim(); if (!label || label.length > 80) throw Error('Enter a name (1–80 characters).');
    refresh(); const index = saved.findIndex(x => x.scope === api.scope && x.theme.name === editingId);
    if (index < 0) throw Error('Saved theme no longer exists in this profile.'); if (JSON.stringify(saved[index].theme) !== JSON.stringify(baseline)) throw Error('Saved theme changed elsewhere; reopen it before saving.');
    const theme = {...withChatCSS(draft), name:editingId, label}; if (!valid(theme)) throw Error('Invalid theme.');
    const next = copy(saved); next[index] = {scope:api.scope,theme}; persist(next);
    const dispose = registrations.get(editingId);
    try { if (dispose) dispose(); registrations.delete(editingId); registrations.set(editingId, ctx.register({id:editingId,area:THEMES_AREA,data:copy(theme)})); }
    catch (e) { throw Error('Saved, but registration failed; reload the plugin.'); }
    baseline = copy(theme); draft = copy(theme); chatEdited = false; sessionsEdited = false; bubbleEdited = false; return editingId;
  }
  function remove(name, api) {
    const scope = requireScope(api); if (typeof api.themeName !== 'string' || !api.themeName) throw Error('Active theme is unknown; cannot delete.');
    if (api.themeName === name) throw Error('Cannot delete the active theme. Switch themes first.');
    refresh(); const index = saved.findIndex(x => x.scope === scope && x.theme.name === name); if (index < 0) throw Error('Theme is not saved for this connection and profile.');
    const item = copy(saved[index]); const next = copy(saved); next.splice(index,1); persist(next);
    deleted = {item,index};
    if (editingId === name) { clear(api); editingId = null; draft = null; baseline = null; }
    const dispose = registrations.get(name); try { if (dispose) dispose(); registrations.delete(name); } catch(e) { throw Error('Deleted from storage, but unregister failed; reload the plugin.'); }
  }
  function undoDelete(api) {
    const scope = requireScope(api); if (!deleted || deleted.item.scope !== scope) throw Error('No deletion to undo for this profile.');
    refresh(); if (saved.some(x => x.theme.name === deleted.item.theme.name)) throw Error('Theme ID already exists.');
    const next = copy(saved); next.splice(Math.min(deleted.index,next.length),0,copy(deleted.item)); persist(next);
    const theme = deleted.item.theme; deleted = null;
    try { registrations.set(theme.name,ctx.register({id:theme.name,area:THEMES_AREA,data:copy(theme)})); }
    catch(e) { throw Error('Restored to storage, but registration failed; reload the plugin.'); }
    return theme.name;
  }
  function paint(api) {
    clear(api);
    const preview = withChatCSS(draft); preview.name = 'theme-studio-preview'; preview.label = 'Studio preview';
    previewDispose = ctx.register({id:'preview', area:THEMES_AREA, data:preview});
    api.previewTheme(preview.name, mode);
  }
  const requireDraft = api => { if (!draft || requireScope(api) !== draftScope) throw Error('Profile changed; start editing again.'); if (api.resolvedMode !== mode) throw Error('Mode changed; start editing again.'); };
  function edit(key, color, api) {
    requireDraft(api); if (!(keys.includes(key) || key === 'chatBackground' || key === 'sessionsSidebarBackground') || !/^#[0-9a-f]{6}$/i.test(color)) throw Error('Invalid color.');
    if (key === 'sessionsSidebarBackground') { sessionsEdited = color; draft.sessionsSidebarBackground = color; paint(api); return copy(draft); }
    if (key === 'chatBackground') { chatEdited = color; draft.chatBackground = color; paint(api); return copy(draft); }
    const field = mode === 'dark' ? 'darkColors' : 'colors';
    if (!draft[field]) draft[field] = copy(draft.colors);
    draft[field][key] = color; if (key === 'userBubble') bubbleEdited = color; paint(api); return copy(draft);
  }
  function resetItem(key, api) {
    requireDraft(api); if (!(keys.includes(key) || key === 'chatBackground' || key === 'sessionsSidebarBackground')) throw Error('Invalid color.');
    if (key === 'sessionsSidebarBackground') { sessionsEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    if (key === 'chatBackground') { chatEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    const field = mode === 'dark' ? 'darkColors' : 'colors';
    const original = baseline[field] || baseline.colors; if (key === 'userBubble') bubbleEdited = false;
    if (!draft[field]) draft[field] = copy(draft.colors);
    if (Object.prototype.hasOwnProperty.call(original,key)) draft[field][key] = original[key]; else delete draft[field][key];
    paint(api); return copy(draft);
  }
  function revert(api) { clear(api); chatEdited = false; sessionsEdited = false; bubbleEdited = false; draft = baseline ? copy(baseline) : null; return draft && copy(draft); }
  function reset(api) { requireDraft(api); chatEdited = false; sessionsEdited = false; bubbleEdited = false; draft = copy(baseline); paint(api); return copy(draft); }
  function save(label, api) {
    requireDraft(api);
    label = label.trim(); if (!draft || !label || label.length > 80) throw Error('Enter a name (1–80 characters).');
    refresh(); let name; do { name = 'theme-studio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10); } while (saved.some(t => t.theme.name === name));
    const theme = {...withChatCSS(draft), name, label, description:'Saved in Theme Studio'};
    const next = [...saved, {scope:api.scope, theme}]; persist(next);
    try { registrations.set(name, ctx.register({id:name, area:THEMES_AREA, data:theme})); } catch(e) { throw Error('Saved, but registration failed; reload the plugin.'); } return name;
  }
  function apply(name, api) {
    const scope = requireScope(api);
    if ('activeScope' in api && (api.activeScope !== scope || (api.currentActiveScope && api.currentActiveScope() !== scope))) throw Error('Focused owner differs from the active gateway profile; switch profiles before applying.');
    refresh(); if (!saved.some(t => t.scope === scope && t.theme.name === name)) throw Error('Theme is not saved for this connection and profile.');
    const all = ctx.storage.get('restore-v1', {});
    const restores = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    restores[scope] = {previous:api.themeName, applied:name}; ctx.storage.set('restore-v1', restores);
    if (JSON.stringify(ctx.storage.get('restore-v1', null)) !== JSON.stringify(restores)) throw Error('Storage failed; cannot safely apply without a restore record.');
    clear(api); api.setTheme(name);
  }
  function restore(api) {
    const scope = requireScope(api); if ('activeScope' in api && (api.activeScope !== scope || (api.currentActiveScope && api.currentActiveScope() !== scope))) throw Error('Focused owner differs from the active gateway profile.'); const record = ctx.storage.get('restore-v1', {})?.[scope];
    if (!record || api.themeName !== record.applied || !api.availableThemes.some(t => t.name === record.previous)) throw Error('Cannot safely restore: theme changed or original is unavailable.');
    clear(api); api.setTheme(record.previous);
  }
  return {begin, beginSaved, saveChanges, remove, undoDelete, edit, resetItem, revert, reset, save, apply, restore, list:api=>refresh().filter(t=>t.scope === requireScope(api)).map(t=>({name:t.theme.name,label:t.theme.label})), previous:()=>previous};
}

function Studio({studio,ctx,markerEvents}) {
  const themeApi = useTheme(); const connection = useValue(host.state.connectionId); const profile = useValue(host.state.profile);
  const owner = useValue(host.state.focusedSessionOwner);
  const scope = scopeFor(owner); const activeScope = scopeFor({connectionId:connection,profile});
  const api = {...themeApi, scope, activeScope, currentScope:()=>scopeFor(host.state.focusedSessionOwner?.get()), currentActiveScope:()=>scopeFor({connectionId:host.state.connectionId.get(),profile:host.state.profile.get()})}; const apiRef = useRef(api); apiRef.current = api;
  const [editingSaved,setEditingSaved] = useState(false); const [draft,setDraft] = useState(null); const [name,setName] = useState(''); const [selected,setSelected] = useState('background');
  const [saved,setSaved] = useState([]); const [choice,setChoice] = useState(''); const [message,setMessage] = useState('Choose Start editing to copy the current theme.');
  const draftMode = useRef(null);
  useEffect(() => () => studio.revert(apiRef.current), [studio]);
  useEffect(() => { studio.revert(apiRef.current); draftMode.current = null; setDraft(null); setChoice(''); try { setSaved(api.scope ? studio.list(api) : []); } catch (e) { setSaved([]); setMessage(e.message); } }, [studio, api.scope]);
  useEffect(() => { if (draftMode.current && draftMode.current !== api.resolvedMode) { studio.revert(apiRef.current); draftMode.current = null; setDraft(null); setMessage('Mode changed; editing cancelled. Start editing again.'); } }, [studio, api.resolvedMode]);
  const act = fn => { try { fn(); } catch(e) { setMessage(e.message); } };
  const palette = draft && (api.resolvedMode === 'dark' ? (draft.darkColors || draft.colors) : draft.colors);
  const selectedValue = selected === 'chatBackground' || selected === 'sessionsSidebarBackground' ? draft?.[selected] : palette?.[selected];
  const color = /^#[0-9a-f]{6}$/i.test(selectedValue || '') ? selectedValue : '#808080';
  const button = (label, onClick, disabled=false) => jsx('button',{type:'button',onClick,disabled,style:{padding:'6px 10px',cursor:'pointer'},children:label});
  const colorButton = k => jsx('button',{type:'button',onClick:()=>setSelected(k),title:(k === 'chatBackground' || k === 'sessionsSidebarBackground' ? draft[k] : palette[k]) || 'Uses theme fallback',style:{padding:'7px',border:k===selected?'2px solid var(--ui-accent)':'1px solid var(--ui-stroke-secondary)'},children:[jsx('span',{style:{display:'inline-block',width:14,height:14,marginRight:5,background:(k === 'chatBackground' || k === 'sessionsSidebarBackground' ? draft[k] : palette[k]) || 'transparent'}}),labels[k]]},k);
  return jsx('div',{style:{padding:20,overflow:'auto',height:'100%',color:'var(--ui-text-primary)'},children:[
    jsx('h2',{children:'Theme Studio'}),
    jsx('p',{children:'Edit a copy of the current theme. Preview is temporary; saved themes are local to this plugin.'}),
    button('Start editing current theme',()=>act(()=>{setEditingSaved(false);setDraft(studio.begin(api));draftMode.current=api.resolvedMode;setMessage('Editing '+api.themeName+' ('+api.resolvedMode+').');})),
    draft && jsx('div',{children:[
      jsx('p',{children:'Click an area of the preview, or select a color from the list. The preview is an approximation; actual surfaces, glass, and shared colors can look different.'}),
      jsx('div',{style:{display:'flex',minHeight:200,border:'1px solid var(--ui-stroke-secondary)',borderRadius:8,overflow:'hidden',maxWidth:650,background:palette.background,color:palette.foreground},children:[
        jsx('button',{type:'button','aria-label':'Select sessions sidebar tint',onClick:()=>setSelected('sessionsSidebarBackground'),style:{width:'27%',background:draft.sessionsSidebarBackground || palette.sidebarBackground || palette.muted || palette.background,color:palette.foreground,border:0,borderRight:'1px solid var(--ui-stroke-secondary)',padding:14,textAlign:'left',cursor:'pointer'},children:['Chats',jsx('div',{style:{marginTop:20,color:palette.primary},children:'● Current chat'})]}),
        jsx('div',{style:{flex:1,padding:16},children:[
          jsx('button',{type:'button','aria-label':'Select conversation background',onClick:()=>setSelected('chatBackground'),style:{display:'block',width:'100%',padding:10,background:draft.chatBackground || palette.background,color:palette.foreground,border:'1px dashed currentColor',cursor:'pointer'},children:'Chat background'}),
          jsx('button',{type:'button','aria-label':'Select main text color',onClick:()=>setSelected('foreground'),style:{display:'block',marginTop:12,background:'transparent',color:palette.foreground,border:0,cursor:'pointer'},children:'Hello! Click this text to customize it.'}),
          jsx('button',{type:'button','aria-label':'Select your message bubble tint',onClick:()=>setSelected('userBubble'),style:{display:'block',margin:'12px 0 0 auto',padding:10,border:'1px solid '+(palette.userBubbleBorder || palette.border || 'transparent'),borderRadius:10,background:palette.userBubble || palette.muted || palette.background,color:palette.foreground,cursor:'pointer'},children:'Your message bubble'}),
          jsx('button',{type:'button','aria-label':'Select panel header / primary accent (shared)',onClick:()=>setSelected('primary'),style:{marginTop:12,padding:'6px 12px',background:palette.primary,color:palette.primaryForeground || palette.background,border:0,borderRadius:5,cursor:'pointer'},children:'Accent'})
        ]})
      ]}),
      jsx('div',{style:{display:'flex',flexWrap:'wrap',gap:6},children:mainColors.map(k=>colorButton(k))}),
      jsx('details',{children:[jsx('summary',{children:'Advanced shared color tokens'}),jsx('p',{children:'These shared tokens may affect multiple UI elements and may not appear in the preview.'}),jsx('div',{style:{display:'flex',flexWrap:'wrap',gap:6},children:advancedColors.map(k=>colorButton(k))})]}),
      jsx('p',{children:[labels[selected],' ',jsx('input',{type:'color',value:color,onChange:e=>act(()=>setDraft(studio.edit(selected,e.target.value,api))), 'aria-label':'Color for '+labels[selected]}),' ',button('Reset selected color',()=>act(()=>setDraft(studio.resetItem(selected,api))))]}),
      selectedValue && !/^#[0-9a-f]{6}$/i.test(selectedValue) ? jsx('p',{children:'Current value: '+selectedValue+'. This is not a six-digit RGB color; the picker shows a placeholder, not the current color.'}) : !selectedValue ? jsx('p',{children:'This token uses a theme fallback; the picker shows a placeholder, not the current color.'}) : null,
      jsx('div',{style:{display:'flex',gap:8,flexWrap:'wrap'},children:[button('Revert preview',()=>act(()=>{setDraft(studio.revert(api));setMessage('Preview reverted.');})),button('Reset to original',()=>act(()=>{setDraft(studio.reset(api));setMessage('Original colors previewed.');}))]}),
      jsx('p',{children:[jsx('input',{value:name,onChange:e=>setName(e.target.value),placeholder:'Name this theme',maxLength:80,'aria-label':'Theme name'}),' ',button('Save as copy',()=>act(()=>{const id=studio.save(name,api);setSaved(studio.list(api));setChoice(id);setMessage('Saved a copy. Apply it when ready.');})), ' ', editingSaved && button('Save changes',()=>act(()=>{studio.saveChanges(name,api);setSaved(studio.list(api));setMessage('Saved changes.');}))]})
    ]}),
    jsx('div',{children:[jsx('select',{value:choice,onChange:e=>setChoice(e.target.value),'aria-label':'Saved theme',children:[jsx('option',{value:'',children:'Choose a saved theme'}),...saved.map(t=>jsx('option',{value:t.name,children:t.label},t.name))]}),' ',button('Apply saved theme',()=>act(()=>{studio.apply(choice,api);setDraft(null);setMessage('Applied. Use the theme picker to return to an earlier theme.');}),!choice), ' ', button('Edit saved theme',()=>act(()=>{const d=studio.beginSaved(choice,api);setEditingSaved(true);setDraft(d);setName(d.label);draftMode.current=api.resolvedMode;setMessage('Editing saved theme.');}),!choice), ' ', button('Delete saved theme',()=>act(()=>{if (!window.confirm('Delete this theme? Other profiles may use it; their assignments cannot be checked. You can undo during this session.')) return;studio.remove(choice,api);setSaved(studio.list(api));setChoice('');setDraft(null);setEditingSaved(false);setMessage('Deleted. Undo is available in this session.');}),!choice), ' ', button('Undo deletion',()=>act(()=>{const id=studio.undoDelete(api);setSaved(studio.list(api));setChoice(id);setMessage('Deletion undone.');}))]}),
    button('Restore previous theme',()=>act(()=>{studio.restore(api);setDraft(null);setMessage('Restored previous theme.');})),
    jsx('p',{role:'status','aria-label':'Theme status',children:message}),
    jsx('p',{children:'Saved designs follow the focused chat owner (connection and profile). Apply and restore require that owner to match the active gateway profile. Preview and applied appearance paint the desktop window; contributed themes also appear in the global picker. Switching chat focus does not create a per-chat theme.'}),
    jsx('p',{children:'Sessions sidebar color is independent. In glass mode it adds a 30% tint over the existing material; the displayed color will vary with the backdrop and tint settings. Chat background is independent and applies in both modes outside glass mode; glass mode keeps its original appearance. Sidebar and menu backgrounds share a semantic token used in multiple surfaces. The panel header / primary accent is a shared primary token and also affects other surfaces. The working-session indicator and other interactive areas share an accent token. Other colors are shared semantic tokens. The editor copies the currently painted palette, not the original full light/dark theme; switching modes may not preserve the original appearance. The picker accepts six-digit RGB; existing non-hex values remain unchanged until edited.'}),
    jsx(MarkerPage,{ctx,events:markerEvents})
  ]});
}

const states = { unread: ['Finished, unread','bg-(--ui-success)'], working: ['Working','bg-(--ui-accent)'], input: ['Needs input','bg-amber-500'] };
const markerScopeFor = (connection, profile) => typeof connection === 'string' && connection.trim() && typeof profile === 'string' && profile.trim() ? JSON.stringify([connection, profile]) : null;
const goodIcon = s => typeof s === 'string' && [...s].length <= 16 && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(s);
const goodColor = s => typeof s === 'string' && (s === '' || /^#[0-9a-f]{6}$/i.test(s));
const escapeText = s => [...s].map(c => '\\' + c.codePointAt(0).toString(16) + ' ').join('');
export function markerCSS(config) {
  if (!config || typeof config !== 'object') return '';
  return Object.entries(states).map(([key, [,klass]]) => {
    const item = config[key];
    if (!item || item.enabled !== true || !goodIcon(item.icon) || !goodColor(item.color)) return '';
    const selector = '[data-tour="sessions-sidebar"][data-slot="sidebar"] .row-hover span.flex.items-center[class~="gap-0.5"] > span[role="status"][class~="' + klass + '"]';
    if (!item.icon) return item.color ? selector+'{background-color:'+item.color+' !important}' : '';
    return selector+'{background:transparent !important;width:1rem !important;height:1rem !important;display:inline-flex;align-items:center;justify-content:center;overflow:visible}'+selector+'::after{content:"'+escapeText(item.icon)+'";font-size:14px;line-height:1;'+(item.color ? 'color:'+item.color+';' : '')+'}';
  }).join('\n');
}
function read(ctx,scope) { const all = ctx.storage.get('markers-v1', {}); return all && typeof all === 'object' && !Array.isArray(all) && scope && all[scope] && typeof all[scope] === 'object' ? all[scope] : {}; }
function ScopeStyle({ctx,events}) {
  const connection=useValue(host.state.connectionId), profile=useValue(host.state.profile), scope=markerScopeFor(connection,profile);
  useEffect(()=>{ const el=document.createElement('style'); el.dataset.themeStudioSessionMarkers=''; document.head.appendChild(el); const update=()=>{el.textContent=markerCSS(read(ctx,scope));}; events.addEventListener('change',update); update(); return ()=>{events.removeEventListener('change',update);el.remove();}; },[ctx,events,scope]);
  return null;
}
function MarkerPage({ctx,events}) {
  const connection=useValue(host.state.connectionId), profile=useValue(host.state.profile), scope=markerScopeFor(connection,profile);
  const [draft,setDraft]=useState({}), [message,setMessage]=useState('');
  useEffect(()=>{setDraft(read(ctx,scope));setMessage('');},[ctx,scope]);
  const edit=(key,field,value)=>setDraft(old=>({...old,[key]:{enabled:false,icon:'',color:'',...old[key],[field]:value}}));
  const save=()=>{ try {
    if (!scope || markerScopeFor(host.state.connectionId.get(),host.state.profile.get()) !== scope) throw Error('Active connection and profile are required.');
    for (const key of Object.keys(states)) { const v=draft[key]; if (v && (typeof v.enabled !== 'boolean' || !goodIcon(v.icon) || !goodColor(v.color))) throw Error('Use up to 16 Unicode characters, no controls, and a six-digit color.'); }
    const all=ctx.storage.get('markers-v1', {}); if (!all || typeof all !== 'object' || Array.isArray(all)) throw Error('Invalid stored settings; not overwritten.');
    const next={...all,[scope]:draft}; ctx.storage.set('markers-v1',next); if (JSON.stringify(ctx.storage.get('markers-v1',null)) !== JSON.stringify(next)) throw Error('Storage failed; settings not confirmed.'); events.dispatchEvent(new Event('change')); setMessage('Saved for the active connection and profile.');
  } catch(e) {setMessage(e.message);} };
  return jsx('section',{children:[jsx('h2',{children:'Session markers'}),jsx('p',{children:'Customize sidebar markers only. To insert an emoji on Windows, click a symbol box and press Windows key + period (.). Choose an emoji from the menu, then save your marker settings. Finished means unread completion, not a permanent completion badge. These internal CSS selectors may break after Hermes updates.'}),jsx('p',{children:'Settings follow the active gateway connection and profile and paint the whole sidebar, not individual tiled profiles. Emoji colors are controlled by your system font and may ignore the selected color.'}),...Object.entries(states).map(([key,[label]])=>{const v={enabled:false,icon:'',color:'',...draft[key]};return jsx('fieldset',{style:{margin:'12px 0',padding:10},children:[jsx('legend',{children:label}),jsx('label',{children:[jsx('input',{type:'checkbox',checked:v.enabled,onChange:e=>edit(key,'enabled',e.target.checked)}),' Customize']}),jsx('label',{style:{display:'block'},children:['Emoji or symbol (blank keeps dot) ',jsx('input',{value:v.icon,onChange:e=>edit(key,'icon',e.target.value),maxLength:32,'aria-label':label+' symbol'})]}),jsx('label',{style:{display:'block'},children:['Color (blank uses theme; #RRGGBB) ',jsx('input',{value:v.color,onChange:e=>edit(key,'color',e.target.value),maxLength:7,'aria-label':label+' color'}),jsx('input',{type:'color',value:/^#[0-9a-f]{6}$/i.test(v.color)?v.color:'#808080',onChange:e=>edit(key,'color',e.target.value),'aria-label':label+' color picker'})]}),jsx('div',{children:['Preview: ',jsx('span',{'aria-hidden':true,style:{color:goodColor(v.color)&&v.color?v.color:undefined},children:v.enabled && v.icon && goodIcon(v.icon)?v.icon:'●'}),' ',label]})]},key);}),jsx('button',{type:'button',onClick:save,disabled:!scope,children:'Save marker settings'}),jsx('p',{role:'status',children:message})]});
}

export default { id:'theme-studio', name:'Theme Studio', defaultEnabled:false, register(ctx) {
  const studio = createStudio(ctx);
  const markerEvents = new EventTarget();
  ctx.register({id:'marker-style',area:'statusBar.right',render:()=>jsx(ScopeStyle,{ctx,events:markerEvents})});
  ctx.register({id:'page',area:ROUTES_AREA,data:{path:'/theme-studio'},render:()=>jsx(Studio,{studio,ctx,markerEvents})});
  ctx.register({id:'nav',area:SIDEBAR_NAV_AREA,data:{path:'/theme-studio',label:'Theme Studio',codicon:'symbol-color'}});
} };
