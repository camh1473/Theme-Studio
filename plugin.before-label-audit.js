import { THEMES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, useTheme, useValue, host } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { useState, useRef, useEffect } from 'react';

const copy = value => JSON.parse(JSON.stringify(value));
const scopeFor = owner => owner && typeof owner.connectionId === 'string' && owner.connectionId.trim() && typeof owner.profile === 'string' && owner.profile.trim() ? JSON.stringify([owner.connectionId,owner.profile]) : null;
const keys = ['background','foreground','card','cardForeground','muted','mutedForeground','popover','popoverForeground','primary','primaryForeground','secondary','secondaryForeground','accent','accentForeground','border','input','ring','midground','midgroundForeground','composerRing','destructive','destructiveForeground','sidebarBackground','sidebarBorder','userBubble','userBubbleBorder'];
const valid = t => t && typeof t.name === 'string' && /^theme-studio-[a-z0-9-]+$/.test(t.name) && typeof t.label === 'string' && t.colors && ['background','foreground','primary'].every(k => typeof t.colors[k] === 'string');
const addChatRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + '\n:root:not([data-hermes-glass]) [data-chat-surface] { --ui-chat-surface-background: ' + color + '; }'; return result; };

const addSessionsRule = (theme, color) => { const result = copy(theme); result.customCSS = (result.customCSS || '') + `\n:root:not([data-hermes-glass]) [data-tour="sessions-sidebar"][data-slot="sidebar"] { --ui-sidebar-surface-background: ${color}; }\n:root[data-hermes-glass] [data-tour="sessions-sidebar"][data-slot="sidebar"] { background-color: color-mix(in srgb, ${color} 30%, transparent); }`; return result; };

export function createStudio(ctx) {
  let saved = ctx.storage.get('scoped-themes-v1', []);
  if (!Array.isArray(saved)) saved = [];
  saved = saved.filter(x => x && typeof x.scope === 'string' && valid(x.theme));
  const registrations = new Map();
  for (const {theme} of saved) registrations.set(theme.name, ctx.register({id:theme.name, area:THEMES_AREA, data:copy(theme)}));
  let baseline = null, draft = null, mode = 'light', previewDispose = null, previous = null, draftScope = null, chatEdited = false, sessionsEdited = false;
  const withChatCSS = theme => { let result = chatEdited ? addChatRule(theme, chatEdited) : copy(theme); return sessionsEdited ? addSessionsRule(result, sessionsEdited) : result; };
  const requireScope = api => { if (!api.scope || (api.currentScope && api.currentScope() !== api.scope)) throw Error('Active connection and profile are required, and focus must not change.'); return api.scope; };
  function clear(api) { if (previewDispose) { api.clearThemePreview(); previewDispose(); previewDispose = null; } }
  function begin(api) { const scope = requireScope(api); clear(api); chatEdited = false; sessionsEdited = false; mode = api.resolvedMode; baseline = copy(api.theme); if (mode === 'dark') baseline.darkColors = copy(api.theme.colors); else if (!baseline.darkColors) baseline.darkColors = copy(api.theme.colors); draft = copy(baseline); previous = api.themeName; draftScope = scope; return copy(draft); }
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
    draft[field][key] = color; paint(api); return copy(draft);
  }
  function resetItem(key, api) {
    requireDraft(api); if (!(keys.includes(key) || key === 'chatBackground' || key === 'sessionsSidebarBackground')) throw Error('Invalid color.');
    if (key === 'sessionsSidebarBackground') { sessionsEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    if (key === 'chatBackground') { chatEdited = false; if (Object.prototype.hasOwnProperty.call(baseline, key)) draft[key] = baseline[key]; else delete draft[key]; paint(api); return copy(draft); }
    const field = mode === 'dark' ? 'darkColors' : 'colors';
    const original = baseline[field] || baseline.colors;
    if (!draft[field]) draft[field] = copy(draft.colors);
    if (Object.prototype.hasOwnProperty.call(original,key)) draft[field][key] = original[key]; else delete draft[field][key];
    paint(api); return copy(draft);
  }
  function revert(api) { clear(api); chatEdited = false; sessionsEdited = false; draft = baseline ? copy(baseline) : null; return draft && copy(draft); }
  function reset(api) { requireDraft(api); chatEdited = false; sessionsEdited = false; draft = copy(baseline); paint(api); return copy(draft); }
  function save(label, api) {
    requireDraft(api);
    label = label.trim(); if (!draft || !label || label.length > 80) throw Error('Enter a name (1–80 characters).');
    let name; do { name = 'theme-studio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10); } while (saved.some(t => t.theme.name === name));
    const theme = {...withChatCSS(draft), name, label, description:'Saved in Theme Studio'};
    const next = [...saved, {scope:api.scope, theme}]; ctx.storage.set('scoped-themes-v1', next);
    if (JSON.stringify(ctx.storage.get('scoped-themes-v1', null)) !== JSON.stringify(next)) throw Error('Storage failed; theme was not saved.');
    registrations.set(name, ctx.register({id:name, area:THEMES_AREA, data:theme})); saved = next; return name;
  }
  function apply(name, api) {
    const scope = requireScope(api);
    if ('activeScope' in api && (api.activeScope !== scope || (api.currentActiveScope && api.currentActiveScope() !== scope))) throw Error('Focused owner differs from the active gateway profile; switch profiles before applying.');
    if (!saved.some(t => t.scope === scope && t.theme.name === name)) throw Error('Theme is not saved for this connection and profile.');
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
  return {begin, edit, resetItem, revert, reset, save, apply, restore, list:api=>saved.filter(t=>t.scope === requireScope(api)).map(t=>({name:t.theme.name,label:t.theme.label})), previous:()=>previous};
}

function Studio({studio}) {
  const themeApi = useTheme(); const connection = useValue(host.state.connectionId); const profile = useValue(host.state.profile);
  const owner = useValue(host.state.focusedSessionOwner);
  const scope = scopeFor(owner); const activeScope = scopeFor({connectionId:connection,profile});
  const api = {...themeApi, scope, activeScope, currentScope:()=>scopeFor(host.state.focusedSessionOwner?.get()), currentActiveScope:()=>scopeFor({connectionId:host.state.connectionId.get(),profile:host.state.profile.get()})}; const apiRef = useRef(api); apiRef.current = api;
  const [draft,setDraft] = useState(null); const [name,setName] = useState(''); const [selected,setSelected] = useState('background');
  const [saved,setSaved] = useState([]); const [choice,setChoice] = useState(''); const [message,setMessage] = useState('Choose Start editing to copy the current theme.');
  const draftMode = useRef(null);
  useEffect(() => () => studio.revert(apiRef.current), [studio]);
  useEffect(() => { studio.revert(apiRef.current); draftMode.current = null; setDraft(null); setChoice(''); setSaved(api.scope ? studio.list(api) : []); }, [studio, api.scope]);
  useEffect(() => { if (draftMode.current && draftMode.current !== api.resolvedMode) { studio.revert(apiRef.current); draftMode.current = null; setDraft(null); setMessage('Mode changed; editing cancelled. Start editing again.'); } }, [studio, api.resolvedMode]);
  const act = fn => { try { fn(); } catch(e) { setMessage(e.message); } };
  const palette = draft && (api.resolvedMode === 'dark' ? (draft.darkColors || draft.colors) : draft.colors);
  const selectedValue = selected === 'chatBackground' || selected === 'sessionsSidebarBackground' ? draft?.[selected] : palette?.[selected];
  const color = /^#[0-9a-f]{6}$/i.test(selectedValue || '') ? selectedValue : '#808080';
  const button = (label, onClick, disabled=false) => jsx('button',{type:'button',onClick,disabled,style:{padding:'6px 10px',cursor:'pointer'},children:label});
  return jsx('div',{style:{padding:20,overflow:'auto',height:'100%',color:'var(--ui-text-primary)'},children:[
    jsx('h2',{children:'Theme Studio'}),
    jsx('p',{children:'Edit a copy of the current theme. Preview is temporary; saved themes are local to this plugin.'}),
    button('Start editing current theme',()=>act(()=>{setDraft(studio.begin(api));draftMode.current=api.resolvedMode;setMessage('Editing '+api.themeName+' ('+api.resolvedMode+').');})),
    draft && jsx('div',{children:[
      jsx('p',{children:'Click an area of the preview, or select a color from the list.'}),
      jsx('div',{style:{display:'flex',minHeight:200,border:'1px solid var(--ui-stroke-secondary)',borderRadius:8,overflow:'hidden',maxWidth:650,background:palette.background,color:palette.foreground},children:[
        jsx('button',{type:'button','aria-label':'Select sidebar color',onClick:()=>setSelected('sessionsSidebarBackground'),style:{width:'27%',background:draft.sessionsSidebarBackground || palette.sidebarBackground || palette.muted || palette.background,color:palette.foreground,border:0,borderRight:'1px solid var(--ui-stroke-secondary)',padding:14,textAlign:'left',cursor:'pointer'},children:['Chats',jsx('div',{style:{marginTop:20,color:palette.primary},children:'● Current chat'})]}),
        jsx('div',{style:{flex:1,padding:16},children:[
          jsx('button',{type:'button','aria-label':'Select chat background color',onClick:()=>setSelected('chatBackground'),style:{display:'block',width:'100%',padding:10,background:draft.chatBackground || palette.background,color:palette.foreground,border:'1px dashed currentColor',cursor:'pointer'},children:'Chat background'}),
          jsx('button',{type:'button','aria-label':'Select chat text color',onClick:()=>setSelected('foreground'),style:{display:'block',marginTop:12,background:'transparent',color:palette.foreground,border:0,cursor:'pointer'},children:'Hello! Click this text to customize it.'}),
          jsx('button',{type:'button','aria-label':'Select message bubble color',onClick:()=>setSelected('userBubble'),style:{display:'block',margin:'12px 0 0 auto',padding:10,border:'1px solid '+(palette.userBubbleBorder || palette.border || 'transparent'),borderRadius:10,background:palette.userBubble || palette.muted || palette.background,color:palette.foreground,cursor:'pointer'},children:'Your message bubble'}),
          jsx('button',{type:'button','aria-label':'Select accent color',onClick:()=>setSelected('primary'),style:{marginTop:12,padding:'6px 12px',background:palette.primary,color:palette.primaryForeground || palette.background,border:0,borderRadius:5,cursor:'pointer'},children:'Accent'})
        ]})
      ]}),
      jsx('div',{style:{display:'flex',flexWrap:'wrap',gap:6},children:[...keys,'chatBackground','sessionsSidebarBackground'].map(k=>jsx('button',{type:'button',onClick:()=>setSelected(k),title:(k === 'chatBackground' || k === 'sessionsSidebarBackground' ? draft[k] : palette[k]) || 'Uses theme fallback',style:{padding:'7px',border:k===selected?'2px solid var(--ui-accent)':'1px solid var(--ui-stroke-secondary)'},children:[jsx('span',{style:{display:'inline-block',width:14,height:14,marginRight:5,background:(k === 'chatBackground' || k === 'sessionsSidebarBackground' ? draft[k] : palette[k]) || 'transparent'}}),k]},k))}),
      jsx('p',{children:[selected,' ',jsx('input',{type:'color',value:color,onChange:e=>act(()=>setDraft(studio.edit(selected,e.target.value,api))), 'aria-label':'Color for '+selected}),' ',button('Reset selected color',()=>act(()=>setDraft(studio.resetItem(selected,api))))]}),
      selectedValue && !/^#[0-9a-f]{6}$/i.test(selectedValue) ? jsx('p',{children:'Current value: '+selectedValue+'. This is not a six-digit RGB color; the picker shows a placeholder, not the current color.'}) : !selectedValue ? jsx('p',{children:'This token uses a theme fallback; the picker shows a placeholder, not the current color.'}) : null,
      jsx('div',{style:{display:'flex',gap:8,flexWrap:'wrap'},children:[button('Revert preview',()=>act(()=>{setDraft(studio.revert(api));setMessage('Preview reverted.');})),button('Reset to original',()=>act(()=>{setDraft(studio.reset(api));setMessage('Original colors previewed.');}))]}),
      jsx('p',{children:[jsx('input',{value:name,onChange:e=>setName(e.target.value),placeholder:'Name this theme',maxLength:80,'aria-label':'Theme name'}),' ',button('Save',()=>act(()=>{const id=studio.save(name,api);setSaved(studio.list(api));setChoice(id);setMessage('Saved. Apply it when ready.');}))]})
    ]}),
    jsx('div',{children:[jsx('select',{value:choice,onChange:e=>setChoice(e.target.value),'aria-label':'Saved theme',children:[jsx('option',{value:'',children:'Choose a saved theme'}),...saved.map(t=>jsx('option',{value:t.name,children:t.label},t.name))]}),' ',button('Apply saved theme',()=>act(()=>{studio.apply(choice,api);setDraft(null);setMessage('Applied. Use the theme picker to return to an earlier theme.');}),!choice)]}),
    button('Restore previous theme',()=>act(()=>{studio.restore(api);setDraft(null);setMessage('Restored previous theme.');})),
    jsx('p',{role:'status',children:message}),
    jsx('p',{children:'Saved designs follow the focused chat owner (connection and profile). Apply and restore require that owner to match the active gateway profile. Preview and applied appearance paint the desktop window; contributed themes also appear in the global picker. Switching chat focus does not create a per-chat theme.'}),
    jsx('p',{children:'Sessions sidebar color is independent. In glass mode it adds a 30% tint over the existing material; the displayed color will vary with the backdrop and tint settings. Chat background is independent and applies in both modes outside glass mode; glass mode keeps its original appearance. Other colors are shared semantic tokens. The editor copies the currently painted palette, not the original full light/dark theme; switching modes may not preserve the original appearance. The picker accepts six-digit RGB; existing non-hex values remain unchanged until edited.'})
  ]});
}

export default { id:'theme-studio', name:'Theme Studio', defaultEnabled:false, register(ctx) {
  const studio = createStudio(ctx);
  ctx.register({id:'page',area:ROUTES_AREA,data:{path:'/theme-studio'},render:()=>jsx(Studio,{studio})});
  ctx.register({id:'nav',area:SIDEBAR_NAV_AREA,data:{path:'/theme-studio',label:'Theme Studio',codicon:'symbol-color'}});
} };
