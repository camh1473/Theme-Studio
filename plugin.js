import { THEMES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, useTheme, useValue, host } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { useState, useRef, useEffect } from 'react';

const copy = value => JSON.parse(JSON.stringify(value));
const normalizeLabel = label => label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const scopeFor = owner => owner && typeof owner.connectionId === 'string' && owner.connectionId.trim() && typeof owner.profile === 'string' && owner.profile.trim() ? JSON.stringify([owner.connectionId,owner.profile]) : null;
const keys = ['background','foreground','card','cardForeground','muted','mutedForeground','popover','popoverForeground','primary','primaryForeground','secondary','accent','accentForeground','border','input','ring','midground','composerRing','destructive','sidebarBackground','sidebarBorder','userBubble'];
const labels = {background:'App background tint',foreground:'Main text color (shared)',card:'Message box & card backgrounds (shared)',sidebarBackground:'Sidebar and menu backgrounds (shared)',userBubble:'Sent message background',chatBackground:'Conversation background (not glass)',sessionsSidebarBackground:'Sessions sidebar tint',sessionsSidebarForeground:'Sessions sidebar text (not shared)',primary:'Panel header / primary accent (shared)',midground:'Welcome title & interface accent (shared)',muted:'Muted surface token',popover:'Popover surface token',primaryForeground:'Primary accent text token',secondary:'Secondary surface token',accent:'Accent surface token',accentForeground:'Accent text token',border:'Shared border token',input:'Input surface token',ring:'Focus ring token',composerRing:'Composer focus ring token',destructive:'Destructive action token',sidebarBorder:'Sidebar border token'};
const mainColors = ['foreground','background','card','sidebarBackground','userBubble','chatBackground','sessionsSidebarBackground','sessionsSidebarForeground','primary','midground'];
const advancedColors = keys.filter(k => !mainColors.includes(k) && !['cardForeground','mutedForeground','popoverForeground'].includes(k));
const valid = t => t && typeof t.name === 'string' && /^theme-studio-[a-z0-9-]+$/.test(t.name) && typeof t.label === 'string' && t.colors && ['background','foreground','primary'].every(k => typeof t.colors[k] === 'string');
const addChatRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + '\n:root:not([data-hermes-glass]) [data-chat-surface] { --ui-chat-surface-background: ' + color + '; }'; return result; };

const addSessionsRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + `\n:root:not([data-hermes-glass]) [data-tour="sessions-sidebar"][data-slot="sidebar"] { --ui-sidebar-surface-background: ${color}; }\n:root[data-hermes-glass] [data-tour="sessions-sidebar"][data-slot="sidebar"] { background-color: color-mix(in srgb, ${color} var(--translucency-glass-keep, 100%), transparent); }`; return result; };
// Text-only override: every text color actually rendered inside the sessions
// sidebar (session titles, nav items, timestamps/meta, hover/active states,
// loading labels) resolves -- directly or by lazy var() indirection -- from
// one of these four custom properties (see styles.css: --ui-text-primary/
// secondary/tertiary/quaternary are each `color-mix(in srgb, var(--ui-base)
// N%, transparent)`, and --dt-foreground/--foreground/--color-foreground/
// the Tailwind `text-foreground` utility all chain through
// `var(--ui-text-primary)`). Overriding ONLY these four at this scope is
// deliberately narrower than overriding --ui-base itself: --ui-base also
// feeds --sidebar-edge-border and card/hover background mixes, which are
// not text and should keep tracking the shared theme foreground, not this
// sidebar-only text color. Same relative opacity steps as the global
// defaults (94/74/54/36%) so the existing primary/secondary/tertiary/
// quaternary text hierarchy inside the sidebar is preserved, just recolored.
// Applied unconditionally in both glass and non-glass mode: unlike a flat
// background fill, a text color has nothing to do with glass's native
// transparency, so there is no mode-gate to reason about here.
const addSessionsTextRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + `\n:root [data-tour="sessions-sidebar"][data-slot="sidebar"] { --ui-text-primary: color-mix(in srgb, ${color} 94%, transparent); --ui-text-secondary: color-mix(in srgb, ${color} 74%, transparent); --ui-text-tertiary: color-mix(in srgb, ${color} 54%, transparent); --ui-text-quaternary: color-mix(in srgb, ${color} 36%, transparent); }`; return result; };

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
  let saving = false;
  function noDuplicateLabel(label, scope, exceptId = null) {
    if (saved.some(x => x.scope === scope && x.theme.name !== exceptId && normalizeLabel(x.theme.label) === normalizeLabel(label))) throw Error('Name already exists; edit existing or use different name');
  }
  let baseline = null, draft = null, mode = 'light', previewDispose = null, previous = null, draftScope = null, chatEdited = false, sessionsEdited = false, sessionsTextEdited = false;
  const withChatCSS = theme => { let result = chatEdited ? addChatRule(theme, chatEdited) : copy(theme); if (sessionsEdited) result = addSessionsRule(result, sessionsEdited); if (sessionsTextEdited) result = addSessionsTextRule(result, sessionsTextEdited); if (bubbleEdited) result.customCSS = (result.customCSS || '') + `\n:root .composer-human-message { --dt-user-bubble: color-mix(in srgb, ${bubbleEdited} var(--user-bubble-keep, 100%), transparent); }`; return result; };
  const requireScope = api => { if (!api.scope || (api.currentScope && api.currentScope() !== api.scope)) throw Error('Active connection and profile are required, and focus must not change.'); return api.scope; };
  function clear(api) { if (previewDispose) { api.clearThemePreview(); previewDispose(); previewDispose = null; } }
  function begin(api) { editingId = null; const scope = requireScope(api); clear(api); chatEdited = false; sessionsEdited = false; sessionsTextEdited = false; bubbleEdited = false; mode = api.resolvedMode; baseline = copy(api.theme); if (mode === 'dark') baseline.darkColors = copy(api.theme.colors); else if (!baseline.darkColors) baseline.darkColors = copy(api.theme.colors); draft = copy(baseline); previous = api.themeName; draftScope = scope; return copy(draft); }
  function beginSaved(name, api) {
    const scope = requireScope(api); refresh(); const entry = saved.find(x => x.scope === scope && x.theme.name === name);
    if (!entry) throw Error('Theme is not saved for this connection and profile.');
    clear(api); chatEdited = false; sessionsEdited = false; sessionsTextEdited = false; bubbleEdited = false; mode = api.resolvedMode;
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
    if (normalizeLabel(saved[index].theme.label) !== normalizeLabel(label)) noDuplicateLabel(label, api.scope, editingId);
    const theme = {...withChatCSS(draft), name:editingId, label}; if (!valid(theme)) throw Error('Invalid theme.');
    const next = copy(saved); next[index] = {scope:api.scope,theme}; persist(next);
    const dispose = registrations.get(editingId);
    try { if (dispose) dispose(); registrations.delete(editingId); registrations.set(editingId, ctx.register({id:editingId,area:THEMES_AREA,data:copy(theme)})); }
    catch (e) { throw Error('Saved, but registration failed; reload the plugin.'); }
    baseline = copy(theme); draft = copy(theme); chatEdited = false; sessionsEdited = false; sessionsTextEdited = false; bubbleEdited = false; return editingId;
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
    requireDraft(api); if (!(keys.includes(key) || key === 'chatBackground' || key === 'sessionsSidebarBackground' || key === 'sessionsSidebarForeground') || !/^#[0-9a-f]{6}$/i.test(color)) throw Error('Invalid color.');
    if (key === 'sessionsSidebarBackground') { sessionsEdited = color; draft.sessionsSidebarBackground = color; paint(api); return copy(draft); }
    if (key === 'sessionsSidebarForeground') { sessionsTextEdited = color; draft.sessionsSidebarForeground = color; paint(api); return copy(draft); }
    if (key === 'chatBackground') { chatEdited = color; draft.chatBackground = color; paint(api); return copy(draft); }
    const field = mode === 'dark' ? 'darkColors' : 'colors';
    if (!draft[field]) draft[field] = copy(draft.colors);
    draft[field][key] = color; if (key === 'userBubble') bubbleEdited = color; paint(api); return copy(draft);
  }
  function resetItem(key, api) {
    requireDraft(api); if (!(keys.includes(key) || key === 'chatBackground' || key === 'sessionsSidebarBackground' || key === 'sessionsSidebarForeground')) throw Error('Invalid color.');
    if (key === 'sessionsSidebarBackground') { sessionsEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    if (key === 'sessionsSidebarForeground') { sessionsTextEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    if (key === 'chatBackground') { chatEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    const field = mode === 'dark' ? 'darkColors' : 'colors';
    const original = baseline[field] || baseline.colors; if (key === 'userBubble') bubbleEdited = false;
    if (!draft[field]) draft[field] = copy(draft.colors);
    if (Object.prototype.hasOwnProperty.call(original,key)) draft[field][key] = original[key]; else delete draft[field][key];
    paint(api); return copy(draft);
  }
  function revert(api) { clear(api); chatEdited = false; sessionsEdited = false; sessionsTextEdited = false; bubbleEdited = false; draft = baseline ? copy(baseline) : null; return draft && copy(draft); }
  function reset(api) { requireDraft(api); chatEdited = false; sessionsEdited = false; sessionsTextEdited = false; bubbleEdited = false; draft = copy(baseline); paint(api); return copy(draft); }
  function save(label, api) {
    if (saving) throw Error('Save already in progress.');
    saving = true;
    try {
    requireDraft(api);
    label = label.trim(); if (!draft || !label || label.length > 80) throw Error('Enter a name (1–80 characters).');
    refresh(); noDuplicateLabel(label, api.scope); let name; do { name = 'theme-studio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10); } while (saved.some(t => t.theme.name === name));
    const theme = {...withChatCSS(draft), name, label, description:'Saved in Theme Studio'};
    const next = [...saved, {scope:api.scope, theme}]; persist(next);
    try { registrations.set(name, ctx.register({id:name, area:THEMES_AREA, data:theme})); } catch(e) { throw Error('Saved, but registration failed; reload the plugin.'); } return name;
    } finally { saving = false; }
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

const ui = {
  section:{marginTop:28,paddingTop:22,borderTop:'1px solid var(--ui-stroke-secondary)'},
  heading:{fontSize:20,fontWeight:700,lineHeight:1.25,margin:'0 0 12px'},
  text:{fontSize:14,lineHeight:1.55,margin:'0 0 14px',color:'var(--ui-text-secondary)'},
  field:{boxSizing:'border-box',minHeight:38,maxWidth:'100%',padding:'8px 10px',border:'1px solid var(--ui-stroke-secondary)',borderRadius:6,background:'var(--ui-bg-editor)',color:'var(--ui-text-primary)',fontSize:14},
  button:{minHeight:38,padding:'8px 12px',border:'1px solid var(--ui-stroke-secondary)',borderRadius:6,background:'var(--ui-bg-editor)',color:'var(--ui-text-primary)',fontSize:14,fontWeight:600,cursor:'pointer'},
  label:{display:'block',fontSize:14,fontWeight:600,margin:'14px 0 6px'},
  details:{margin:'16px 0',fontSize:14,lineHeight:1.5},
  callout:{margin:'0 0 16px',padding:'12px 14px',border:'1px solid var(--ui-warning, #b58a1a)',borderRadius:8,background:'var(--ui-bg-editor)'},
};
function Studio({studio,ctx,markerEvents,bgImageEvents}) {
  const themeApi = useTheme(); const connection = useValue(host.state.connectionId); const profile = useValue(host.state.profile);
  const owner = useValue(host.state.focusedSessionOwner);
  const scope = scopeFor(owner); const activeScope = scopeFor({connectionId:connection,profile});
  const api = {...themeApi, scope, activeScope, currentScope:()=>scopeFor(host.state.focusedSessionOwner?.get()), currentActiveScope:()=>scopeFor({connectionId:host.state.connectionId.get(),profile:host.state.profile.get()})}; const apiRef = useRef(api); apiRef.current = api;
  const [glass,setGlass] = useState(() => document.documentElement.hasAttribute('data-hermes-glass'));
  useEffect(() => { const root = document.documentElement; const observer = new MutationObserver(() => setGlass(root.hasAttribute('data-hermes-glass'))); observer.observe(root,{attributes:true,attributeFilter:['data-hermes-glass']}); return () => observer.disconnect(); }, []);
  const [editingSaved,setEditingSaved] = useState(false); const [draft,setDraft] = useState(null); const [name,setName] = useState(''); const [selected,setSelected] = useState('background');
  const [copiedColor,setCopiedColor] = useState(null);
  const [saved,setSaved] = useState([]); const [choice,setChoice] = useState(''); const [message,setMessage] = useState('Choose Start editing to copy the current theme.');
  const [confirmation,setConfirmation] = useState('');
  const draftMode = useRef(null);
  useEffect(() => () => studio.revert(apiRef.current), [studio]);
  useEffect(() => { studio.revert(apiRef.current); draftMode.current = null; setDraft(null); setCopiedColor(null); setChoice(''); try { setSaved(api.scope ? studio.list(api) : []); } catch (e) { setSaved([]); setMessage(e.message); } }, [studio, api.scope]);
  useEffect(() => { if (draftMode.current && draftMode.current !== api.resolvedMode) { studio.revert(apiRef.current); draftMode.current = null; setDraft(null); setCopiedColor(null); setMessage('Mode changed; editing cancelled. Start editing again.'); } }, [studio, api.resolvedMode]);
  const act = fn => { try { fn(); } catch(e) { setConfirmation(''); setMessage(e.message); } };
  const palette = draft && (api.resolvedMode === 'dark' ? (draft.darkColors || draft.colors) : draft.colors);
  const draftKeys = ['chatBackground', 'sessionsSidebarBackground', 'sessionsSidebarForeground'];
  const selectedValue = draftKeys.includes(selected) ? draft?.[selected] : palette?.[selected];
  const color = /^#[0-9a-f]{6}$/i.test(selectedValue || '') ? selectedValue : '#808080';
  const canCopy = /^#[0-9a-f]{6}$/i.test(selectedValue || '');
  const canApplyCopy = !!copiedColor && copiedColor.scope === api.scope && copiedColor.mode === api.resolvedMode && copiedColor.source !== selected;
  const button = (label, onClick, disabled=false) => jsx('button',{type:'button',onClick,disabled,style:{...ui.button,opacity:disabled?0.5:1,cursor:disabled?'not-allowed':'pointer'},children:label});
  const colorButton = k => jsx('button',{type:'button',onClick:()=>setSelected(k),title:(draftKeys.includes(k) ? draft[k] : palette[k]) || 'Uses theme fallback',style:{...ui.button,textAlign:'left',border:k===selected?'2px solid var(--ui-accent)':'1px solid var(--ui-stroke-secondary)'},children:[jsx('span',{style:{display:'inline-block',width:14,height:14,marginRight:5,background:(draftKeys.includes(k) ? draft[k] : palette[k]) || 'transparent'}}),labels[k]]},k);
  return jsx('div',{style:{boxSizing:'border-box',padding:'24px clamp(16px, 4vw, 40px)',overflow:'auto',height:'100%',color:'var(--ui-text-primary)',fontSize:14,lineHeight:1.5,maxWidth:1000},children:[
    jsx('h1',{style:{fontSize:28,fontWeight:700,lineHeight:1.2,margin:'0 0 8px'},children:'Theme Studio'}),
    jsx('p',{style:ui.text,children:'Edit a copy of the current theme. Preview is temporary; saved themes are local to this plugin.'}),
    button('Start editing current theme',()=>act(()=>{setEditingSaved(false);setDraft(studio.begin(api));draftMode.current=api.resolvedMode;setMessage('Editing '+api.themeName+' ('+api.resolvedMode+').');})),
    draft && jsx('section',{style:ui.section,children:[jsx('h2',{style:ui.heading,children:'Edit colors'}),
      jsx('p',{style:ui.text,children:'Click an area of the preview, or select a color from the list. The preview is an approximation; actual surfaces, glass, and shared colors can look different.'}),
      jsx('div',{style:{display:'flex',minHeight:200,border:'1px solid var(--ui-stroke-secondary)',borderRadius:8,overflow:'hidden',maxWidth:650,backgroundColor:palette.background,backgroundImage:glass ? 'linear-gradient(color-mix(in srgb, var(--ui-bg-chrome) var(--translucency-glass-keep, 100%), transparent), color-mix(in srgb, var(--ui-bg-chrome) var(--translucency-glass-keep, 100%), transparent))' : 'none',color:palette.foreground},children:[
        jsx('button',{type:'button','aria-label':'Select sessions sidebar tint',onClick:()=>setSelected('sessionsSidebarBackground'),style:{width:'27%',background:glass ? 'color-mix(in srgb, '+(draft.sessionsSidebarBackground || 'transparent')+' var(--translucency-glass-keep, 100%), transparent)' : (draft.sessionsSidebarBackground || palette.sidebarBackground || palette.muted || palette.background),color:draft.sessionsSidebarForeground || palette.foreground,border:0,borderRight:'1px solid var(--ui-stroke-secondary)',padding:14,textAlign:'left',cursor:'pointer'},children:[jsx('span',{onClick:e=>{e.stopPropagation();setSelected('sessionsSidebarForeground');},'aria-label':'Select sessions sidebar text color',children:'Chats'}),jsx('div',{style:{marginTop:20,color:palette.primary},children:'● Current chat'})]}),
        jsx('div',{style:{flex:1,padding:16},children:[
          jsx('button',{type:'button','aria-label':'Select conversation background',onClick:()=>setSelected('chatBackground'),style:{display:'block',width:'100%',padding:10,background:draft.chatBackground || palette.background,color:palette.foreground,border:'1px dashed currentColor',cursor:'pointer'},children:'Chat background'}),
          jsx('button',{type:'button','aria-label':'Select main text color',onClick:()=>setSelected('foreground'),style:{display:'block',marginTop:12,background:'transparent',color:palette.foreground,border:0,cursor:'pointer'},children:'Hello! Click this text to customize it.'}),
          jsx('button',{type:'button','aria-label':'Select your message bubble tint',onClick:()=>setSelected('userBubble'),style:{display:'block',margin:'12px 0 0 auto',padding:10,border:'1px solid '+(palette.border || 'transparent'),borderRadius:10,background:palette.userBubble || palette.muted || palette.background,color:palette.foreground,cursor:'pointer'},children:'Your message bubble'}),
          jsx('button',{type:'button','aria-label':'Select panel header / primary accent (shared)',onClick:()=>setSelected('primary'),style:{marginTop:12,padding:'6px 12px',background:palette.primary,color:palette.primaryForeground || palette.background,border:0,borderRadius:5,cursor:'pointer'},children:'Accent'})
        ]})
      ]}),
      jsx('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginTop:16},children:mainColors.map(k=>colorButton(k))}),
      jsx('details',{style:ui.details,children:[jsx('summary',{style:{fontWeight:600,cursor:'pointer',width:'fit-content'},children:'Advanced shared color tokens'}),jsx('p',{children:'These shared tokens may affect multiple UI elements and may not appear in the preview.'}),jsx('div',{style:{display:'flex',flexWrap:'wrap',gap:6},children:advancedColors.map(k=>colorButton(k))})]}),
      jsx('p',{style:{...ui.label,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'},children:[labels[selected],' ',jsx('input',{style:{...ui.field,width:54,padding:3},type:'color',value:color,onChange:e=>act(()=>setDraft(studio.edit(selected,e.target.value,api))), 'aria-label':'Color for '+labels[selected]}),' ',button('Reset selected color',()=>act(()=>setDraft(studio.resetItem(selected,api))))]}),
      selected === 'sessionsSidebarBackground' && jsx('p',{style:ui.text,children:'Selected tint: '+(selectedValue || 'not set (theme fallback)')+'. Rendered sample: '+(glass ? 'approximation using the native glass tint setting over the window tint and a simulated backdrop; native glass and wallpaper differ.' : 'approximation in non-glass mode.') }),
      selected === 'sessionsSidebarForeground' && jsx('p',{style:ui.text,children:'Selected text color: '+(selectedValue || 'not set (uses the shared main text color)')+'. This recolors session titles, nav labels, timestamps, and hover/active text inside the Sessions sidebar only — it does not affect the main chat/conversation text, which keeps using the shared Main text color. Caveat: this color and the Sessions sidebar tint above are each independently editable, so nothing guarantees they stay readable together — pick a text color with enough contrast against your chosen (or default) sidebar background yourself.'}),
      selectedValue && !/^#[0-9a-f]{6}$/i.test(selectedValue) ? jsx('p',{children:'Current value: '+selectedValue+'. This is not a six-digit RGB color; the picker shows a placeholder, not the current color.'}) : !selectedValue ? jsx('p',{children:'This token uses a theme fallback; the picker shows a placeholder, not the current color.'}) : null,
      jsx('div',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'},children:[button('Copy color',()=>act(()=>{if (!api.scope || api.currentScope() !== api.scope || draftMode.current !== api.resolvedMode || !canCopy) throw Error('Cannot copy: focus, mode, or color changed.'); setCopiedColor({value:selectedValue,source:selected,scope:api.scope,mode:api.resolvedMode});}),!canCopy),button('Apply copied color',()=>act(()=>{if (!canApplyCopy || api.currentScope() !== api.scope || draftMode.current !== api.resolvedMode) throw Error('Cannot apply: focus or mode changed.'); setDraft(studio.edit(selected,copiedColor.value,api));}),!canApplyCopy),jsx('span',{'aria-live':'polite',children:copiedColor ? 'Copied color: '+copiedColor.value+' from '+labels[copiedColor.source]+(copiedColor.source === selected ? ' — select a different target.' : '') : 'No copied color. Copy a six-digit hex color, then select a different target.'})]}),
      !canCopy && jsx('p',{style:ui.text,children:'Copy unavailable: the selected value is unset or is not a six-digit hex color. Choose a color first.'}),
      jsx('div',{style:{display:'flex',gap:8,flexWrap:'wrap'},children:[button('Revert preview',()=>act(()=>{setDraft(studio.revert(api));setMessage('Preview reverted.');})),button('Reset to original',()=>act(()=>{setDraft(studio.reset(api));setMessage('Original colors previewed.');}))]}),
      jsx('div',{children:[jsx('label',{style:ui.label,htmlFor:'studio-theme-name',children:'Theme name'}),jsx('input',{id:'studio-theme-name',style:ui.field,value:name,onChange:e=>setName(e.target.value),placeholder:'Name this theme',maxLength:80,'aria-label':'Theme name'}),' ',button('Save as copy',()=>act(()=>{const id=studio.save(name,api);setSaved(studio.list(api));setChoice(id);setMessage('Saved a copy. Apply it when ready.');setConfirmation('Theme copy saved. You can apply it when ready.');})), ' ', editingSaved && button('Save changes',()=>act(()=>{studio.saveChanges(name,api);setSaved(studio.list(api));setMessage('Saved changes.');setConfirmation('Theme changes saved.');}))]})
    ]}),
    jsx('section',{style:ui.section,children:[jsx('h2',{style:ui.heading,children:'Saved themes'}),jsx('label',{style:ui.label,htmlFor:'studio-saved-theme',children:'Saved theme'}),jsx('select',{id:'studio-saved-theme',style:ui.field,value:choice,onChange:e=>setChoice(e.target.value),'aria-label':'Saved theme',children:[jsx('option',{value:'',children:'Choose a saved theme'}),...saved.map(t=>jsx('option',{value:t.name,children:t.label},t.name))]}),' ',button('Apply saved theme',()=>act(()=>{studio.apply(choice,api);setDraft(null);setMessage('Applied. Use the theme picker to return to an earlier theme.');}),!choice), ' ', button('Edit saved theme',()=>act(()=>{const d=studio.beginSaved(choice,api);setEditingSaved(true);setDraft(d);setName(d.label);draftMode.current=api.resolvedMode;setMessage('Editing saved theme.');}),!choice), ' ', button('Delete saved theme',()=>act(()=>{if (!window.confirm('Delete this theme? Other profiles may use it; their assignments cannot be checked. You can undo during this session.')) return;studio.remove(choice,api);setSaved(studio.list(api));setChoice('');setDraft(null);setEditingSaved(false);setMessage('Deleted. Undo is available in this session.');}),!choice), ' ', button('Undo deletion',()=>act(()=>{const id=studio.undoDelete(api);setSaved(studio.list(api));setChoice(id);setMessage('Deletion undone.');}))]}),
    button('Restore previous theme',()=>act(()=>{studio.restore(api);setDraft(null);setMessage('Restored previous theme.');})),
    jsx('p',{role:'status','aria-label':'Theme status',children:message}),
    confirmation && jsx('div',{role:'status','aria-label':'Save confirmation',style:{position:'fixed',bottom:24,right:24,zIndex:9999,padding:16,border:'1px solid var(--ui-stroke-secondary)',borderRadius:8,background:'var(--ui-bg-editor)',color:'var(--ui-text-primary)',boxShadow:'0 4px 16px #0005'},children:[jsx('span',{children:confirmation}), ' ',button('Dismiss confirmation',()=>setConfirmation(''))]}),
    jsx('details',{style:ui.details,children:[jsx('summary',{style:{fontWeight:600,cursor:'pointer'},children:'How themes and preview work'}),jsx('p',{style:ui.text,children:'Saved designs follow the focused chat owner (connection and profile). Apply and restore require that owner to match the active gateway profile. Preview and applied appearance paint the desktop window; contributed themes also appear in the global picker. Switching chat focus does not create a per-chat theme.'}),
    jsx('p',{children:'Sessions sidebar color is independent. In glass mode it layers the chosen color over the existing material using the native glass transparency setting; the displayed color will vary with the backdrop and tint settings. Sessions sidebar text is also independent of the shared main text color and applies in both glass and non-glass mode; since the sidebar background tint is independently customizable too, pick colors with enough contrast for your own setup. Chat background is independent and applies in both modes outside glass mode; glass mode keeps its original appearance. Sidebar and menu backgrounds share a semantic token used in multiple surfaces. The panel header / primary accent is a shared primary token and also affects other surfaces. The working-session indicator and other interactive areas share an accent token. Other colors are shared semantic tokens. The editor copies the currently painted palette, not the original full light/dark theme; switching modes may not preserve the original appearance. The picker accepts six-digit RGB; existing non-hex values remain unchanged until edited.'})]}),
    jsx(MarkerPage,{ctx,events:markerEvents}),
    jsx(SoundPage,{ctx}),
    jsx(BackgroundImagePage,{ctx,events:bgImageEvents})
  ]});
}

const states = { unread: ['Finished, unread','bg-(--ui-success)'], working: ['Working','bg-(--ui-accent)'], input: ['Needs input','bg-amber-500'], background: ['Background work / sub-agent','border-(--ui-text-tertiary)'] };
// Only consumer left: handleSoundCompletionEvent, which deliberately scopes
// by the completion EVENT's own (connection, profile) rather than UI focus
// -- see that function's comment. The UI-facing marker/sound settings pages
// and the marker CSS injector (ScopeStyle/MarkerPage/SoundPage) resolve scope
// via focusedSessionOwner + scopeFor() instead (see Studio's own scopeFor
// usage), producing the IDENTICAL JSON key shape, so existing stored data
// under either resolver reads back unchanged.
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
    if (!item.icon) return item.color ? selector+'{'+(key === 'background' ? 'border-color:' : 'background-color:')+item.color+' !important}' : '';
    return selector+'{background:transparent !important;'+(key === 'background' ? 'border-color:transparent !important;' : '')+'width:1rem !important;height:1rem !important;display:inline-flex;align-items:center;justify-content:center;overflow:visible}'+selector+'::after{content:"'+escapeText(item.icon)+'";font-size:14px;line-height:1;'+(item.color ? 'color:'+item.color+';' : '')+'}';
  }).join('\n');
}
function read(ctx,scope) { const all = ctx.storage.get('markers-v1', {}); return all && typeof all === 'object' && !Array.isArray(all) && scope && all[scope] && typeof all[scope] === 'object' ? all[scope] : {}; }

// ---- Notification sound (per connection+profile) ----
// Small bank of synthesized chime presets (Web Audio oscillators), a
// "Custom URL" alternative (HTMLAudioElement), and "None". Settings are
// scoped by (connectionId, profile) using the same key shape as session
// markers (markerScopeFor), reused here rather than duplicated.
export const SOUND_PRESETS = [
  {id:'chime', label:'Soft chime', notes:[{freq:659.25,dur:0.22},{freq:880,dur:0.26,start:0.09}]},
  {id:'ping', label:'Glass ping', notes:[{freq:1046.5,dur:0.3}]},
  {id:'pop', label:'Pop', notes:[{freq:440,dur:0.08},{freq:220,dur:0.1,start:0.06}]},
  {id:'bell', label:'Bell', notes:[{freq:523.25,dur:0.55},{freq:659.25,dur:0.45,start:0.02}]},
  {id:'blip', label:'Alert blip', notes:[{freq:988,dur:0.1},{freq:988,dur:0.1,start:0.16}]},
];
// Windows default system sounds (C:\Windows\Media\*.wav). Enumerated once from
// a live Windows 11 machine (dir listing, Apr 2024 build); filenames vary by
// Windows version but this directory and extension are stable across 10/11.
// Each preset id is 'win:<filename>' so soundOptionIds/validSoundSettings can
// validate it like any other preset without a separate field. We never read
// or embed the .wav bytes here — only the filename (tiny, storage-safe) is
// ever persisted; the actual bytes are fetched on demand at play time (see
// resolveWindowsSoundDataUrl) and cached only in memory for this session.
export const WINDOWS_MEDIA_DIR = 'C:\\Windows\\Media\\';
export const WINDOWS_SOUND_PRESETS = [
  'Alarm01.wav','Alarm02.wav','Alarm03.wav','Alarm04.wav','Alarm05.wav','Alarm06.wav','Alarm07.wav','Alarm08.wav','Alarm09.wav','Alarm10.wav',
  'chimes.wav','chord.wav','ding.wav','notify.wav','recycle.wav','ringout.wav',
  'Ring01.wav','Ring02.wav','Ring03.wav','Ring04.wav','Ring05.wav','Ring06.wav','Ring07.wav','Ring08.wav','Ring09.wav','Ring10.wav',
  'Speech Disambiguation.wav','Speech Misrecognition.wav','Speech Off.wav','Speech On.wav','Speech Sleep.wav','tada.wav',
  'Windows Background.wav','Windows Balloon.wav','Windows Battery Critical.wav','Windows Battery Low.wav',
  'Windows Critical Stop.wav','Windows Default.wav','Windows Ding.wav','Windows Error.wav','Windows Exclamation.wav',
  'Windows Feed Discovered.wav','Windows Foreground.wav','Windows Hardware Fail.wav','Windows Hardware Insert.wav',
  'Windows Hardware Remove.wav','Windows Information Bar.wav','Windows Logoff Sound.wav','Windows Logon.wav',
  'Windows Menu Command.wav','Windows Message Nudge.wav','Windows Minimize.wav','Windows Navigation Start.wav',
  'Windows Notify.wav','Windows Notify Calendar.wav','Windows Notify Email.wav','Windows Notify Messaging.wav',
  'Windows Notify System Generic.wav','Windows Pop-up Blocked.wav','Windows Print complete.wav','Windows Proximity Connection.wav',
  'Windows Proximity Notification.wav','Windows Recycle.wav','Windows Restore.wav','Windows Ringin.wav','Windows Ringout.wav',
  'Windows Shutdown.wav','Windows Startup.wav','Windows Unlock.wav','Windows User Account Control.wav'
].map(file => ({id:'win:'+file, label:'Windows: '+file.replace(/\.wav$/i,''), file}));
// 'file' is a genuine local-file picker slot, distinct from the existing
// 'custom' (URL) slot: it stores a filesystem PATH (via ctx.os.pickOpenPath,
// never bytes) and is played the same way as the Windows presets, through
// hermes-media://. Both 'custom' and 'file' coexist; neither replaces the
// other.
const soundOptionIds = ['none', ...SOUND_PRESETS.map(p => p.id), ...WINDOWS_SOUND_PRESETS.map(p => p.id), 'custom', 'file'];
export const DEFAULT_SOUND_SETTINGS = {presetId:'none', customUrl:'', customPath:'', volume:50};
export function clampVolume(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50; }
export function validSoundSettings(s) {
  // customPath is new (the local-file picker); entries saved before this
  // change have no such field at all, so it must be optional here -- a
  // missing customPath on an old 'custom'/'win:*'/synthesized entry must
  // not invalidate that user's existing saved sound settings.
  return !!s && typeof s === 'object' && soundOptionIds.includes(s.presetId)
    && typeof s.customUrl === 'string' && s.customUrl.length <= 500
    && (s.customPath === undefined || (typeof s.customPath === 'string' && s.customPath.length <= 1000))
    && Number.isInteger(s.volume) && s.volume >= 0 && s.volume <= 100
    && (s.presetId !== 'custom' || /^(https?:|data:)/i.test(s.customUrl))
    && (s.presetId !== 'file' || (typeof s.customPath === 'string' && s.customPath.length > 0));
}
function scheduleTone(ac, dest, freq, dur, start) {
  const osc = ac.createOscillator(); const env = ac.createGain();
  const t0 = ac.currentTime + (start || 0);
  osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.9, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env); env.connect(dest);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
// Pure and injectable: callers pass an AudioContext-like `ac`, so this is
// fully testable without real Web Audio. Volume 0 (or no context) plays
// nothing and touches no audio nodes.
export function playPresetTone(presetId, volumePct, ac) {
  const preset = SOUND_PRESETS.find(p => p.id === presetId);
  const vol = clampVolume(volumePct) / 100;
  if (!preset || !ac || vol <= 0) return false;
  const master = ac.createGain();
  master.gain.setValueAtTime(vol, ac.currentTime);
  master.connect(ac.destination);
  preset.notes.forEach(n => scheduleTone(ac, master, n.freq, n.dur, n.start));
  return true;
}
// `makeAudio` is injectable so tests never touch a real HTMLAudioElement.
export function playCustomUrl(url, volumePct, makeAudio) {
  const vol = clampVolume(volumePct) / 100;
  if (!url || vol <= 0) return false;
  const audio = (makeAudio || (u => new Audio(u)))(url);
  audio.volume = vol;
  const result = audio.play && audio.play();
  if (result && typeof result.catch === 'function') result.catch(() => {});
  return true;
}
// ---- Local file playback via the hermes-media:// protocol ----
// Electron registers a privileged 'hermes-media' scheme (MEDIA_PROTOCOL in
// apps/desktop/electron/media-protocol.ts, registered with
// protocol.registerSchemesAsPrivileged + handled via registerMediaProtocol()
// in apps/desktop/electron/main.ts, lines ~1847-1861). It streams a LOCAL
// FILE BY PATH with Range support (createMediaProtocolHandler's 'stream'
// mode -> dependencies.resolveLocalFile + fetchLocal) and already allowlists
// .mp3/.wav (STREAMABLE_MEDIA_EXTENSIONS in media-protocol.ts). The app's own
// renderer builds exactly this URL for local audio/video — see
// apps/desktop/src/lib/media.ts:296, `mediaStreamUrl`:
//   `hermes-media://stream/${encodeURIComponent(filePathFromMediaPath(path))}`
// This is the officially-registered, documented mechanism: it never reads
// file bytes into the plugin, never touches ctx.storage with blobs, and
// isn't gated by Electron's webSecurity file:// block (see media.remote.test.ts
// fixture: encodeURIComponent('C:' + String.fromCharCode(92) + 'renders' +
// String.fromCharCode(92) + 'demo.mp4') -> 'C%3A%5Crenders%5Cdemo.mp4' --
// colon becomes %3A and backslash becomes %5C; decodeURIComponent on the
// main-process side restores the exact original path string, so this is
// plain percent-encoding, not OS-specific path logic). Unlike
// the old window.hermesDesktop.readFileDataUrl bridge this used to go through,
// hermes-media:// playback is synchronous from the plugin's point of view —
// no IPC round trip is needed before handing the URL to Audio().
export function hermesMediaStreamUrl(filePath) { return 'hermes-media://stream/' + encodeURIComponent(filePath); }
export function windowsSoundPath(file) { return WINDOWS_MEDIA_DIR + file; }
export function windowsSoundMediaUrl(file) { return hermesMediaStreamUrl(windowsSoundPath(file)); }
// Mirrors playCustomUrl's contract (plain boolean, never throws) now that no
// async IPC resolution step is needed to get a playable URL.
export function playWindowsSoundPreset(file, volumePct, opts) {
  opts = opts || {};
  if (!file) return false;
  return playCustomUrl(windowsSoundMediaUrl(file), volumePct, opts.makeAudio);
}
// Same mechanism for a user-picked local file path (see playLocalFilePath /
// the 'file' presetId below): any absolute path, played the same way.
export function playLocalFilePath(filePath, volumePct, opts) {
  opts = opts || {};
  if (!filePath) return false;
  return playCustomUrl(hermesMediaStreamUrl(filePath), volumePct, opts.makeAudio);
}
let sharedAudioContext = null;
let sharedAudioContextCtor = null;
// Re-checks the constructor identity (not just truthiness) before reusing the
// cache: a stale instance from a swapped-out AudioContext implementation
// (hot reload, or a test that installs its own fake) must never be replayed.
function getSharedAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext || sharedAudioContextCtor !== Ctor) {
    try { sharedAudioContext = new Ctor(); sharedAudioContextCtor = Ctor; } catch (e) { return null; }
  }
  if (sharedAudioContext.state === 'suspended' && sharedAudioContext.resume) { try { sharedAudioContext.resume().catch(() => {}); } catch (e) {} }
  return sharedAudioContext;
}
// Single entry point used by both the preview button and the gateway-event
// handler, so both paths apply "None"/volume-0 silence identically.
// Always returns a plain boolean synchronously now: the Windows presets and
// the local-file-picker path both resolve to a hermes-media:// URL without
// any async IPC step, so there is no longer a thenable case to special-case.
export function playSoundSettings(settings, opts) {
  opts = opts || {};
  if (!settings || !settings.presetId || settings.presetId === 'none') return false;
  const volumePct = clampVolume(settings.volume);
  if (volumePct <= 0) return false;
  if (settings.presetId === 'custom') {
    if (!settings.customUrl) return false;
    return playCustomUrl(settings.customUrl, volumePct, opts.makeAudio);
  }
  if (settings.presetId === 'file') {
    if (!settings.customPath) return false;
    return playLocalFilePath(settings.customPath, volumePct, opts);
  }
  if (typeof settings.presetId === 'string' && settings.presetId.startsWith('win:')) {
    return playWindowsSoundPreset(settings.presetId.slice(4), volumePct, opts);
  }
  const ac = opts.audioContext || getSharedAudioContext();
  return playPresetTone(settings.presetId, volumePct, ac);
}
// ---- One-time (dismissible, per-scope) "set core sound to None" reminder ----
// Core's completion sound (lib/completion-sound.ts) is a single global
// nanostore atom cached at startup: there is no per-profile hook and no safe
// way for a plugin to mute it live (and writing its localStorage key
// wouldn't take effect without a restart, and would also mute it for every
// OTHER profile). This is a pure UI stopgap: a visible, dismissible nudge,
// not an attempt to touch the core setting.
export const NOTIFICATION_SETTINGS_PATH = '/settings?tab=notifications&setting=notifications.completion-sound';
export function openNotificationSettings() {
  if (typeof host !== 'undefined' && host && typeof host.navigate === 'function') { host.navigate(NOTIFICATION_SETTINGS_PATH); return true; }
  return false;
}
export function readSoundReminderDismissed(ctx, scope) {
  const all = ctx.storage.get('sound-reminder-dismissed-v1', {});
  return !!(all && typeof all === 'object' && !Array.isArray(all) && scope && all[scope]);
}
export function dismissSoundReminder(ctx, scope) {
  if (!scope) throw Error('Active connection and profile are required.');
  const all = ctx.storage.get('sound-reminder-dismissed-v1', {});
  const base = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  const next = {...base, [scope]: true};
  ctx.storage.set('sound-reminder-dismissed-v1', next);
  return next;
}
export function readSoundSettings(ctx, scope) {
  const all = ctx.storage.get('sound-settings-v1', {});
  const entry = all && typeof all === 'object' && !Array.isArray(all) && scope ? all[scope] : null;
  return validSoundSettings(entry) ? {...DEFAULT_SOUND_SETTINGS, ...entry} : {...DEFAULT_SOUND_SETTINGS};
}
export function saveSoundSettings(ctx, scope, settings) {
  if (!scope) throw Error('Active connection and profile are required.');
  const next = {
    presetId: settings.presetId,
    customUrl: settings.presetId === 'custom' ? String(settings.customUrl || '').trim() : '',
    // Only ever a path string (from ctx.os.pickOpenPath) — never file bytes/base64.
    customPath: settings.presetId === 'file' ? String(settings.customPath || '').trim() : '',
    volume: clampVolume(settings.volume)
  };
  if (!validSoundSettings(next)) throw Error(next.presetId === 'custom' ? 'Enter a valid http(s) or data URL for the custom sound.' : next.presetId === 'file' ? 'Choose a local file for the custom sound.' : 'Invalid sound settings.');
  const all = ctx.storage.get('sound-settings-v1', {});
  const base = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  const merged = {...base, [scope]: next};
  ctx.storage.set('sound-settings-v1', merged);
  if (JSON.stringify(ctx.storage.get('sound-settings-v1', null)) !== JSON.stringify(merged)) throw Error('Storage failed; settings were not confirmed.');
  return next;
}
// Mirrors core's decision shape (mute check, "None" bails early) but scoped
// per (connection, profile): a profile with no saved entry stays silent
// rather than falling back to some other profile's sound.
//
// DELIBERATELY NOT switched to focusedSessionOwner, unlike the marker/
// background-image injectors. Those features paint something the user is
// currently LOOKING AT, so they must follow which chat has UI focus. This
// handler instead answers "which profile just finished", which is a fact
// carried by the EVENT itself (event.profile), independent of whatever tab
// happens to be focused when the event arrives -- a background/non-focused
// bot finishing must still play ITS OWN configured sound, not the focused
// tab's. Using focusedSessionOwner here would be wrong: it would play the
// focused tab's sound for every completion regardless of which profile
// actually finished, or play nothing when the finishing profile isn't the
// focused one. event.profile already does the right thing; only degrades to
// the ambient host.state.profile when the event itself carries no profile.
// connectionId is left on the ambient host.state.connectionId.get() on
// purpose: in this app's model a single active connection owns the live
// gateway socket (Bot-mode tabs are different PROFILES on that same
// connection, not separate connections -- see focusedSessionOwner's own doc
// comment in sdk/index.ts), so every event reaching this handler already
// belongs to the one ambient connection; there is no second connectionId to
// disambiguate against.
// connectionId is left on the ambient host.state.connectionId.get() on
// purpose: in this app's model a single active connection owns the live
// gateway socket (Bot-mode tabs are different PROFILES on that same
// connection, not separate connections -- see focusedSessionOwner's own doc
// comment in sdk/index.ts), so every event reaching this handler already
// belongs to the one ambient connection; there is no second connectionId to
// disambiguate against.
export function handleSoundCompletionEvent(ctx, event) {
  try {
    const connection = host.state.connectionId.get();
    const eventProfile = typeof event?.profile === 'string' && event.profile.trim() ? event.profile : host.state.profile.get();
    const scope = markerScopeFor(connection, eventProfile);
    if (!scope) return false;
    const all = ctx.storage.get('sound-settings-v1', {});
    const entry = all && typeof all === 'object' && !Array.isArray(all) ? all[scope] : null;
    if (!validSoundSettings(entry)) return false;
    return playSoundSettings(entry);
  } catch (e) { console.error('Theme Studio notification sound failed:', e); return false; }
}
function soundButton(label, onClick, disabled) {
  return jsx('button', {type:'button', onClick, disabled, style:{...ui.button, opacity:disabled?0.5:1, cursor:disabled?'not-allowed':'pointer'}, children:label});
}
export function SoundPage({ctx}) {
  const owner = useValue(host.state.focusedSessionOwner);
  const connection = useValue(host.state.connectionId), profile = useValue(host.state.profile);
  const scope = scopeFor(owner) || scopeFor({connectionId:connection, profile});
  const currentScope = () => scopeFor(host.state.focusedSessionOwner?.get()) || scopeFor({connectionId:host.state.connectionId.get(), profile:host.state.profile.get()});
  const [draft, setDraft] = useState(DEFAULT_SOUND_SETTINGS);
  const [message, setMessage] = useState('');
  const [reminderDismissed, setReminderDismissed] = useState(true);
  useEffect(() => { setDraft(readSoundSettings(ctx, scope)); setMessage(''); setReminderDismissed(readSoundReminderDismissed(ctx, scope)); }, [ctx, scope]);
  const edit = (field, value) => setDraft(old => ({...old, [field]: value}));
  const save = () => { try {
    if (!scope || currentScope() !== scope) throw Error('Active connection and profile are required.');
    setDraft(saveSoundSettings(ctx, scope, draft));
    setMessage('Saved for the active connection and profile.');
  } catch (e) { setMessage(e.message); } };
  // Dismissal is scoped like every other preference here (per connection +
  // profile) and stored via ctx.storage, not a core setting -- this never
  // touches the actual completion-sound value, only whether this reminder
  // has been acknowledged for this scope.
  const dismissReminder = () => { try { if (scope) dismissSoundReminder(ctx, scope); } finally { setReminderDismissed(true); } };
  const openSettings = () => { openNotificationSettings(); };
  // Shown whenever the CONFIGURED (saved) sound for this scope is non-None
  // and the user hasn't dismissed it yet for this scope -- not for every
  // keystroke while merely browsing presets in the dropdown.
  const showReminder = draft.presetId !== 'none' && !reminderDismissed;
  // No more thenable special-case: every presetId (including 'win:*' and
  // 'file') now resolves synchronously through hermes-media://.
  const preview = () => {
    const result = playSoundSettings(draft);
    setMessage(result ? 'Playing preview…' : draft.presetId === 'none' ? 'Sound is set to None; nothing to preview.' : draft.volume <= 0 ? 'Volume is 0%; nothing to preview.' : draft.presetId === 'file' && !draft.customPath ? 'Choose a local file first.' : 'Nothing to preview.');
  };
  // Native open dialog via the documented plugin SDK door (ctx.os.pickOpenPath
  // -- apps/desktop/src/contrib/plugin.ts PluginOs). Resolves the chosen
  // PATH directly (or null on cancel/unavailable) — no File object, no
  // bytes, no webUtils.getPathForFile needed.
  const pickFile = async () => {
    if (!ctx.os || typeof ctx.os.pickOpenPath !== 'function') { setMessage('File picker unavailable on this host.'); return; }
    try {
      const path = await ctx.os.pickOpenPath({ title: 'Choose a notification sound', filters: [{ extensions: ['mp3', 'wav'], name: 'Audio' }] });
      if (path) { edit('customPath', path); setMessage('Chosen: ' + path); }
    } catch (e) { setMessage(e.message); }
  };
  return jsx('section', {style:ui.section, children:[
    jsx('h2', {style:ui.heading, children:'Notification sound'}),
    jsx('p', {style:ui.text, children:'Plays a short cue when a message finishes for the active connection and profile only — other profiles are unaffected.'}),
    showReminder && jsx('div', {role:'alert', 'aria-label':'Notification sound reminder', style:ui.callout, children:[
      jsx('p', {style:{margin:0, fontWeight:700, fontSize:14}, children:'⚠️ To avoid hearing two sounds at once'}),
      jsx('p', {style:{margin:'6px 0 0', fontSize:14, lineHeight:1.5}, children:'Open Hermes Settings → Notifications and set the completion sound to "None". Theme Studio\'s sound plays independently of it, so with both set, you\'ll hear two sounds for every finished message.'}),
      jsx('div', {style:{display:'flex', gap:8, marginTop:10, flexWrap:'wrap'}, children:[
        soundButton('Open Notification Settings', openSettings, false),
        soundButton('Dismiss', dismissReminder, false)
      ]})
    ]}),
    jsx('label', {style:ui.label, htmlFor:'studio-sound-preset', children:'Sound'}),
    jsx('select', {id:'studio-sound-preset', style:ui.field, value:draft.presetId, onChange:e=>edit('presetId', e.target.value), 'aria-label':'Notification sound preset', children:[
      jsx('option', {value:'none', children:'None'}, 'none'),
      ...SOUND_PRESETS.map(p => jsx('option', {value:p.id, children:p.label}, p.id)),
      jsx('optgroup', {label:'Windows system sounds', children:WINDOWS_SOUND_PRESETS.map(p => jsx('option', {value:p.id, children:p.label}, p.id))}),
      jsx('option', {value:'custom', children:'Custom URL'}, 'custom'),
      jsx('option', {value:'file', children:'Local file…'}, 'file')
    ]}),
    draft.presetId === 'custom' && jsx('div', {children:[
      jsx('label', {style:ui.label, htmlFor:'studio-sound-url', children:'Custom sound URL (http(s) or data:)'}),
      jsx('input', {id:'studio-sound-url', style:ui.field, value:draft.customUrl, onChange:e=>edit('customUrl', e.target.value), placeholder:'https://example.com/chime.mp3', maxLength:500, 'aria-label':'Custom sound URL'})
    ]}),
    draft.presetId === 'file' && jsx('div', {children:[
      jsx('label', {style:ui.label, children:'Local sound file'}),
      jsx('div', {style:{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}, children:[
        soundButton('Choose file…', pickFile, false),
        jsx('span', {'aria-label':'Chosen local sound file path', children: draft.customPath || 'No file chosen.'})
      ]})
    ]}),
    jsx('label', {style:ui.label, htmlFor:'studio-sound-volume', children:'Volume: ' + draft.volume + '%'}),
    jsx('input', {id:'studio-sound-volume', type:'range', min:0, max:100, step:1, value:draft.volume, onChange:e=>edit('volume', clampVolume(e.target.value)), 'aria-label':'Notification sound volume', style:{display:'block', width:'min(100%, 320px)'}}),
    jsx('div', {style:{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}, children:[
      soundButton('Preview sound', preview, false),
      soundButton('Save sound settings', save, false)
    ]}),
    jsx('p', {role:'status', 'aria-label':'Sound status', children:message})
  ]});
}
// ---- Background image (per connection+profile) ----
// A genuine local-file picker slot (ctx.os.pickOpenPath), exactly like the
// sound feature's 'file' preset: only a filesystem PATH ever reaches
// ctx.storage, never image bytes/base64. Unlike audio/video, image
// extensions (png/jpg/jpeg/gif/webp) are NOT in media-protocol.ts's
// STREAMABLE_MEDIA_EXTENSIONS allowlist, so hermes-media://stream/... 404s
// (actually 415s) for them -- confirmed by reading that file directly. The
// only other door onto local file bytes is the undocumented
// window.hermesDesktop.readFileDataUrl(path) bridge (global.d.ts:300,
// already used throughout the core app for local image/attachment
// previews). That bridge is used here ONLY to resolve a transient in-memory
// data: URL for the live <img> preview and for the injected background CSS
// -- it is never written to ctx.storage, and the resolved data: URL is
// re-derived from the stored path on every load/profile switch rather than
// persisted.
export const BG_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
export const DEFAULT_BG_IMAGE_SETTINGS = {path: '', opacity: 40, size: 50};
export function clampBgOpacity(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 40; }
// Size is a background-size percentage (of the surface box), applied with
// background-position: center and background-repeat: no-repeat so the image
// shows as a centered, scaled photo rather than a full-bleed cover/stretch.
// Defaults to 50% per the user's request; clamped to a sane [10,100] range.
export function clampBgSize(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(10, Math.min(100, Math.round(n))) : 50; }
export function validBackgroundImageSettings(s) {
  return !!s && typeof s === 'object' && typeof s.path === 'string' && s.path.length <= 1000
    && Number.isInteger(s.opacity) && s.opacity >= 0 && s.opacity <= 100
    // size is optional for backward compatibility with entries saved before
    // this field existed; when present it must be a valid integer in range.
    && (s.size === undefined || (Number.isInteger(s.size) && s.size >= 10 && s.size <= 100));
}
export function readBackgroundImageSettings(ctx, scope) {
  const all = ctx.storage.get('background-image-v1', {});
  const entry = all && typeof all === 'object' && !Array.isArray(all) && scope ? all[scope] : null;
  return validBackgroundImageSettings(entry) ? {...DEFAULT_BG_IMAGE_SETTINGS, ...entry} : {...DEFAULT_BG_IMAGE_SETTINGS};
}
export function saveBackgroundImageSettings(ctx, scope, settings) {
  if (!scope) throw Error('Active connection and profile are required.');
  const next = {
    // Only ever a path string (from ctx.os.pickOpenPath) — never image bytes/base64/data URLs.
    path: String(settings?.path || '').trim(),
    opacity: clampBgOpacity(settings?.opacity),
    size: clampBgSize(settings?.size)
  };
  if (!validBackgroundImageSettings(next)) throw Error('Invalid background image settings.');
  const all = ctx.storage.get('background-image-v1', {});
  const base = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  const merged = {...base, [scope]: next};
  ctx.storage.set('background-image-v1', merged);
  if (JSON.stringify(ctx.storage.get('background-image-v1', null)) !== JSON.stringify(merged)) throw Error('Storage failed; settings were not confirmed.');
  return next;
}
export function clearBackgroundImageSettings(ctx, scope) { return saveBackgroundImageSettings(ctx, scope, DEFAULT_BG_IMAGE_SETTINGS); }
// Resolves a chosen path to a transient data: URL for preview/CSS use only;
// never cached to storage. `reader` is injectable for tests; defaults to the
// real bridge when present, and degrades to null (no throw) when absent —
// an older/non-Electron host simply shows no preview and no background.
export async function resolveBackgroundImageDataUrl(filePath, reader) {
  if (!filePath) return null;
  const fn = reader || (typeof window !== 'undefined' ? window.hermesDesktop?.readFileDataUrl : undefined);
  if (typeof fn !== 'function') return null;
  try {
    const result = await fn(filePath);
    if (typeof result === 'string' && result.startsWith('data:')) return result;
    console.warn('Theme Studio: background image reader returned a non-data: result for', filePath, result);
    return null;
  } catch (e) { console.warn('Theme Studio: background image reader failed for', filePath, e); return null; }
}
// Pure CSS builder: a ::before layer behind [data-chat-surface]'s content,
// simple compositing (no touching child z-index/stacking). Unlike
// chatBackground's solid-color override (gated :not([data-hermes-glass]),
// because a flat color fill would just paper over the native glass
// material), an uploaded photo is wanted in BOTH modes: outside glass mode
// it sits under the surface's own (usually opaque) background color; in
// glass mode styles.css sets --ui-chat-surface-background: transparent for
// [data-chat-surface] (see :root[data-hermes-glass] in styles.css), so the
// surface itself has nothing opaque painted over this ::before and the
// image shows straight through, with the glass panel's own translucency/
// blur compositing on top of it exactly like the native backdrop would.
// No :not([data-hermes-glass]) gate here on purpose -- apply unconditionally.
export function backgroundImageCSS(dataUrl, opacityPct, sizePct) {
  if (!dataUrl) return '';
  const opacity = clampBgOpacity(opacityPct) / 100;
  if (opacity <= 0) return '';
  const size = clampBgSize(sizePct);
  const safeUrl = JSON.stringify(dataUrl);
  // Defense in depth for Bot Mode (and any future chat-area contribution):
  // the ::before only has to beat the surface's OWN background (painted
  // behind it regardless of z-index -- confirmed by live DOM inspection and
  // a byte-for-byte reproduction), but nothing stops a future contribution
  // area (chat.empty, or the active-conversation viewport) from adding an
  // in-flow, non-positioned sibling with its own opaque background-color --
  // those paint in front of a negative z-index pseudo-element regardless of
  // which stacking context either sits in. Forcing every direct descendant
  // chain of [data-chat-surface] transparent removes that failure mode
  // without touching hermes-bots (or any other plugin's) source -- it is
  // pure CSS Theme Studio already owns injecting. `!important` because a
  // contributed view's own Tailwind utility (e.g. a future `bg-background`)
  // otherwise wins on source order/specificity.
  return `:root [data-chat-surface] { position: relative; }\n:root [data-chat-surface]::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: url(${safeUrl}); background-size: ${size}% auto; background-position: center; background-repeat: no-repeat; opacity: ${opacity}; }\n:root [data-chat-surface] > * { background-color: transparent !important; }`;
}
// Mounted imperatively from register(ctx) -- NOT as a statusBar.right render
// contribution. A statusBar.right item's render only stays alive while that
// UI slot does: it is a user-toggleable statusbar item (see
// $statusbarHiddenIds/setStatusbarItemVisible in the desktop's own
// statusbar-prefs) and the desktop unmounts a hidden item's render entirely
// rather than just hiding it, which runs this effect's cleanup and strips
// the <style> tag from <head> -- silently deleting the background image CSS
// until the item is shown again. The same statusbar slot can also go away
// under any view that doesn't keep the main chat statusbar mounted (e.g. a
// Bot's chat), so the background was never guaranteed to persist there in
// the first place. A background-image wallpaper is a document-wide visual,
// not a statusbar widget's business -- give it a lifecycle of its own, tied
// only to the plugin itself (ctx.onDispose), so it survives every chat view,
// bot or not, regardless of what the statusbar is doing.
function mountBackgroundImageStyle(ctx, events) {
  const el = document.createElement('style');
  el.dataset.themeStudioBgImage = '';
  document.head.appendChild(el);
  let cancelled = false;
  let generation = 0;
  const update = async () => {
    const myGeneration = ++generation;
    const owner = host.state.focusedSessionOwner?.get();
    const connection = host.state.connectionId.get();
    const profile = host.state.profile.get();
    const scope = scopeFor(owner) || scopeFor({connectionId:connection, profile});
    const settings = readBackgroundImageSettings(ctx, scope);
    if (!settings.path) { if (!cancelled && myGeneration === generation) el.textContent = ''; return; }
    const dataUrl = await resolveBackgroundImageDataUrl(settings.path);
    if (cancelled || myGeneration !== generation) return;
    el.textContent = backgroundImageCSS(dataUrl, settings.opacity, settings.size);
  };
  events.addEventListener('change', update);
  const unsubOwner = host.state.focusedSessionOwner?.subscribe ? host.state.focusedSessionOwner.subscribe(update) : () => {};
  const unsubConnection = host.state.connectionId.subscribe(update);
  const unsubProfile = host.state.profile.subscribe(update);
  const teardown = () => {
    cancelled = true;
    events.removeEventListener('change', update);
    unsubOwner();
    unsubConnection();
    unsubProfile();
    el.remove();
  };
  // ctx.onDispose is always present on the real SDK context handed to a
  // registered plugin; guarded the same defensive way as the host.onEvent
  // check below it, so a minimal/older ctx (e.g. a narrower test harness
  // exercising an unrelated feature) degrades to "never torn down" instead
  // of throwing register() itself.
  if (typeof ctx.onDispose === 'function') ctx.onDispose(teardown);
}
export function BackgroundImagePage({ctx, events}) {
  const owner = useValue(host.state.focusedSessionOwner);
  const connection = useValue(host.state.connectionId), profile = useValue(host.state.profile);
  const scope = scopeFor(owner) || scopeFor({connectionId:connection, profile});
  const currentScope = () => scopeFor(host.state.focusedSessionOwner?.get()) || scopeFor({connectionId:host.state.connectionId.get(), profile:host.state.profile.get()});
  const [draft, setDraft] = useState(DEFAULT_BG_IMAGE_SETTINGS);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(readBackgroundImageSettings(ctx, scope)); setPreview(null); setMessage(''); }, [ctx, scope]);
  useEffect(() => {
    let cancelled = false;
    if (!draft.path) { setPreview(null); return; }
    resolveBackgroundImageDataUrl(draft.path).then(url => { if (!cancelled) setPreview(url); });
    return () => { cancelled = true; };
  }, [draft.path]);
  const pickFile = async () => {
    if (!ctx.os || typeof ctx.os.pickOpenPath !== 'function') { setMessage('File picker unavailable on this host.'); return; }
    try {
      const path = await ctx.os.pickOpenPath({ title: 'Choose a background image', filters: [{ extensions: BG_IMAGE_EXTENSIONS, name: 'Images' }] });
      if (path) { setDraft(old => ({...old, path})); setMessage('Chosen: ' + path); }
    } catch (e) { setMessage(e.message); }
  };
  const save = () => { try {
    if (!scope || currentScope() !== scope) throw Error('Active connection and profile are required.');
    const next = saveBackgroundImageSettings(ctx, scope, draft);
    setDraft(next);
    setMessage('Saved for the active connection and profile.');
    events.dispatchEvent(new Event('change'));
  } catch (e) { setMessage(e.message); } };
  const clearImage = () => { try {
    if (!scope || currentScope() !== scope) throw Error('Active connection and profile are required.');
    const next = clearBackgroundImageSettings(ctx, scope);
    setDraft(next); setPreview(null);
    setMessage('Cleared the background image.');
    events.dispatchEvent(new Event('change'));
  } catch (e) { setMessage(e.message); } };
  return jsx('section', {style:ui.section, children:[
    jsx('h2', {style:ui.heading, children:'Background image'}),
    jsx('p', {style:ui.text, children:'Pick a local image to show behind the conversation, with adjustable transparency. Applies in both glass and non-glass mode, for the active connection and profile only; in glass mode the glass panels stay translucent and composite over the image rather than hiding it.'}),
    jsx('div', {style:{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}, children:[
      soundButton('Choose image…', pickFile, false),
      jsx('span', {'aria-label':'Chosen background image path', children: draft.path || 'No image chosen.'})
    ]}),
    preview ? jsx('img', {src:preview, alt:'Background image preview', style:{display:'block', marginTop:10, maxWidth:220, maxHeight:140, borderRadius:6, border:'1px solid var(--ui-stroke-secondary)'}}) : null,
    jsx('label', {style:ui.label, htmlFor:'studio-bg-image-opacity', children:'Opacity: ' + draft.opacity + '%'}),
    jsx('input', {id:'studio-bg-image-opacity', type:'range', min:0, max:100, step:1, value:draft.opacity, onChange:e=>setDraft(old=>({...old, opacity:clampBgOpacity(e.target.value)})), 'aria-label':'Background image opacity', style:{display:'block', width:'min(100%, 320px)'}}),
    jsx('label', {style:ui.label, htmlFor:'studio-bg-image-size', children:'Size: ' + draft.size + '%'}),
    jsx('input', {id:'studio-bg-image-size', type:'range', min:10, max:100, step:1, value:draft.size, onChange:e=>setDraft(old=>({...old, size:clampBgSize(e.target.value)})), 'aria-label':'Background image size', style:{display:'block', width:'min(100%, 320px)'}}),
    jsx('div', {style:{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}, children:[
      soundButton('Save background image', save, false),
      soundButton('Clear background image', clearImage, false)
    ]}),
    jsx('p', {role:'status', 'aria-label':'Background image status', children:message})
  ]});
}
function ScopeStyle({ctx,events}) {
  const owner=useValue(host.state.focusedSessionOwner);
  const connection=useValue(host.state.connectionId), profile=useValue(host.state.profile);
  const scope=scopeFor(owner) || scopeFor({connectionId:connection,profile});
  useEffect(()=>{ const el=document.createElement('style'); el.dataset.themeStudioSessionMarkers=''; document.head.appendChild(el); const update=()=>{el.textContent=markerCSS(read(ctx,scope));}; events.addEventListener('change',update); update(); return ()=>{events.removeEventListener('change',update);el.remove();}; },[ctx,events,scope]);
  return null;
}
function MarkerPage({ctx,events}) {
  const owner=useValue(host.state.focusedSessionOwner);
  const connection=useValue(host.state.connectionId), profile=useValue(host.state.profile);
  const scope=scopeFor(owner) || scopeFor({connectionId:connection,profile});
  const currentScope=()=>scopeFor(host.state.focusedSessionOwner?.get()) || scopeFor({connectionId:host.state.connectionId.get(),profile:host.state.profile.get()});
  const [draft,setDraft]=useState({}), [message,setMessage]=useState('');
  useEffect(()=>{setDraft(read(ctx,scope));setMessage('');},[ctx,scope]);
  const edit=(key,field,value)=>setDraft(old=>({...old,[key]:{enabled:false,icon:'',color:'',...old[key],[field]:value}}));
  const save=()=>{ try {
    if (!scope || currentScope() !== scope) throw Error('Active connection and profile are required.');
    for (const key of Object.keys(states)) { const v=draft[key]; if (v && (typeof v.enabled !== 'boolean' || !goodIcon(v.icon) || !goodColor(v.color))) throw Error('Use up to 16 Unicode characters, no controls, and a six-digit color.'); }
    const all=ctx.storage.get('markers-v1', {}); if (!all || typeof all !== 'object' || Array.isArray(all)) throw Error('Invalid stored settings; not overwritten.');
    const next={...all,[scope]:draft}; ctx.storage.set('markers-v1',next); if (JSON.stringify(ctx.storage.get('markers-v1',null)) !== JSON.stringify(next)) throw Error('Storage failed; settings not confirmed.'); events.dispatchEvent(new Event('change')); setMessage('Saved for the active connection and profile.');
  } catch(e) {setMessage(e.message);} };
  return jsx('section',{style:ui.section,children:[jsx('h2',{style:ui.heading,children:'Session markers'}),jsx('p',{style:ui.text,children:'Customize sidebar markers only. To insert an emoji on Windows, click a symbol box and press Windows key + period (.). Choose an emoji from the menu, then save your marker settings. Finished means unread completion, not a permanent completion badge. These internal CSS selectors may break after Hermes updates.'}),jsx('p',{style:ui.text,children:'Settings follow the active gateway connection and profile and paint the whole sidebar, not individual tiled profiles. Emoji colors are controlled by your system font and may ignore the selected color.'}),...Object.entries(states).map(([key,[label]])=>{const v={enabled:false,icon:'',color:'',...draft[key]};return jsx('fieldset',{style:{margin:'16px 0',padding:16,border:'1px solid var(--ui-stroke-secondary)',borderRadius:8,minWidth:0},children:[jsx('legend',{style:{fontWeight:700,fontSize:15,padding:'0 6px'},children:label}),jsx('label',{children:[jsx('input',{type:'checkbox',checked:v.enabled,onChange:e=>edit(key,'enabled',e.target.checked)}),' Customize']}),jsx('label',{style:ui.label,children:['Emoji or symbol (blank keeps dot) ',jsx('input',{style:{...ui.field,display:'block',width:'min(100%, 280px)',marginTop:6},value:v.icon,onChange:e=>edit(key,'icon',e.target.value),maxLength:32,'aria-label':label+' symbol'})]}),jsx('label',{style:ui.label,children:['Color (blank uses theme; #RRGGBB) ',jsx('input',{style:{...ui.field,display:'inline-block',width:130,margin:'6px 8px 0 0'},value:v.color,onChange:e=>edit(key,'color',e.target.value),maxLength:7,'aria-label':label+' color'}),jsx('input',{style:{...ui.field,width:54,padding:3,verticalAlign:'middle'},type:'color',value:/^#[0-9a-f]{6}$/i.test(v.color)?v.color:'#808080',onChange:e=>edit(key,'color',e.target.value),'aria-label':label+' color picker'})]}),jsx('div',{children:['Preview: ',jsx('span',{'aria-hidden':true,style:{color:goodColor(v.color)&&v.color?v.color:undefined},children:v.enabled && v.icon && goodIcon(v.icon)?v.icon:'●'}),' ',label]})]},key);}),jsx('button',{type:'button',onClick:save,disabled:!scope,style:{...ui.button,opacity:scope?1:0.5},children:'Save marker settings'}),jsx('p',{role:'status',children:message})]});
}

export default { id:'theme-studio', name:'Theme Studio', defaultEnabled:false, register(ctx) {
  const studio = createStudio(ctx);
  const markerEvents = new EventTarget();
  const bgImageEvents = new EventTarget();
  ctx.register({id:'marker-style',area:'statusBar.right',render:()=>jsx(ScopeStyle,{ctx,events:markerEvents})});
  // Not a statusBar.right contribution (see mountBackgroundImageStyle's own
  // comment for why) -- mounted directly so it outlives any chat view,
  // including a Bot's, and any statusbar visibility toggle.
  mountBackgroundImageStyle(ctx, bgImageEvents);
  ctx.register({id:'page',area:ROUTES_AREA,data:{path:'/theme-studio'},render:()=>jsx(Studio,{studio,ctx,markerEvents,bgImageEvents})});
  ctx.register({id:'nav',area:SIDEBAR_NAV_AREA,data:{path:'/theme-studio',label:'Theme Studio',codicon:'symbol-color'}});
  if (typeof host.onEvent === 'function') host.onEvent('message.complete', event => handleSoundCompletionEvent(ctx, event));
} };
