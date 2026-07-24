import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PHOTO_SERVER_URL } from './config.js?v=20260724-pin-delete-photos';

const configured = !SUPABASE_URL.startsWith('YOUR_') && !SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_');
const masterAccounts = Object.fromEntries([1,2,3,4,5].map(number => [`Master${number}`, `master${number}@example.com`]));
// Data API URL을 실수로 넣어도 Supabase 프로젝트 루트 URL로 정규화합니다.
const PROJECT_URL = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '');
const colors = { coral:'#ed7668', red:'#df5353', orange:'#ef8a3c', amber:'#dea23f', lime:'#93b944', green:'#4da887', teal:'#36a5a3', blue:'#5d8ddd', purple:'#8b72d5', pink:'#d96fa5' };
const reactionTypes = [{ kind:'like', icon:'👍', label:'좋아요' }, { kind:'neutral', icon:'😐', label:'보통' }, { kind:'dislike', icon:'👎', label:'싫어요' }];
const isIphoneSafari = /iPhone|iPod/i.test(navigator.userAgent);
if (isIphoneSafari) document.documentElement.classList.add('ios-compact');
const $ = selector => document.querySelector(selector);
const state = { user:null, profile:null, sessionNickname:'', spaces:[], active:'', pins:[], favorites:new Set(), selected:[], route:[], draftRoute:[], routes:[], activeRouteId:null, routeMode:false, markers:null, locationMarkers:null, channel:null, pending:null, pendingPinBackground:null, commentPin:null, commentSpaceId:null, editingPinId:null, editingPinBackground:null, openPopupPinId:null, openPopupElement:null, popupCloseTimer:null, notifications:[], members:[], messageReads:new Map(), photos:[], photoOrigins:new Map(), backgroundUrls:new Map(), pendingCommentPhotos:[] };
let sb, map, lineLayer, baseLayer, locationWatchId = null, sharingSpaceId = null, routeRequestId = 0, commentOpenRequestId = 0, locationChannel = null, locationPresenceSpace = null, latestLocationPayload = null, nicknamePromptedForSession = false, safetySyncTimer = null, notificationHistoryOpen = false, closingNotificationFromBack = false, mobilePanelHistoryOpen = false, exitConfirmed = false, photoViewerHistoryOpen = false, closingPhotoViewerFromBack = false;
const locationBroadcasts = new Map();

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function show(view) { ['setupView','authView','appView'].forEach(id => $(`#${id}`).classList.toggle('hidden', id !== view)); }
function showDialog(id) {
  const dialog = $(`#${id}`);
  const form = dialog.querySelector('form');
  // Prevent browser autofocus from opening the mobile keyboard as soon as any dialog appears.
  if (form) form.inert = true;
  dialog.showModal();
  requestAnimationFrame(() => { dialog.focus({ preventScroll:true }); if (form) form.inert = false; });
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
async function signOut() { closeDialogs(); await sb.auth.signOut(); }
function closeMobilePanel(fromHistory=false) {
  const aside = $('.app aside');
  if (!aside?.classList.contains('open')) return;
  aside.classList.remove('open');
  if (!fromHistory && mobilePanelHistoryOpen) history.back();
  if (fromHistory) mobilePanelHistoryOpen = false;
}
function toggleMobilePanel() {
  const aside = $('.app aside');
  if (aside.classList.contains('open')) return closeMobilePanel();
  aside.classList.add('open');
  history.pushState({ pinTogetherPanel:'mobile' }, '');
  mobilePanelHistoryOpen = true;
}
function initials(name='나') { return name.trim().slice(0,1); }
function isMasterUser() { return Object.values(masterAccounts).includes(state.user?.email); }
function sessionNicknameKey() { return `pin-together-session-nickname:${state.user?.id || 'guest'}`; }
function activeNickname() { return state.sessionNickname || state.profile?.nickname || '참여자'; }
function needsNicknameSetup() { return isMasterUser() && (!state.profile?.nickname || state.profile.nickname === '여행자' || /^Master[1-5]$/i.test(state.profile.nickname)); }
function spaceName() { return state.active === 'all' ? '전체 지도' : state.spaces.find(s => s.space_id === state.active)?.spaces?.name || '지도'; }
function pinIcon(pin) {
  const routeIndex = (state.routeMode ? state.draftRoute : state.route).findIndex(item => item.id === pin.id);
  const commentBadge = pin.comment_count ? `<i class="pin-comment-badge" aria-label="댓글 ${pin.comment_count}개">💬</i>` : '';
  const unreadBadge = pin.unread_comment_count ? `<i class="pin-unread-comment" aria-label="읽지 않은 댓글 ${pin.unread_comment_count}개"></i>` : '';
  return L.divIcon({ className:'', iconSize:[40,34], iconAnchor:[13,25], html:`<div class="pin-marker" style="background:${colors[pin.color] || colors.coral}"><span>${initials(pin.author_nickname || pin.profiles?.nickname || '나')}</span>${commentBadge}${unreadBadge}${routeIndex >= 0 ? `<i class="route-order"><b>${routeIndex + 1}</b></i>` : ''}</div>` });
}
function routeStorageKey() { return `pin-together-route:${state.user?.id || 'guest'}:${state.active}`; }
function lastSpaceStorageKey() { return `pin-together-last-space:${state.user?.id || 'guest'}`; }
async function rememberActiveSpace() {
  if (!state.user || !state.active || state.active === 'all') return;
  localStorage.setItem(lastSpaceStorageKey(), state.active);
  const { error } = await sb.from('profiles').update({ last_space_id:state.active }).eq('id', state.user.id);
  if (!error && state.profile) state.profile.last_space_id = state.active;
}
function persistRoute() { if (state.active && state.active !== 'all') localStorage.setItem(routeStorageKey(), JSON.stringify(state.route.map(pin => pin.id))); }
function restoreRoute() {
  if (!state.active || state.active === 'all') { state.route = []; return; }
  try { const ids = JSON.parse(localStorage.getItem(routeStorageKey()) || '[]'); state.route = ids.map(id => state.pins.find(pin => pin.id === id)).filter(Boolean); } catch { state.route = []; }
}
function parseTags(text='') { return [...new Set(text.split(',').map(tag => tag.trim().replace(/\s+/g,' ')).filter(Boolean))].slice(0,5); }
function renderTagFilter() {
  const select = $('#tagFilter');
  if (!select) return;
  const previous = select.value;
  const tags = [...new Set(state.pins.flatMap(pin => pin.tags || []))].sort((a,b) => a.localeCompare(b,'ko'));
  select.innerHTML = '<option value="">모든 태그</option>' + tags.map(tag => `<option value="${escapeHtml(tag)}">#${escapeHtml(tag)}</option>`).join('');
  select.value = tags.includes(previous) ? previous : '';
}

function initMap() {
  map = L.map('map', { zoomControl:false }).setView([36.5, 127.8], 7);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  setMapType(localStorage.getItem('pin-together-map-type') || 'road');
  const actions = $('.map-actions');
  actions.insertAdjacentHTML('afterbegin', '<button id="mapTypeButton" type="button">지도 종류</button><div id="mapTypeMenu" class="hidden"><button type="button" data-map-type="road">🗺 기본 지도</button><button type="button" data-map-type="satellite">🛰 위성 지도</button></div>');
  $('#mapTypeButton').addEventListener('click', () => $('#mapTypeMenu').classList.toggle('hidden'));
  document.querySelectorAll('[data-map-type]').forEach(button => button.addEventListener('click', () => { setMapType(button.dataset.mapType); $('#mapTypeMenu').classList.add('hidden'); }));
  lineLayer = L.layerGroup().addTo(map);
  map.on('click', event => {
    closeMobilePanel();
    if (state.pending === 'add') { state.pending = null; $('#addPinButton').classList.remove('active'); openPinDialog(event.latlng); return; }
    if (!state.routeMode) clearRoutePreview();
  });
  map.on('popupopen', event => {
    const element = event.popup.getElement();
    const commentButton = element?.querySelector('[data-popup-comment]');
    const pin = state.pins.find(item => item.id === commentButton?.dataset.popupComment);
    if (!pin) return;
    state.openPopupPinId = pin.id;
    state.openPopupElement = element;
    void loadSpacePhotos(pin.space_id).then(() => applyPinBackground(element, pin));
    clearTimeout(state.popupCloseTimer);
    state.popupCloseTimer = setTimeout(() => { state.openPopupPinId = null; map.closePopup(); }, 30000);
    if (!element.querySelector('.popup-reactions')) {
      commentButton.insertAdjacentHTML('afterend', `<div class="popup-reactions">${reactionMarkup(pin)}</div>`);
      element.querySelectorAll('[data-reaction-pin]').forEach(button => button.addEventListener('click', () => void toggleReaction(button.dataset.reactionPin, button.dataset.reactionKind)));
    }
    if (!canManagePin(pin) || element.querySelector('[data-popup-edit]')) return;
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'favorite-popup';
    editButton.dataset.popupEdit = pin.id;
    editButton.textContent = '✎ 핀 편집';
    editButton.addEventListener('click', () => editPin(pin.id));
    commentButton.insertAdjacentElement('afterend', editButton);
  });
  map.on('popupclose', () => { state.openPopupPinId = null; state.openPopupElement = null; clearTimeout(state.popupCloseTimer); });
  // 앱 화면이 숨김 상태였다가 나타날 때와 창 크기가 바뀔 때 타일 영역을 다시 계산합니다.
  const resizeMap = () => map.invalidateSize({ pan:false, animate:false });
  new ResizeObserver(resizeMap).observe($('#map'));
  window.addEventListener('resize', resizeMap);
}
function setMapType(type) {
  const layers = {
    road: { url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options:{ maxZoom:19, attribution:'© OpenStreetMap contributors' } },
    satellite: { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', options:{ maxZoom:19, attribution:'Tiles © Esri' } },
  };
  const selected = layers[type] || layers.road;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(selected.url, selected.options).addTo(map);
  localStorage.setItem('pin-together-map-type', layers[type] ? type : 'road');
}

function locationIcon(name, own=false) {
  const label = escapeHtml(name || (own ? '나' : '멤버'));
  return L.divIcon({ className:'', iconSize:[38,38], iconAnchor:[19,19], html:`<div class="live-location ${own ? 'own' : ''}" title="${label}">●<small>${label}</small></div>` });
}
function renderSharedLocations(rows=[]) {
  if (!map) return;
  if (!state.locationMarkers) state.locationMarkers = L.layerGroup().addTo(map);
  state.locationMarkers.clearLayers();
  rows.forEach(row => {
    const own = row.user_id === state.user?.id;
    L.marker([row.latitude,row.longitude], { icon:locationIcon(row.nickname, own), zIndexOffset:900 }).addTo(state.locationMarkers)
      .bindPopup(`<strong>${escapeHtml(row.nickname || (own ? '나' : '멤버'))}</strong><br><small>공유 위치 · ${timeText(row.updated_at)}</small>`);
  });
}
function syncLocationPresence() {
  if (!locationChannel) return;
  const now = Date.now();
  const rowsByUser = new Map(Object.values(locationChannel.presenceState()).flat().filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)).map(row => [row.user_id,row]));
  locationBroadcasts.forEach((row, userId) => { if (now - new Date(row.updated_at).getTime() > 35000) locationBroadcasts.delete(userId); else if (!rowsByUser.has(userId)) rowsByUser.set(userId,row); });
  renderSharedLocations([...rowsByUser.values()]);
}
function connectLocationPresence() {
  if (state.active === 'all') { locationChannel?.unsubscribe(); locationChannel = null; locationPresenceSpace = null; renderSharedLocations(); return; }
  if (locationPresenceSpace === state.active && locationChannel) return;
  locationChannel?.unsubscribe();
  locationPresenceSpace = state.active;
  locationChannel = sb.channel(`space-location:${state.active}`, { config:{ presence:{ key:state.user.id } } })
    .on('presence', { event:'sync' }, syncLocationPresence)
    .on('broadcast', { event:'location' }, ({ payload }) => { if (payload?.user_id && Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude)) { locationBroadcasts.set(payload.user_id,payload); syncLocationPresence(); } })
    .subscribe(async status => { if (status === 'SUBSCRIBED' && latestLocationPayload && sharingSpaceId === state.active) { await locationChannel.track(latestLocationPayload); await locationChannel.send({ type:'broadcast', event:'location', payload:latestLocationPayload }); } });
}
async function publishLocation(position) {
  if (!sharingSpaceId || sharingSpaceId !== state.active) return;
  const { latitude, longitude, accuracy } = position.coords;
  latestLocationPayload = { user_id:state.user.id, nickname:activeNickname(), latitude, longitude, accuracy, updated_at:new Date().toISOString() };
  if (!locationChannel) connectLocationPresence();
  locationBroadcasts.set(state.user.id, latestLocationPayload);
  const result = await locationChannel.track(latestLocationPayload);
  await locationChannel.send({ type:'broadcast', event:'location', payload:latestLocationPayload });
  syncLocationPresence();
  if (result !== 'ok') toast('위치 공유 연결에 실패했습니다.');
}
async function stopLocationShare(silent=false) {
  if (locationWatchId !== null) navigator.geolocation?.clearWatch(locationWatchId);
  locationWatchId = null;
  sharingSpaceId = null;
  latestLocationPayload = null;
  await locationChannel?.untrack();
  $('#locationShareButton').textContent = '위치 공유 시작';
  $('#locationShareButton').classList.remove('active');
  if (!silent) toast('내 위치 공유를 중지했습니다.');
}
function startLocationShare() {
  if (locationWatchId !== null) return stopLocationShare();
  if (state.active === 'all') return toast('위치를 공유할 여행 공간을 먼저 선택해 주세요.');
  if (!navigator.geolocation) return toast('이 브라우저는 위치 기능을 지원하지 않습니다.');
  sharingSpaceId = state.active;
  connectLocationPresence();
  locationWatchId = navigator.geolocation.watchPosition(publishLocation, () => { toast('위치 권한이 필요합니다.'); stopLocationShare(true); }, { enableHighAccuracy:true, maximumAge:10000, timeout:15000 });
  $('#locationShareButton').textContent = '위치 공유 중지';
  $('#locationShareButton').classList.add('active');
  toast('같은 여행 공간 멤버에게 내 위치를 공유합니다.');
}

async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
  if (error) throw error;
  state.profile = data;
  $('#profileButton').textContent = initials(data.nickname);
}
async function loadSpaces() {
  const { data, error } = await sb.from('space_members').select('space_id, role, spaces(id,name,owner_id,created_at)').eq('user_id', state.user.id).order('joined_at');
  if (error) throw error;
  state.spaces = data || [];
  const select = $('#spaceSelect');
  select.innerHTML = '<option value="all">전체 지도</option>' + state.spaces.map(row => `<option value="${row.space_id}">${escapeHtml(row.spaces.name)}</option>`).join('');
  const savedSpace = state.profile?.last_space_id || localStorage.getItem(lastSpaceStorageKey());
  if (savedSpace && state.spaces.some(space => space.space_id === savedSpace)) state.active = savedSpace;
  else if (!state.active || (state.active !== 'all' && !state.spaces.some(s => s.space_id === state.active))) state.active = state.spaces[0]?.space_id || 'all';
  select.value = state.active;
}
async function loadMembers() {
  if (!state.active || state.active === 'all') { state.members = []; renderMembers(); return; }
  const { data, error } = await sb.from('space_members').select('user_id,role,joined_at').eq('space_id', state.active).order('joined_at');
  if (error) { state.members = []; renderMembers(); return; }
  const ids = (data || []).map(member => member.user_id);
  const { data: profiles } = ids.length ? await sb.from('profiles').select('id,nickname').in('id', ids) : { data:[] };
  const names = new Map((profiles || []).map(profile => [profile.id, profile.nickname]));
  state.members = (data || []).map(member => ({ ...member, nickname:names.get(member.user_id) || '참여자' }));
  renderMembers();
}
function renderMembers() {
  const list = $('#memberList'); if (!list) return;
  $('#memberCount').textContent = state.members.length || '';
  const labels = { owner:'소유자', editor:'편집 가능', viewer:'보기 전용' };
  const canRemove = currentRole() === 'owner';
  list.innerHTML = state.members.map(member => `<article class="member-item"><span class="member-avatar">${escapeHtml(initials(member.nickname))}</span><div><strong>${escapeHtml(member.nickname)}${member.user_id === state.user?.id ? ' (나)' : ''}</strong><small>${labels[member.role] || member.role}</small></div>${canRemove && member.role !== 'owner' && member.user_id !== state.user?.id ? `<button type="button" class="member-remove" data-remove-member="${member.user_id}">퇴장</button>` : ''}</article>`).join('') || '<p class="label">여행 공간을 선택해 주세요.</p>';
  list.querySelectorAll('[data-remove-member]').forEach(button => button.addEventListener('click', () => void removeMember(button.dataset.removeMember)));
}
async function removeMember(userId) {
  if (state.active === 'all' || currentRole() !== 'owner') return toast('공간 소유자만 참가자를 퇴장시킬 수 있습니다.');
  const member = state.members.find(item => item.user_id === userId);
  if (!member || member.role === 'owner' || member.user_id === state.user.id) return;
  if (!confirm(`'${member.nickname}' 님을 이 여행 공간에서 퇴장시킬까요?`)) return;
  const { error } = await sb.from('space_members').delete().eq('space_id', state.active).eq('user_id', userId);
  if (error) return toast(`참가자 퇴장에 실패했습니다: ${error.message}`);
  await loadMembers();
  toast(`${member.nickname} 님을 퇴장시켰습니다.`);
}
async function loadPins() {
  // 기본 schema.sql만 실행한 상태에서도 동작하도록 생성 시각 기준으로 정렬합니다.
  const query = sb.from('pins').select('*, profiles!pins_author_id_fkey(nickname,pin_color)').order('created_at', { ascending:false });
  const { data, error } = state.active === 'all' ? await query : await query.eq('space_id', state.active);
  if (error) throw error;
  state.pins = data || [];
  const ids = state.pins.map(pin => pin.id);
  const { data: tagRows } = ids.length ? await sb.from('pin_tags').select('pin_id,tag').in('pin_id',ids) : { data:[] };
  const tagsByPin = new Map();
  (tagRows || []).forEach(row => tagsByPin.set(row.pin_id, [...(tagsByPin.get(row.pin_id) || []), row.tag]));
  state.pins.forEach(pin => pin.tags = tagsByPin.get(pin.id) || []);
  const { data: reactionRows } = ids.length ? await sb.from('pin_reactions').select('pin_id,user_id,kind,profiles!pin_reactions_user_id_fkey(nickname)').in('pin_id', ids) : { data:[] };
  const reactionsByPin = new Map();
  (reactionRows || []).forEach(row => reactionsByPin.set(row.pin_id, [...(reactionsByPin.get(row.pin_id) || []), row]));
  state.pins.forEach(pin => pin.reactions = reactionsByPin.get(pin.id) || []);
  const { data: commentRows } = ids.length ? await sb.from('pin_comments').select('pin_id,author_id,created_at').in('pin_id', ids) : { data:[] };
  const commentCounts = new Map();
  (commentRows || []).forEach(row => commentCounts.set(row.pin_id, (commentCounts.get(row.pin_id) || 0) + 1));
  state.pins.forEach(pin => pin.comment_count = commentCounts.get(pin.id) || 0);
  const { data: commentReadRows } = ids.length ? await sb.from('pin_comment_reads').select('pin_id,last_read_at').eq('user_id', state.user.id).in('pin_id', ids) : { data:[] };
  const readAtByPin = new Map((commentReadRows || []).map(row => [row.pin_id, new Date(row.last_read_at).getTime()]));
  const unreadCounts = new Map();
  (commentRows || []).forEach(row => {
    if (row.author_id === state.user.id || new Date(row.created_at).getTime() <= (readAtByPin.get(row.pin_id) || 0)) return;
    unreadCounts.set(row.pin_id, (unreadCounts.get(row.pin_id) || 0) + 1);
  });
  state.pins.forEach(pin => pin.unread_comment_count = unreadCounts.get(pin.id) || 0);
  renderTagFilter();
  const { data: favs } = ids.length ? await sb.from('shared_favorite_pins').select('pin_id').in('pin_id', ids) : { data:[] };
  state.favorites = new Set((favs || []).map(f => f.pin_id));
  await loadSharedRoute();
  if (map) updateMeasure();
  renderPins();
}
async function loadMessages() {
  if (state.active === 'all') { $('#messages').innerHTML = '<p class="label">전체 지도에서는 채팅을 볼 수 없습니다. 여행 공간을 선택하세요.</p>'; return; }
  const { data, error } = await sb.from('messages').select('*, profiles!messages_author_id_fkey(nickname)').eq('space_id', state.active).order('created_at').limit(100);
  if (error) throw error;
  const ids = (data || []).map(message => message.id);
  const { data: readRows } = ids.length ? await sb.from('message_reads').select('message_id,user_id').in('message_id',ids) : { data:[] };
  state.messageReads = new Map();
  (readRows || []).forEach(row => state.messageReads.set(row.message_id, (state.messageReads.get(row.message_id) || 0) + 1));
  $('#messages').innerHTML = (data || []).map(message => `<article class="msg ${message.author_id === state.user.id ? 'mine' : ''}"><div class="bubble">${escapeHtml(message.body)}</div><small class="message-meta">${escapeHtml(message.profiles?.nickname || '참여자')} · ${timeText(message.created_at)}${message.author_id === state.user.id && state.messageReads.get(message.id) ? ` <span class="read-count">읽음 ${state.messageReads.get(message.id)}</span>` : ''}</small></article>`).join('');
  $('#messages').scrollTop = $('#messages').scrollHeight;
  if ($('#chatDialog').open) await markMessagesRead(data || []);
}
async function markMessagesRead(messages) {
  const rows = messages.filter(message => message.author_id !== state.user.id).map(message => ({ message_id:message.id, user_id:state.user.id }));
  if (rows.length) await sb.from('message_reads').upsert(rows, { onConflict:'message_id,user_id', ignoreDuplicates:true });
  await loadUnreadCount();
}
async function loadUnreadCount() {
  if (state.active === 'all') { $('#chatUnreadBadge').classList.add('hidden'); return; }
  const { data: messages } = await sb.from('messages').select('id,author_id').eq('space_id',state.active).neq('author_id',state.user.id).limit(200);
  const ids = (messages || []).map(message => message.id);
  const { data: readRows } = ids.length ? await sb.from('message_reads').select('message_id').eq('user_id',state.user.id).in('message_id',ids) : { data:[] };
  const read = new Set((readRows || []).map(row => row.message_id));
  const unread = ids.filter(id => !read.has(id)).length;
  $('#chatUnreadBadge').textContent = unread || '';
  $('#chatUnreadBadge').classList.toggle('hidden', !unread);
}
async function photoHeaders() {
  const { data } = await sb.auth.getSession();
  if (!data.session?.access_token) throw new Error('사진을 보려면 다시 로그인해 주세요.');
  return { Authorization:`Bearer ${data.session.access_token}` };
}
async function photoFetch(path, options={}) {
  const headers = { ...(await photoHeaders()), ...(options.headers || {}) };
  const response = await fetch(`${PHOTO_SERVER_URL}${path}`, { ...options, headers });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || '사진 서버에 연결하지 못했습니다.'); }
  return response;
}
async function loadSpacePhotos(spaceId=state.active) {
  if (!spaceId || spaceId === 'all') { state.photos = []; return; }
  try { state.photos = (await (await photoFetch(`/spaces/${spaceId}/photos`)).json()).items || []; await loadPhotoOrigins(); void preloadPinBackgrounds(); }
  catch { state.photos = []; }
}
async function loadPhotoOrigins() {
  const commentIds = [...new Set(state.photos.filter(photo => photo.source_type === 'comment').map(photo => photo.source_id))];
  state.photoOrigins = new Map(); if (!commentIds.length) return;
  const { data } = await sb.from('pin_comments').select('id,pin_id').in('id', commentIds);
  (data || []).forEach(comment => { const pin = state.pins.find(item => item.id === comment.pin_id); if (pin) state.photoOrigins.set(comment.id, pin); });
}
function photoByComment(commentId) { return state.photos.filter(photo => photo.source_type === 'comment' && photo.source_id === commentId); }
function backgroundPhoto(pinId) { return state.photos.find(photo => photo.source_type === 'pin_background' && photo.source_id === pinId); }
async function preloadPinBackgrounds() {
  await Promise.all(state.photos.filter(photo => photo.source_type === 'pin_background' && !state.backgroundUrls.has(photo.id)).map(async photo => {
    try { const blob = await (await photoFetch(`/photos/${photo.id}`)).blob(); state.backgroundUrls.set(photo.id, URL.createObjectURL(blob)); } catch {}
  }));
  paintPinListBackgrounds();
}
async function removePinBackground(pinId) {
  const photos = state.photos.filter(photo => photo.source_type === 'pin_background' && photo.source_id === pinId);
  await Promise.all(photos.map(photo => photoFetch(`/photos/${photo.id}`, { method:'DELETE' })));
  photos.forEach(photo => { const url = state.backgroundUrls.get(photo.id); if (url) URL.revokeObjectURL(url); state.backgroundUrls.delete(photo.id); });
  await loadSpacePhotos();
}
async function uploadPinBackground(pinId, file) {
  if (!file) return;
  const form = new FormData(); form.append('space_id', state.active); form.append('source_type', 'pin_background'); form.append('source_id', pinId); form.append('tags', '[]'); form.append('file', file);
  await photoFetch('/photos', { method:'POST', body:form });
}
async function applyPinBackground(element, pin) {
  const target = element?.querySelector?.('.leaflet-popup-content-wrapper') || element;
  const photo = pin && backgroundPhoto(pin.id); if (!target) return; if (!photo) { target.style.backgroundImage = ''; return; }
  try { let url = state.backgroundUrls.get(photo.id); if (!url) { const blob = await (await photoFetch(`/photos/${photo.id}`)).blob(); url = URL.createObjectURL(blob); state.backgroundUrls.set(photo.id, url); } target.style.backgroundImage = `linear-gradient(#ffffff78,#ffffff78),url(${url})`; target.style.backgroundSize = 'cover'; target.style.backgroundPosition = 'center'; } catch {}
}
function paintPinListBackgrounds() {
  document.querySelectorAll('.pin-item[data-pin]').forEach(item => {
    const photo = backgroundPhoto(item.dataset.pin);
    const url = photo && state.backgroundUrls.get(photo.id);
    item.classList.toggle('has-pin-background', Boolean(url));
    item.style.setProperty('--pin-background-image', url ? `url(${url})` : 'none');
  });
}
function photoMarkup(photo, className='') { return `<button type="button" class="photo-thumb ${className}" data-view-photo="${photo.id}" title="사진 크게 보기"><img data-protected-photo="${photo.id}" alt="첨부 사진" /></button>`; }
async function hydratePhotos(root=document) {
  await Promise.all([...root.querySelectorAll('[data-protected-photo]')].map(async image => {
    try { const blob = await (await photoFetch(`/photos/${image.dataset.protectedPhoto}`)).blob(); image.src = URL.createObjectURL(blob); image.onload = () => URL.revokeObjectURL(image.src); }
    catch { image.closest('.photo-thumb')?.classList.add('unavailable'); }
  }));
  root.querySelectorAll('[data-view-photo]').forEach(button => button.addEventListener('click', () => openPhotoViewer(button.dataset.viewPhoto)));
}
function renderPhotoGallery() {
  const grid = $('#photoGrid'); if (!grid) return;
  const query = $('#photoSearch')?.value.trim().toLowerCase() || '';
  const albumPhotos = state.photos.filter(photo => photo.source_type !== 'pin_background');
  const photos = albumPhotos.filter(photo => `${photo.tags.join(' ')} ${photo.source_type}`.toLowerCase().includes(query));
  $('#photoCount').textContent = albumPhotos.length;
  grid.innerHTML = photos.map(photo => { const origin = state.photoOrigins.get(photo.source_id); return `<article class="gallery-card">${photoMarkup(photo)}<div class="gallery-meta"><button type="button" class="photo-origin" data-photo-origin="${photo.id}">${origin ? `📍 ${escapeHtml(origin.title)} · 댓글` : '댓글 사진'}</button><span>${photo.tags.map(tag => `#${escapeHtml(tag)}`).join(' ') || '태그 없음'}</span><button type="button" data-edit-photo="${photo.id}">태그</button><button type="button" data-delete-photo="${photo.id}">삭제</button></div></article>`; }).join('') || '<p class="label">아직 사진이 없습니다.</p>';
  void hydratePhotos(grid);
  grid.querySelectorAll('[data-edit-photo]').forEach(button => button.addEventListener('click', () => editPhotoTags(button.dataset.editPhoto)));
  grid.querySelectorAll('[data-delete-photo]').forEach(button => button.addEventListener('click', () => deletePhoto(button.dataset.deletePhoto)));
  grid.querySelectorAll('[data-photo-origin]').forEach(button => button.addEventListener('click', () => { const photo = state.photos.find(item => item.id === button.dataset.photoOrigin); const pin = photo && state.photoOrigins.get(photo.source_id); if (!pin) return toast('원래 핀 정보를 찾을 수 없습니다.'); map.flyTo([pin.latitude,pin.longitude], 15); void openComments(pin.id); }));
}
async function editPhotoTags(photoId) {
  const photo = state.photos.find(item => item.id === photoId); if (!photo) return;
  const value = prompt('사진 태그를 쉼표로 구분해 입력하세요.', photo.tags.join(', ')); if (value === null) return;
  const tags = [...new Set(value.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 10);
  try { await photoFetch(`/photos/${photoId}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ tags }) }); await loadSpacePhotos(); renderPhotoGallery(); }
  catch (error) { toast(error.message); }
}
async function deletePhoto(photoId) {
  if (!confirm('이 사진을 삭제할까요?')) return;
  try { await photoFetch(`/photos/${photoId}`, { method:'DELETE' }); await loadSpacePhotos(); renderPhotoGallery(); if (state.commentPin) await openComments(state.commentPin); }
  catch (error) { toast(error.message); }
}
async function openPhotoViewer(photoId) {
  const image = $('#photoViewerImage'), stage = $('.photo-viewer-stage'); $('#photoViewerDialog').showModal(); if (!photoViewerHistoryOpen) { history.pushState({ pinTogetherModal:'photo-viewer' }, ''); photoViewerHistoryOpen = true; } image.removeAttribute('src'); image.dataset.scale = '1'; image.style.transform = ''; image.style.width = ''; image.style.height = '';
  try { const blob = await (await photoFetch(`/photos/${photoId}`)).blob(); image.src = URL.createObjectURL(blob); image.onload = () => { const ratio = Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight); image.style.width = `${Math.max(1, Math.floor(image.naturalWidth * ratio))}px`; image.style.height = `${Math.max(1, Math.floor(image.naturalHeight * ratio))}px`; URL.revokeObjectURL(image.src); }; }
  catch { $('#photoViewerStatus').textContent = '사진을 불러올 수 없습니다.'; }
}
function bindPhotoViewer() {
  const image = $('#photoViewerImage'); const pointers = new Map(); let baseDistance = 0, baseScale = 1, x = 0, y = 0, startX = 0, startY = 0;
  const apply = () => { const scale = Number(image.dataset.scale || 1); image.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
  image.addEventListener('pointerdown', event => { image.setPointerCapture(event.pointerId); pointers.set(event.pointerId, event); if (pointers.size === 1) { startX = event.clientX - x; startY = event.clientY - y; } else if (pointers.size === 2) { const [a,b] = [...pointers.values()]; baseDistance = Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); baseScale = Number(image.dataset.scale || 1); } });
  image.addEventListener('pointermove', event => { if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, event); if (pointers.size === 2) { const [a,b] = [...pointers.values()]; const distance = Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); image.dataset.scale = String(Math.min(4, Math.max(1, baseScale * distance / baseDistance))); } else if (pointers.size === 1 && Number(image.dataset.scale || 1) > 1) { x = event.clientX - startX; y = event.clientY - startY; } apply(); });
  const release = event => { pointers.delete(event.pointerId); if (!pointers.size && Number(image.dataset.scale || 1) <= 1) { x = 0; y = 0; apply(); } }; image.addEventListener('pointerup', release); image.addEventListener('pointercancel', release);
}
function renderCommentPhotoPreview() {
  const preview = $('#commentPhotoPreview');
  preview.innerHTML = state.pendingCommentPhotos.map((item, index) => `<article class="pending-photo"><img src="${item.url}" alt="선택한 사진" /><input data-photo-tags="${index}" value="${escapeHtml(item.tags)}" maxlength="100" placeholder="태그: 예) 카페, 야경" /><button type="button" data-remove-photo="${index}" aria-label="사진 제거">×</button></article>`).join('');
  preview.querySelectorAll('[data-photo-tags]').forEach(input => input.addEventListener('input', () => { state.pendingCommentPhotos[Number(input.dataset.photoTags)].tags = input.value; }));
  preview.querySelectorAll('[data-remove-photo]').forEach(button => button.addEventListener('click', () => { const [removed] = state.pendingCommentPhotos.splice(Number(button.dataset.removePhoto), 1); URL.revokeObjectURL(removed.url); renderCommentPhotoPreview(); }));
}
async function uploadCommentPhotos(commentId, items) {
  for (const item of items) { const form = new FormData(); form.append('space_id', state.commentSpaceId || state.active); form.append('source_type', 'comment'); form.append('source_id', commentId); form.append('tags', JSON.stringify(item.tags.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean))); form.append('file', item.file); await photoFetch('/photos', { method:'POST', body:form }); }
}
function reactionMarkup(pin) {
  return `<div class="pin-reactions">${reactionTypes.map(type => {
    const rows = (pin.reactions || []).filter(row => row.kind === type.kind);
    const names = rows.map(row => row.profiles?.nickname || '참여자');
    const people = names.length ? `${names.slice(0,2).join(', ')}${names.length > 2 ? ` 외 ${names.length - 2}명` : ''}` : '';
    return `<button type="button" class="reaction-button ${rows.some(row => row.user_id === state.user?.id) ? 'active' : ''}" data-reaction-pin="${pin.id}" data-reaction-kind="${type.kind}" title="${type.label}${people ? `: ${people}` : ''}">${type.icon}<small>${people || '0'}</small></button>`;
  }).join('')}</div>`;
}
async function toggleReaction(pinId, kind) {
  const pin = state.pins.find(item => item.id === pinId);
  if (!pin) return;
  const mine = (pin.reactions || []).find(row => row.user_id === state.user.id);
  const request = mine?.kind === kind
    ? sb.from('pin_reactions').delete().eq('pin_id', pinId).eq('user_id', state.user.id)
    : sb.from('pin_reactions').upsert({ pin_id:pinId, user_id:state.user.id, kind }, { onConflict:'pin_id,user_id' });
  const { error } = await request;
  if (error) return toast('반응 기능을 사용하려면 pin-reactions-migration.sql을 실행해 주세요.');
  pin.reactions = mine?.kind === kind
    ? (pin.reactions || []).filter(row => row.user_id !== state.user.id)
    : [...(pin.reactions || []).filter(row => row.user_id !== state.user.id), { pin_id:pinId, user_id:state.user.id, kind, profiles:{ nickname:activeNickname() } }];
  refreshOpenPopupReactions();
  await loadPins();
  requestAnimationFrame(refreshOpenPopupReactions);
  setTimeout(refreshOpenPopupReactions, 120);
}
function refreshOpenPopupReactions() {
  if (!state.openPopupPinId || !map) return;
  const pin = state.pins.find(item => item.id === state.openPopupPinId);
  const popup = map.getPopup?.()?.getElement?.() || state.openPopupElement;
  if (popup?.isConnected) state.openPopupElement = popup;
  const holder = popup?.querySelector('.popup-reactions');
  if (!pin || !holder) return;
  holder.innerHTML = reactionMarkup(pin);
  holder.querySelectorAll('[data-reaction-pin]').forEach(button => button.addEventListener('click', () => void toggleReaction(button.dataset.reactionPin, button.dataset.reactionKind)));
}
function renderPins() {
  const keepMapPopup = Boolean(state.openPopupPinId);
  if (state.markers && !keepMapPopup) state.markers.clearLayers(); else if (!state.markers) state.markers = L.layerGroup().addTo(map);
  const search = $('#pinSearch').value.trim().toLowerCase();
  const tag = $('#tagFilter')?.value || '';
  const pins = state.pins.filter(pin => `${pin.title} ${pin.note} ${(pin.tags || []).join(' ')}`.toLowerCase().includes(search) && (!tag || (pin.tags || []).includes(tag)));
  $('#pinCount').textContent = pins.length;
  $('#favoriteCount').textContent = pins.filter(pin => state.favorites.has(pin.id)).length || '';
  const displayRoute = state.routeMode ? state.draftRoute : state.route;
  const row = pin => `<div class="pin-item ${state.selected.some(p => p.id === pin.id) || displayRoute.some(p => p.id === pin.id) ? 'selected' : ''}" data-pin="${pin.id}"><span class="dot" style="background:${colors[pin.color] || colors.coral}"></span><button class="pin-open" data-pin="${pin.id}"><strong>${escapeHtml(pin.title)}${pin.comment_count ? ` <span class="pin-comment-count" title="댓글 ${pin.comment_count}개">↳ ${pin.comment_count}</span>` : ''}${pin.unread_comment_count ? ` <i class="pin-unread-dot" title="읽지 않은 댓글 ${pin.unread_comment_count}개" aria-label="읽지 않은 댓글 ${pin.unread_comment_count}개"></i>` : ''}</strong><small class="pin-note">${escapeHtml(pin.note || '메모 없음')}</small><small>${escapeHtml(pin.author_nickname || pin.profiles?.nickname || '참여자')} · ${timeFull(pin.created_at)}</small>${(pin.tags || []).length ? `<span class="pin-tags">${pin.tags.map(tag => `<i class="pin-tag">#${escapeHtml(tag)}</i>`).join('')}</span>` : ''}</button><span class="pin-actions"><button data-favorite="${pin.id}" title="즐겨찾기">${state.favorites.has(pin.id) ? '★' : '☆'}</button><button data-comment="${pin.id}" title="댓글">💬</button>${canManagePin(pin) ? `<button data-edit="${pin.id}" title="핀 편집">✎</button><button data-delete-pin="${pin.id}" title="핀 삭제">×</button>` : ''}</span></div>`;
  $('#favoriteList').innerHTML = pins.filter(pin => state.favorites.has(pin.id)).map(row).join('') || '<small>즐겨찾기한 핀이 없습니다.</small>';
  $('#pinList').innerHTML = pins.map(row).join('') || '<small>아직 핀이 없습니다.</small>';
  paintPinListBackgrounds();
  document.querySelectorAll('.pin-item').forEach(item => {
    const pin = state.pins.find(entry => entry.id === item.dataset.pin);
    if (!pin) return;
    item.insertAdjacentHTML('beforeend', reactionMarkup(pin));
  });
  if (!keepMapPopup) pins.forEach(pin => L.marker([pin.latitude, pin.longitude], { icon:pinIcon(pin) }).addTo(state.markers).bindPopup(`<strong>${escapeHtml(pin.title)}</strong><br><small>작성자: ${escapeHtml(pin.author_nickname || pin.profiles?.nickname || '참여자')}</small><br><small>${escapeHtml(pin.note || '메모 없음')}</small><br><small>핀 생성: ${timeFull(pin.created_at)}</small><br><button class="favorite-popup" data-favorite="${pin.id}">☆ 즐겨찾기</button> <button class="favorite-popup" data-popup-comment="${pin.id}">💬 댓글 보기</button>`).on('click', () => { if (state.routeMode) selectPin(pin); }).on('popupopen', event => event.popup.getElement()?.querySelector('[data-popup-comment]')?.addEventListener('click', () => openComments(pin.id))));
  document.querySelectorAll('.pin-open').forEach(el => el.addEventListener('click', () => { const pin = state.pins.find(p => p.id === el.dataset.pin); map.flyTo([pin.latitude, pin.longitude], 15); selectPin(pin); }));
  document.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => editPin(el.dataset.edit)));
  document.querySelectorAll('[data-delete-pin]').forEach(el => el.addEventListener('click', () => deletePin(el.dataset.deletePin)));
  document.querySelectorAll('[data-comment]').forEach(el => el.addEventListener('click', () => openComments(el.dataset.comment)));
  document.querySelectorAll('[data-favorite]').forEach(el => el.addEventListener('click', () => toggleFavorite(el.dataset.favorite)));
  document.querySelectorAll('[data-reaction-pin]').forEach(el => el.addEventListener('click', () => void toggleReaction(el.dataset.reactionPin, el.dataset.reactionKind)));
  document.querySelectorAll('.favorite-popup').forEach(el => el.addEventListener('click', () => toggleFavorite(el.dataset.favorite)));
  refreshOpenPopupReactions();
  renderRoutes();
}
function renderRoutes() {
  const list = $('#routeList');
  if (!list) return;
  $('#routeCount').textContent = state.routes.length;
  if (state.active === 'all') { list.innerHTML = '<small>여행 공간을 선택하면 공유 경로를 볼 수 있습니다.</small>'; return; }
  if (!state.routes.length) { list.innerHTML = '<small>아직 공유된 경로가 없습니다. 경로 지정에서 핀 두 개를 선택하세요.</small>'; return; }
  list.innerHTML = state.routes.map((route,index) => `<button class="route-item ${route.id === state.activeRouteId ? 'selected' : ''}" data-route="${route.id}"><b>${index + 1}</b><span><strong>${escapeHtml(route.name)}</strong><small>${escapeHtml(route.pins.map(pin => pin.title).join(' → ') || '핀 정보 없음')}</small></span></button>`).join('');
  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => { const route = state.routes.find(item => item.id === button.dataset.route); if (!route) return; state.activeRouteId = route.id; state.route = route.pins; updateMeasure(); renderPins(); if (route.pins[0]) map.flyTo([route.pins[0].latitude,route.pins[0].longitude],15); }));
}
function selectPin(pin) {
  if (state.routeMode) {
    const index = state.draftRoute.findIndex(p => p.id === pin.id);
    index >= 0 ? state.draftRoute.splice(index, 1) : state.draftRoute.push(pin);
    if (state.draftRoute.length === 2) {
      const routePins = [...state.draftRoute];
      state.routeMode = false;
      state.draftRoute = [];
      $('#routeButton').classList.remove('active');
      void saveSharedRoute(routePins);
      toast('두 핀 경로를 확정했습니다. 새 경로를 만들려면 경로 지정을 다시 누르세요.');
    }
  }
  else {
    if (state.route.length) state.route = [];
    state.activeRouteId = null;
    const index = state.selected.findIndex(p => p.id === pin.id); index >= 0 ? state.selected.splice(index, 1) : state.selected.push(pin); if (state.selected.length > 2) state.selected.shift();
  }
  $('#measureCard').classList.remove('hidden');
  updateMeasure(); renderPins();
}
function clearRoutePreview() {
  if (!state.route.length && !state.draftRoute.length && !state.selected.length) return;
  state.route = [];
  state.draftRoute = [];
  state.activeRouteId = null;
  state.selected = [];
  lineLayer?.clearLayers();
  $('#measureCard').classList.add('hidden');
  renderPins();
}
async function loadSharedRoute() {
  if (state.active === 'all') { state.route = []; state.draftRoute = []; state.routes = []; state.activeRouteId = null; return; }
  const { data, error } = await sb.from('space_routes').select('id,name,created_at,updated_at,route_stops(pin_id,stop_order)').eq('space_id',state.active).order('created_at');
  if (error) { state.routes = []; state.route = []; return; }
  state.routes = (data || []).map(route => ({ ...route, pins:(route.route_stops || []).sort((a,b) => a.stop_order - b.stop_order).map(stop => state.pins.find(pin => pin.id === stop.pin_id)).filter(Boolean) }));
  if (!state.routes.some(route => route.id === state.activeRouteId)) { state.activeRouteId = null; state.route = []; }
  else state.route = state.routes.find(route => route.id === state.activeRouteId).pins;
}
async function saveSharedRoute(routePins) {
  if (state.active === 'all' || routePins.length !== 2) return;
  if (currentRole() === 'viewer') return toast('보기 전용 멤버는 경로를 저장할 수 없습니다.');
  let name = `경로 ${state.routes.length + 1}`;
  let { data, error: routeError } = await sb.from('space_routes').insert({ space_id:state.active, name, created_by:state.user.id, updated_by:state.user.id }).select('id').single();
  if (routeError?.code === '23505') { name = `경로 ${Date.now()}`; ({ data, error:routeError } = await sb.from('space_routes').insert({ space_id:state.active, name, created_by:state.user.id, updated_by:state.user.id }).select('id').single()); }
  if (routeError) return toast('공유 경로 DB 설정이 필요합니다. SQL 실행 후 다시 시도해 주세요.');
  const routeId = data.id;
  const { error } = await sb.from('route_stops').insert(routePins.map((pin,index) => ({ route_id:routeId, pin_id:pin.id, stop_order:index + 1 })));
  if (error) return toast('공유 경로 저장에 실패했습니다.');
  state.activeRouteId = routeId;
  await loadSharedRoute();
  updateMeasure(); renderPins();
  toast('여행 공간 멤버에게 경로를 공유했습니다.');
}
function updateMeasure() {
  lineLayer.clearLayers();
  const route = state.routeMode ? state.draftRoute : state.route.length ? state.route : state.selected;
  const showingRoute = state.routeMode || state.route.length >= 2;
  if (!route.length && !state.routeMode) { $('#measureCard').classList.add('hidden'); return; }
  $('#measureCard').classList.remove('hidden');
  $('#measureTitle').textContent = showingRoute ? (state.routeMode ? '경로 지정' : '공유 경로') : '거리 측정';
  if (route.length < 2) { $('#measureValue').textContent = `${route.length}/2개 핀 선택됨`; $('#measureHint').textContent = state.routeMode ? '연결할 핀을 1번부터 순서대로 선택하세요. 선택 즉시 자동 저장됩니다.' : '핀 두 개를 선택하세요.'; return; }
  const distance = route.slice(1).reduce((sum, pin, index) => sum + map.distance([route[index].latitude, route[index].longitude], [pin.latitude, pin.longitude]), 0) / 1000;
  L.polyline(route.map(pin => [pin.latitude, pin.longitude]), { color:showingRoute ? colors.coral : '#1f2d3d', weight:4, dashArray:showingRoute ? null : '6 7' }).addTo(lineLayer);
  if (showingRoute) void drawRoadRoute(route, true);
  $('#measureValue').textContent = showingRoute ? `${route.length}개 장소 · ${distance.toFixed(2)} km` : `${route[0].title} ↔ ${route[1].title}: ${distance.toFixed(2)} km`;
  $('#measureHint').textContent = showingRoute ? `${route.map((p,i) => `${i+1}. ${p.title}`).join(' → ')} · ${state.routeMode ? '두 번째 핀을 고르면 자동 저장됩니다.' : '저장된 공유 경로입니다.'}` : '두 핀 사이의 직선거리입니다.';
}
async function drawRoadRoute(route, showingRoute) {
  const requestId = ++routeRequestId;
  try {
    const coordinates = route.map(pin => `${pin.longitude},${pin.latitude}`).join(';');
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`);
    const json = await response.json();
    if (requestId !== routeRequestId || !json.routes?.[0]) return;
    const result = json.routes[0];
    lineLayer.clearLayers();
    L.geoJSON(result.geometry, { style:{ color:showingRoute ? colors.coral : '#1f2d3d', weight:4 } }).addTo(lineLayer);
    $('#measureHint').textContent = `실제 도로 기준 ${Math.max(1,Math.round(result.duration / 60))}분 · ${(result.distance / 1000).toFixed(1)} km`;
  } catch {
    // Keep the straight-line route already drawn when the public routing service is unavailable.
  }
}
function openPinDialog(latlng) {
  if (state.active === 'all') return toast('핀을 추가할 여행 공간을 먼저 선택해 주세요.');
  state.pending = latlng;
  $('#pinColor').value = state.profile.pin_color;
  const form = $('#pinForm');
  // Keep the dialog itself focused while it opens so mobile keyboards do not appear automatically.
  form.inert = true;
  showDialog('pinDialog');
  requestAnimationFrame(() => { $('#pinDialog').focus({ preventScroll:true }); form.inert = false; });
}
async function createPin(event) {
  event.preventDefault(); if (!state.pending || state.active === 'all') return;
  const { data, error } = await sb.from('pins').insert({ space_id:state.active, author_id:state.user.id, title:$('#pinTitle').value.trim(), note:$('#pinNote').value.trim(), color:$('#pinColor').value, latitude:state.pending.lat, longitude:state.pending.lng }).select().single();
  if (error) return toast(error.message);
  const tags = parseTags($('#pinTags')?.value || '');
  if (tags.length) { const { error: tagError } = await sb.from('pin_tags').insert(tags.map(tag => ({ pin_id:data.id, tag }))); if (tagError) toast('핀은 저장됐지만 태그 DB 설정이 필요합니다.'); }
  try { await uploadPinBackground(data.id, state.pendingPinBackground || $('#pinBackgroundInput')?.files?.[0]); } catch (backgroundError) { alert(`배경 사진 업로드에 실패했습니다.\n${backgroundError.message}`); }
  state.pendingPinBackground = null;
  closeDialogs(); state.pending = null; $('#pinForm').reset(); await loadPins(); await loadSpacePhotos(); toast('핀이 추가되었습니다.');
}
async function toggleFavorite(pinId) {
  const isFavorite = state.favorites.has(pinId);
  const { error } = await sb.rpc('set_shared_pin_favorite', { target_pin:pinId, make_favorite:!isFavorite });
  if (error) return toast('공통 즐겨찾기 기능을 사용하려면 shared-favorites-migration.sql을 실행해 주세요.');
  await loadPins();
  toast(isFavorite ? '공통 즐겨찾기에서 제거했습니다.' : '모든 참가자에게 공통 즐겨찾기로 표시됩니다.');
}
function currentRole() { return state.spaces.find(item => item.space_id === state.active)?.role; }
function canManagePin(pin) { return Boolean(pin && pin.author_id === state.user?.id); }
function canManageComment(comment) { return Boolean(comment && (comment.author_id === state.user?.id || currentRole() === 'owner')); }
function setupPinColorOptions() {
  const select = $('#pinColor');
  if (!select) return;
  const labels = { coral:'코랄', red:'빨강', orange:'주황', amber:'노랑', lime:'연두', green:'초록', teal:'청록', blue:'파랑', purple:'보라', pink:'분홍' };
  select.innerHTML = Object.keys(colors).map(name => `<option value="${name}">${labels[name]}</option>`).join('');
}
function ensureManagementDialogs() {
  if ($('#editPinDialog')) return;
  document.head.insertAdjacentHTML('beforeend', '<style>.comment-actions{display:flex;gap:4px;margin-top:7px}.comment-actions button{border:0;border-radius:4px;background:#edf1f4;color:var(--ink);padding:3px 6px;font-size:10px}.pin-reactions{grid-column:2/-1;display:flex;gap:4px;margin-top:2px}.reaction-button{display:inline-flex;align-items:center;gap:2px;border:0;border-radius:9px;background:#edf1f4;padding:2px 5px;font-size:12px}.reaction-button.active{background:#fff0ed;box-shadow:inset 0 0 0 1px #f2aaa2}.reaction-button small{margin:0;color:#536477;font-size:9px;white-space:nowrap}.popup-reactions{margin-top:7px}.popup-reactions .pin-reactions{display:flex;gap:4px;margin:0}.popup-reactions .reaction-button{font-size:13px}#mapTypeMenu{position:absolute;right:0;top:44px;display:grid;gap:4px;padding:5px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:0 3px 12px #13243b33}#mapTypeMenu button{font-size:11px;white-space:nowrap}@media(max-width:760px){.map-actions{left:auto;right:9px;bottom:calc(env(safe-area-inset-bottom) + 126px);flex-direction:column;align-items:flex-end;gap:6px}.map-actions button{width:38px;min-width:38px;height:38px;min-height:38px}.map-actions #mapTypeButton:after{content:"🗺"}.leaflet-bottom.leaflet-right{bottom:calc(env(safe-area-inset-bottom) + 8px)}#mapTypeMenu{top:auto;right:44px;bottom:0}#mapTypeMenu button{width:auto;min-width:96px;font-size:11px}}</style>');
  document.head.insertAdjacentHTML('beforeend', '<style>.pin-item{border-bottom:1px solid #d8dee5!important;border-radius:0}.pin-item.has-pin-background{background-image:linear-gradient(#ffffffb8,#ffffffb8),var(--pin-background-image)!important;background-size:cover!important;background-position:center!important}</style>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="editPinDialog"><form id="editPinForm"><h2>핀 편집</h2><label>장소 이름<input id="editPinTitle" maxlength="80" required /></label><label>메모<textarea id="editPinNote" maxlength="1000"></textarea></label><label>태그 <small>쉼표로 구분, 최대 5개</small><input id="editPinTags" maxlength="100" /></label><label>색상<select id="editPinColor"></select></label><div class="dialog-actions"><button type="button" id="editPinDelete" class="danger-button">삭제</button><button type="button" id="editPinCancel" class="secondary">취소</button><button class="primary">저장</button></div></form></dialog>`);
  $('#editPinColor').innerHTML = $('#pinColor').innerHTML;
  const addBackgroundPicker = (formId, inputId, stateKey) => {
    const actions = $(`#${formId} .dialog-actions`);
    const buttonId = `${inputId}Button`, removeButtonId = `${inputId}Remove`;
    actions.insertAdjacentHTML('afterbegin', `<button type="button" id="${buttonId}" class="secondary">🖼 배경 넣기</button><button type="button" id="${removeButtonId}" class="secondary">배경 빼기</button><input id="${inputId}" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" style="display:none" />`);
    $(`#${buttonId}`).addEventListener('click', () => $(`#${inputId}`).click());
    $(`#${inputId}`).addEventListener('change', event => { const file = event.target.files?.[0] || null; state[stateKey] = file; $(`#${buttonId}`).textContent = file ? '🖼 사진 선택됨' : '🖼 배경 넣기'; });
    $(`#${removeButtonId}`).addEventListener('click', async () => {
      state[stateKey] = null; $(`#${inputId}`).value = ''; $(`#${buttonId}`).textContent = '🖼 배경 넣기';
      if (formId === 'editPinForm' && state.editingPinId) { await removePinBackground(state.editingPinId); toast('핀 배경을 제거했습니다.'); }
    });
  };
  addBackgroundPicker('pinForm', 'pinBackgroundInput', 'pendingPinBackground');
  addBackgroundPicker('editPinForm', 'editPinBackgroundInput', 'editingPinBackground');
  $('#pinDialog').addEventListener('close', () => { state.pendingPinBackground = null; $('#pinBackgroundInput').value = ''; });
  $('#editPinDialog').addEventListener('close', () => { state.editingPinBackground = null; $('#editPinBackgroundInput').value = ''; });
  $('#editPinCancel').addEventListener('click', () => $('#editPinDialog').close());
  $('#editPinDelete').addEventListener('click', () => { const id = state.editingPinId; $('#editPinDialog').close(); if (id) void deletePin(id); });
  $('#editPinForm').addEventListener('submit', savePinEdit);
}
async function deleteSpace() {
  if (state.active === 'all') return toast('삭제할 여행 공간을 선택하세요.');
  if (currentRole() !== 'owner') return toast('공간 소유자만 삭제할 수 있습니다.');
  const name = state.spaces.find(item => item.space_id === state.active)?.spaces?.name;
  if (!confirm(`정말 '${name}' 공간을 삭제할까요? 핀, 채팅, 댓글, 경로도 모두 삭제됩니다.`)) return;
  if (prompt(`두 번째 확인입니다. 삭제하려면 공간 이름 '${name}'을 그대로 입력하세요.`) !== name) return toast('공간 이름이 일치하지 않아 삭제하지 않았습니다.');
  const { error } = await sb.from('spaces').delete().eq('id', state.active);
  if (error) return toast(error.message);
  state.active = 'all'; await refresh(); toast('여행 공간을 삭제했습니다.');
}
async function legacyEditPin(pinId) {
  const pin = state.pins.find(item => item.id === pinId); if (!pin) return;
  const title = prompt('장소 이름', pin.title); if (title === null || !title.trim()) return;
  const note = prompt('메모', pin.note || ''); if (note === null) return;
  const tags = prompt('태그 (쉼표로 구분, 최대 5개)', (pin.tags || []).join(', ')); if (tags === null) return;
  const { error } = await sb.from('pins').update({ title:title.trim(), note:note.trim() }).eq('id', pinId);
  if (error) return toast('수정 권한이 없거나 저장에 실패했습니다.');
  await sb.from('pin_tags').delete().eq('pin_id',pinId);
  const parsedTags = parseTags(tags);
  if (parsedTags.length) { const { error: tagError } = await sb.from('pin_tags').insert(parsedTags.map(tag => ({ pin_id:pinId, tag }))); if (tagError) return toast('메모는 수정됐지만 태그 저장에 실패했습니다.'); }
  await loadPins(); toast('핀을 수정했습니다.');
}
function editPin(pinId) {
  const pin = state.pins.find(item => item.id === pinId);
  if (!canManagePin(pin)) return toast('핀 작성자 또는 공간 소유자만 편집할 수 있습니다.');
  state.editingPinId = pinId;
  $('#editPinTitle').value = pin.title;
  $('#editPinNote').value = pin.note || '';
  $('#editPinTags').value = (pin.tags || []).join(', ');
  $('#editPinColor').value = colors[pin.color] ? pin.color : 'coral';
  showDialog('editPinDialog');
}
async function savePinEdit(event) {
  event.preventDefault();
  const pin = state.pins.find(item => item.id === state.editingPinId);
  if (!canManagePin(pin)) return toast('핀 작성자 또는 공간 소유자만 편집할 수 있습니다.');
  const title = $('#editPinTitle').value.trim();
  if (!title) return;
  const { error } = await sb.from('pins').update({ title, note:$('#editPinNote').value.trim(), color:$('#editPinColor').value }).eq('id', pin.id);
  if (error) return toast(error.message);
  const { error: removeError } = await sb.from('pin_tags').delete().eq('pin_id', pin.id);
  if (removeError) return toast(removeError.message);
  const tags = parseTags($('#editPinTags').value);
  if (tags.length) { const { error: tagError } = await sb.from('pin_tags').insert(tags.map(tag => ({ pin_id:pin.id, tag }))); if (tagError) return toast(tagError.message); }
  try { await uploadPinBackground(pin.id, state.editingPinBackground || $('#editPinBackgroundInput')?.files?.[0]); } catch (backgroundError) { alert(`배경 사진 업로드에 실패했습니다.\n${backgroundError.message}`); }
  state.editingPinBackground = null;
  $('#editPinDialog').close(); state.editingPinId = null;
  await loadPins(); await loadSpacePhotos(); toast('핀이 수정되었습니다.');
}
async function deletePin(pinId) {
  const pin = state.pins.find(item => item.id === pinId);
  if (!canManagePin(pin)) return toast('핀 작성자 또는 공간 소유자만 삭제할 수 있습니다.');
  if (!confirm('이 핀을 삭제할까요?\n\n핀에 달린 댓글과 경로 정보는 삭제됩니다.\n댓글에 첨부한 사진은 사진첩에 그대로 보관됩니다.')) return;
  await loadSpacePhotos(pin.space_id);
  const backgrounds = state.photos.filter(photo => photo.source_type === 'pin_background' && photo.source_id === pinId);
  try { await Promise.all(backgrounds.map(photo => photoFetch(`/photos/${photo.id}`, { method:'DELETE' }))); }
  catch (backgroundError) { return toast(`배경 사진 삭제에 실패해 핀 삭제를 중단했습니다: ${backgroundError.message}`); }
  const { error } = await sb.from('pins').delete().eq('id', pinId);
  if (error) return toast('삭제 권한이 없거나 삭제에 실패했습니다.');
  if (state.commentPin === pinId) closeCommentsDialog();
  await loadPins(); await loadSpacePhotos(); renderPhotoGallery();
  toast('핀과 댓글을 삭제했습니다. 첨부 사진은 사진첩에 보관됩니다.');
}
function closeCommentsDialog() {
  commentOpenRequestId += 1;
  state.commentPin = null;
  const dialog = $('#commentsDialog');
  if (dialog.open) dialog.close();
}
async function openComments(pinId) {
  const requestId = ++commentOpenRequestId;
  state.commentPin = pinId; const pin = state.pins.find(item => item.id === pinId); if (!pin) return; state.commentSpaceId = pin.space_id; $('#commentsTitle').textContent = `${pin.title} 댓글`;
  const { data, error } = await sb.from('pin_comments').select('*, profiles!pin_comments_author_id_fkey(nickname)').eq('pin_id', pinId).order('created_at');
  if (requestId !== commentOpenRequestId) return;
  if (error) return toast('댓글 기능을 사용하려면 comments-migration.sql을 먼저 실행하세요.');
  await loadSpacePhotos(state.commentSpaceId);
  if (requestId !== commentOpenRequestId) return;
  await applyPinBackground($('#commentsDialog'), pin);
  if (requestId !== commentOpenRequestId) return;
  $('#commentsList').innerHTML = (data || []).map(item => `<article class="comment"><small>${escapeHtml(item.profiles?.nickname || '참여자')} · ${timeFull(item.created_at)}</small>${escapeHtml(item.body)}${photoByComment(item.id).length ? `<div class="comment-photos">${photoByComment(item.id).map(photo => photoMarkup(photo)).join('')}</div>` : ''}</article>`).join('') || '<p class="label">아직 댓글이 없습니다.</p>';
  (data || []).forEach((item, index) => {
    if (!canManageComment(item)) return;
    const comment = document.querySelectorAll('#commentsList .comment')[index];
    if (!comment) return;
    const actions = document.createElement('span');
    actions.className = 'comment-actions';
    actions.innerHTML = `<button type="button" data-edit-comment="${item.id}">수정</button><button type="button" data-delete-comment="${item.id}">삭제</button>`;
    actions.querySelector('[data-edit-comment]').addEventListener('click', () => void editComment(item));
    actions.querySelector('[data-delete-comment]').addEventListener('click', () => void deleteComment(item));
    comment.append(actions);
  });
  if (requestId !== commentOpenRequestId) return;
  showDialog('commentsDialog');
  $('#commentsDialog').focus({ preventScroll:true });
  void hydratePhotos($('#commentsList'));
  await markCommentsRead(pinId);
}
async function markCommentsRead(pinId) {
  const { error } = await sb.from('pin_comment_reads').upsert({ pin_id:pinId, user_id:state.user.id, last_read_at:new Date().toISOString() }, { onConflict:'pin_id,user_id' });
  if (!error) await loadPins();
}
async function editComment(comment) {
  if (!canManageComment(comment)) return toast('댓글 작성자 또는 공간 소유자만 수정할 수 있습니다.');
  const body = prompt('댓글 수정', comment.body);
  if (body === null || !body.trim()) return;
  const { error } = await sb.from('pin_comments').update({ body:body.trim() }).eq('id', comment.id);
  if (error) return toast(error.message);
  await openComments(state.commentPin);
  toast('댓글이 수정되었습니다.');
}
async function deleteComment(comment) {
  if (!canManageComment(comment)) return toast('댓글 작성자 또는 공간 소유자만 삭제할 수 있습니다.');
  if (!confirm('이 댓글을 삭제할까요?')) return;
  const { error } = await sb.from('pin_comments').delete().eq('id', comment.id);
  if (error) return toast(error.message);
  await loadPins();
  await openComments(state.commentPin);
  toast('댓글이 삭제되었습니다.');
}
async function addComment(event) {
  event.preventDefault(); const photos = state.pendingCommentPhotos; const body = $('#commentInput').value.trim() || (photos.length ? '사진을 첨부했습니다.' : ''); if (!body || !state.commentPin) return;
  const { data, error } = await sb.from('pin_comments').insert({ pin_id:state.commentPin, author_id:state.user.id, body }).select().single();
  if (error) return toast('댓글 기능을 사용하려면 comments-migration.sql을 먼저 실행하세요.');
  try { if (photos.length) await uploadCommentPhotos(data.id, photos); }
  catch (uploadError) { toast(`댓글은 등록됐지만 사진 업로드에 실패했습니다: ${uploadError.message}`); }
  photos.forEach(photo => URL.revokeObjectURL(photo.url)); state.pendingCommentPhotos = []; $('#commentInput').value = ''; $('#commentPhotoInput').value = ''; $('#commentPhotoPreview').innerHTML = ''; await loadPins(); await loadSpacePhotos(); renderPhotoGallery(); await openComments(state.commentPin);
}
async function loadNotifications() {
  const { data, error } = await sb.from('notifications').select('*').eq('user_id', state.user.id).order('created_at', { ascending:false }).limit(30);
  if (error) return;
  state.notifications = data || []; const unread = state.notifications.filter(item => !item.read_at).length; $('#notificationCount').textContent = unread || ''; $('#notificationCount').classList.toggle('hidden', !unread);
  if ($('#notificationsDialog').open) renderNotifications();
}
function renderNotifications() {
  const list = $('#notificationsList');
  const destinationText = item => item.kind === 'comment' ? ' · 댓글 보기' : item.kind === 'message' ? ' · 채팅으로 이동' : item.kind === 'route' ? ' · 경로 보기' : item.pin_id ? ' · 핀 위치로 이동' : '';
  list.innerHTML = state.notifications.map(item => `<article class="notification-item notification-target" data-open-notification="${item.id}" tabindex="0" role="button"><div><strong>${escapeHtml(item.body)}</strong><small>${timeText(item.created_at)}${destinationText(item)}</small></div><button type="button" class="notification-delete" data-delete-notification="${item.id}" aria-label="알림 삭제">×</button></article>`).join('') || '<p class="label">새 알림이 없습니다.</p>';
  $('#clearNotificationsButton').classList.toggle('hidden', !state.notifications.length);
  list.querySelectorAll('[data-delete-notification]').forEach(button => button.addEventListener('click', () => deleteNotification(button.dataset.deleteNotification)));
  list.querySelectorAll('[data-open-notification]').forEach(item => {
    item.addEventListener('click', event => { if (!event.target.closest('[data-delete-notification]')) void openNotificationTarget(item.dataset.openNotification); });
    item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openNotificationTarget(item.dataset.openNotification); } });
  });
}
async function activatePanel(panel) {
  document.querySelectorAll('[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === panel));
  ['pins','favorites','routes','photos','members'].forEach(name => $(`#${name}Panel`).classList.toggle('hidden', name !== panel));
  if (matchMedia('(max-width:760px)').matches && !$('.app aside').classList.contains('open')) toggleMobilePanel();
  if (panel === 'routes') renderRoutes();
  if (panel === 'photos') { await loadSpacePhotos(); renderPhotoGallery(); }
  if (panel === 'members') await loadMembers();
}
async function openChat() {
  if (state.active === 'all') return toast('채팅할 여행 공간을 선택하세요.');
  const dialog = $('#chatDialog');
  if (!dialog.open) dialog.showModal();
  await loadMessages();
  scrollChatToBottom();
}
function closeNotificationsForNavigation() {
  const dialog = $('#notificationsDialog');
  if (!dialog.open) return;
  // Do not call history.back() here. On iPhone Safari its delayed popstate can
  // otherwise undo the panel/dialog action that follows this click.
  closingNotificationFromBack = true;
  notificationHistoryOpen = false;
  history.replaceState({ pinTogetherExitGuard:true }, '');
  dialog.close();
}
async function openNotificationTarget(notificationId) {
  const notification = state.notifications.find(item => item.id === notificationId);
  if (!notification) return;
  try {
    closeNotificationsForNavigation();
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (state.active !== notification.space_id) {
      state.active = notification.space_id;
      await rememberActiveSpace();
      await refresh();
    }
    if (notification.kind === 'message') { await openChat(); return; }
    if (notification.kind === 'route') { await activatePanel('routes'); return; }
    if (!notification.pin_id) return toast('이 알림에는 이동할 위치 정보가 없습니다.');
    const pin = state.pins.find(item => item.id === notification.pin_id);
    if (!pin) return toast('이 핀은 삭제되었거나 더 이상 볼 수 없습니다.');
    map.invalidateSize({ pan:false });
    map.flyTo([pin.latitude, pin.longitude], 16, { animate:true, duration:.45 });
    if (notification.kind === 'comment') { await openComments(pin.id); return; }
    state.markers?.eachLayer(marker => {
      const position = marker.getLatLng?.();
      if (position && Number(position.lat) === Number(pin.latitude) && Number(position.lng) === Number(pin.longitude)) marker.openPopup?.();
    });
  } catch (error) {
    toast(`알림 이동에 실패했습니다: ${error.message}`);
  }
}
async function deleteNotification(notificationId) {
  const { error } = await sb.from('notifications').delete().eq('id', notificationId).eq('user_id', state.user.id);
  if (error) return toast(`알림 삭제에 실패했습니다: ${error.message}`);
  state.notifications = state.notifications.filter(item => item.id !== notificationId); renderNotifications(); await loadNotifications();
}
async function clearNotifications() {
  if (!state.notifications.length || !confirm('알림을 모두 삭제할까요?')) return;
  const { error } = await sb.from('notifications').delete().eq('user_id', state.user.id);
  if (error) return toast(`알림 전체 삭제에 실패했습니다: ${error.message}`);
  state.notifications = []; renderNotifications(); await loadNotifications();
}
async function openNotifications() {
  renderNotifications();
  showDialog('notificationsDialog');
  requestAnimationFrame(() => { $('#notificationsDialog').scrollTop = 0; });
  if (!notificationHistoryOpen) { history.pushState({ pinTogetherModal:'notifications' }, ''); notificationHistoryOpen = true; }
  const unreadIds = state.notifications.filter(item => !item.read_at).map(item => item.id);
  if (unreadIds.length) { await sb.from('notifications').update({ read_at:new Date().toISOString() }).in('id', unreadIds); await loadNotifications(); }
}
async function createSpace(event) { event.preventDefault(); const name = $('#spaceName').value.trim(); const { data, error } = await sb.rpc('create_space', { space_name:name }); if (error) return toast(error.message); closeDialogs(); $('#spaceForm').reset(); state.active = data; await rememberActiveSpace(); await refresh(); toast('새 여행 공간을 만들었습니다.'); }
function clearInviteFromUrl() { const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState({}, '', url); }
async function joinSpace(event) { event.preventDefault(); const code = $('#inviteCode').value.trim(); const { data, error } = await sb.rpc('accept_invitation', { invite_code:code }); if (error) return toast(error.message); clearInviteFromUrl(); closeDialogs(); state.active = data; await rememberActiveSpace(); await refresh(); toast('여행 공간에 참가했습니다.'); }
async function makeInvite() { if (state.active === 'all') return toast('초대할 여행 공간을 선택하세요.'); const role = state.spaces.find(s => s.space_id === state.active)?.role; if (role !== 'owner') return toast('공간 소유자만 초대 코드를 만들 수 있습니다.'); const { data, error } = await sb.from('invitations').insert({ space_id:state.active, created_by:state.user.id, role:'editor' }).select('code').single(); if (error) return toast(error.message); await navigator.clipboard?.writeText(data.code); prompt('초대 코드만 복사해 전달하세요.', data.code); toast('초대 코드가 복사되었습니다.'); }
async function sendMessage(event) { event.preventDefault(); const body = $('#messageInput').value.trim(); if (!body) return; if (state.active === 'all') return toast('채팅할 여행 공간을 선택하세요.'); const { error } = await sb.from('messages').insert({ space_id:state.active, author_id:state.user.id, body }); if (error) return toast(error.message); $('#messageInput').value = ''; await loadMessages(); await loadUnreadCount(); }
async function saveUniqueNickname(nickname) {
  const { data, error } = await sb.from('profiles').update({ nickname }).eq('id', state.user.id).select('nickname').single();
  return { nickname:data?.nickname || nickname, error };
}
async function saveProfile(event) {
  event.preventDefault();
  const nickname = $('#profileNickname').value.trim();
  const password = $('#profilePassword').value;
  const passwordConfirm = $('#profilePasswordConfirm').value;
  if (password && password !== passwordConfirm) return toast('새 비밀번호가 일치하지 않습니다.');
  if (password && password.length < 8) return toast('비밀번호는 8자 이상이어야 합니다.');
  const savedNickname = await saveUniqueNickname(nickname);
  const { error } = savedNickname;
  if (error) return toast(error.message);
  if (password) {
    const { error: passwordError } = await sb.auth.updateUser({ password });
    if (passwordError) return toast(passwordError.message);
  }
  state.profile.nickname = savedNickname.nickname;
  $('#profileButton').textContent = initials(savedNickname.nickname);
  $('#profilePassword').value = '';
  $('#profilePasswordConfirm').value = '';
  closeDialogs();
  toast(`${savedNickname.nickname !== nickname ? `'${savedNickname.nickname}'으로 ` : ''}${password ? '프로필과 비밀번호를 저장했습니다.' : '닉네임을 저장했습니다.'}`);
}
async function saveSessionNickname(event) {
  event.preventDefault();
  const nickname = $('#sessionNickname').value.trim();
  const savedNickname = await saveUniqueNickname(nickname);
  const { error } = savedNickname;
  if (error) return toast(error.message);
  sessionStorage.removeItem(sessionNicknameKey());
  state.sessionNickname = '';
  state.profile.nickname = savedNickname.nickname;
  $('#profileButton').textContent = initials(savedNickname.nickname);
  nicknamePromptedForSession = true;
  closeDialogs();
  toast(`${savedNickname.nickname !== nickname ? `'${savedNickname.nickname}'으로 ` : ''}닉네임을 저장했습니다. 다음 로그인에도 유지됩니다.`);
}
async function requestPasswordReset(event) {
  event.preventDefault();
  const email = $('#forgotPasswordEmail').value.trim();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo:`${location.origin}${location.pathname}` });
  if (error) return toast(error.message);
  closeDialogs();
  toast('비밀번호 재설정 링크를 이메일로 보냈습니다.');
}
async function setRecoveredPassword(event) {
  event.preventDefault();
  const password = $('#newPassword').value;
  if (password !== $('#newPasswordConfirm').value) return toast('새 비밀번호가 일치하지 않습니다.');
  const { error } = await sb.auth.updateUser({ password });
  if (error) return toast(error.message);
  closeDialogs();
  $('#newPasswordForm').reset();
  toast('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
  await sb.auth.signOut();
}
async function searchPlace(event) { event.preventDefault(); const query = $('#placeSearch').value.trim(); if (!query) return; $('#placeResults').innerHTML = '<button class="result">검색 중…</button>'; try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=${encodeURIComponent(query)}`); const results = await response.json(); $('#placeResults').innerHTML = results.map((item,index) => `<button class="result" data-result="${index}">${escapeHtml(item.display_name.split(',').slice(0,2).join(','))}<small>${escapeHtml(item.display_name)}</small></button>`).join('') || '<button class="result">검색 결과가 없습니다.</button>'; document.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => { const item = results[button.dataset.result]; map.flyTo([item.lat,item.lon], 15); $('#placeResults').innerHTML = ''; })); } catch { $('#placeResults').innerHTML = '<button class="result">검색에 실패했습니다.</button>'; } }
function subscribe() { state.channel?.unsubscribe(); state.channel = sb.channel(`space-${state.active}`).on('postgres_changes', { event:'*', schema:'public', table:'pins' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'pin_comments' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'pin_reactions' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'shared_favorite_pins' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'messages', filter: state.active === 'all' ? undefined : `space_id=eq.${state.active}` }, () => { void loadMessages(); void loadUnreadCount(); }).on('postgres_changes', { event:'*', schema:'public', table:'message_reads' }, () => { void loadMessages(); void loadUnreadCount(); }).on('postgres_changes', { event:'*', schema:'public', table:'space_routes', filter: state.active === 'all' ? undefined : `space_id=eq.${state.active}` }, () => { void loadPins(); }).on('postgres_changes', { event:'*', schema:'public', table:'route_stops' }, () => { void loadPins(); }).on('postgres_changes', { event:'*', schema:'public', table:'notifications', filter:`user_id=eq.${state.user.id}` }, event => { if (event.eventType === 'INSERT' && event.new?.body) toast(event.new.body); void loadNotifications(); }).subscribe(); }
function startSafetySync() { clearInterval(safetySyncTimer); safetySyncTimer = setInterval(() => { if (document.hidden || !state.user) return; void loadPins().catch(() => {}); void loadNotifications().catch(() => {}); if (state.active !== 'all') { void loadMessages().catch(() => {}); void loadUnreadCount().catch(() => {}); } }, 30000); }
async function refresh() { await loadSpaces(); await loadPins(); await loadMessages(); await loadUnreadCount(); await loadNotifications(); await loadMembers(); await loadSpacePhotos(); renderPhotoGallery(); connectLocationPresence(); subscribe(); startSafetySync(); $('#spaceSelect').value = state.active; $('#deleteSpaceButton').classList.toggle('hidden', state.active === 'all' || currentRole() !== 'owner'); }
async function startApp() {
  // Leaflet은 숨겨진 요소에서 초기화하면 지도 크기를 0으로 계산할 수 있습니다.
  show('appView');
  if (!map) initMap();
  else map.invalidateSize();
  await loadProfile();
  const savedSessionNickname = isMasterUser() ? (sessionStorage.getItem(sessionNicknameKey()) || '') : '';
  if (savedSessionNickname && state.profile.nickname !== savedSessionNickname) {
    const savedNickname = await saveUniqueNickname(savedSessionNickname);
    if (!savedNickname.error) state.profile.nickname = savedNickname.nickname;
    sessionStorage.removeItem(sessionNicknameKey());
  }
  state.sessionNickname = '';
  $('#profileButton').textContent = initials(activeNickname());
  await refresh();
  const invite = new URLSearchParams(location.search).get('invite');
  if (needsNicknameSetup() && !nicknamePromptedForSession && !$('#sessionNicknameDialog').open && !invite) {
    $('#sessionNickname').value = '';
    showDialog('sessionNicknameDialog');
  }
  // CSS Grid 레이아웃이 완료된 뒤 한 번 더 실행해야 전체 지도 타일이 채워집니다.
  requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize({ pan:false, animate:false })));
  setTimeout(() => map.invalidateSize({ pan:false, animate:false }), 250);
  if (invite) { $('#inviteCode').value = invite; showDialog('joinDialog'); }
}
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function timeText(value) { return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
function timeFull(value) { return new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
function scrollChatToBottom(smooth=false) { const messages = $('#messages'); if (!messages) return; requestAnimationFrame(() => messages.scrollTo({ top:messages.scrollHeight, behavior:smooth ? 'smooth' : 'auto' })); }

function bindUi() {
  setupPinColorOptions();
  ensureManagementDialogs();
  history.pushState({ pinTogetherExitGuard:true }, '');
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (button.dataset.close === 'commentsDialog') closeCommentsDialog(); else $(`#${button.dataset.close}`).close(); }));
  $('#commentsDialog').addEventListener('click', event => { if (event.target === event.currentTarget) closeCommentsDialog(); });
  $('#notificationsDialog').addEventListener('click', event => { if (event.target === event.currentTarget) $('#notificationsDialog').close(); });
  $('#notificationsDialog').addEventListener('close', () => { if (notificationHistoryOpen && !closingNotificationFromBack) { notificationHistoryOpen = false; history.back(); } closingNotificationFromBack = false; });
  window.addEventListener('popstate', event => {
    if (exitConfirmed) return;
    if ($('#photoViewerDialog').open) { closingPhotoViewerFromBack = true; $('#photoViewerDialog').close(); photoViewerHistoryOpen = false; return; }
    if (mobilePanelHistoryOpen) { closeMobilePanel(true); return; }
    if ($('#notificationsDialog').open) { closingNotificationFromBack = true; $('#notificationsDialog').close(); notificationHistoryOpen = false; return; }
    if (event.state?.pinTogetherExitGuard) return;
    if (confirm('페이지를 나가시겠어요?')) { exitConfirmed = true; history.back(); }
    else history.forward();
  });
  window.addEventListener('beforeunload', event => { if (!exitConfirmed) { event.preventDefault(); event.returnValue = ''; } });
  $('#sessionNicknameDialog').addEventListener('cancel', event => event.preventDefault());
  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-auth]').forEach(item => item.classList.toggle('active', item === button)); const signup = button.dataset.auth === 'signup'; $('#nicknameField').classList.toggle('hidden', !signup); $('#nickname').required = signup; $('#authSubmit').textContent = signup ? '회원가입' : '로그인'; $('#authHelp').textContent = signup ? '회원가입에는 실제 이메일 주소를 입력해 주세요.' : '가입한 이메일로 로그인하세요.'; }));
  $('#authForm').addEventListener('submit', async event => { event.preventDefault(); const signup = $('[data-auth].active').dataset.auth === 'signup'; const loginId = $('#email').value.trim(); const masterEmail = Object.entries(masterAccounts).find(([name]) => name.toLowerCase() === loginId.toLowerCase())?.[1] || null; if (signup && masterEmail) return toast('마스터 계정은 회원가입할 수 없습니다.'); if (signup && !loginId.includes('@')) return toast('회원가입에는 이메일 주소를 입력해 주세요.'); const email = masterEmail || loginId, password = $('#password').value; if (signup && password.length < 8) return toast('회원가입 비밀번호는 8자 이상이어야 합니다.'); const result = signup ? await sb.auth.signUp({ email, password, options:{ data:{ nickname:$('#nickname').value.trim() }, emailRedirectTo:`${location.origin}${location.pathname}` } }) : await sb.auth.signInWithPassword({ email, password }); if (result.error) return toast(result.error.message); if (signup && !result.data.session) return toast('가입 확인 메일을 보냈습니다. 이메일 인증 후 로그인하세요.'); });
  $('#spaceSelect').addEventListener('change', async event => { if (locationWatchId !== null) stopLocationShare(true); state.active = event.target.value; state.selected = []; state.route = []; state.draftRoute = []; state.activeRouteId = null; updateMeasure(); await rememberActiveSpace(); await refresh(); });
  $('#newSpaceButton').addEventListener('click', () => showDialog('spaceDialog')); $('#joinSpaceButton').addEventListener('click', () => showDialog('joinDialog')); $('#inviteButton').addEventListener('click', makeInvite); $('#deleteSpaceButton').addEventListener('click', deleteSpace); $('#chatButton').addEventListener('click', () => void openChat()); $('#closeChatButton').addEventListener('click', () => $('#chatDialog').close()); $('#chatDialog').addEventListener('click', event => { if (event.target === event.currentTarget) $('#chatDialog').close(); }); $('#notificationButton').addEventListener('click', openNotifications); $('#mobilePanelButton').addEventListener('click', toggleMobilePanel); $('#spaceForm').addEventListener('submit', createSpace); $('#pinForm').addEventListener('submit', createPin); $('#messageForm').addEventListener('submit', sendMessage); $('#messageInput').addEventListener('focus', () => setTimeout(() => scrollChatToBottom(true), 180)); $('#commentForm').addEventListener('submit', addComment); $('#commentPhotoInput').addEventListener('change', event => { state.pendingCommentPhotos.forEach(photo => URL.revokeObjectURL(photo.url)); const files = [...event.target.files]; state.pendingCommentPhotos = files.slice(0,5).map(file => ({ file, tags:'', url:URL.createObjectURL(file) })); if (files.length > 5) toast('사진은 최대 5장까지 선택할 수 있습니다.'); renderCommentPhotoPreview(); }); $('#photoSearch').addEventListener('input', renderPhotoGallery); $('#photoViewerDialog').addEventListener('close', () => { $('#photoViewerImage').removeAttribute('src'); $('#photoViewerStatus').textContent = ''; if (photoViewerHistoryOpen && !closingPhotoViewerFromBack) { photoViewerHistoryOpen = false; history.back(); } closingPhotoViewerFromBack = false; }); bindPhotoViewer(); $('#profileButton').addEventListener('click', () => { $('#profileNickname').value = state.profile.nickname; $('#profilePassword').value = ''; $('#profilePasswordConfirm').value = ''; showDialog('profileDialog'); requestAnimationFrame(() => $('#profileDialog').focus({ preventScroll:true })); }); $('#profileForm').addEventListener('submit', saveProfile); $('#forgotPasswordButton').addEventListener('click', () => { $('#forgotPasswordEmail').value = $('#email').value.trim(); showDialog('forgotPasswordDialog'); }); $('#forgotPasswordForm').addEventListener('submit', requestPasswordReset); $('#newPasswordForm').addEventListener('submit', setRecoveredPassword);
  $('#joinForm').addEventListener('submit', joinSpace); $('#sessionNicknameForm').addEventListener('submit', saveSessionNickname); $('#profileSignOutButton').addEventListener('click', signOut); $('#clearNotificationsButton').addEventListener('click', clearNotifications);
  $('#addPinButton').addEventListener('click', () => { if (state.active === 'all') return toast('핀을 추가할 여행 공간을 선택하세요.'); state.pending = 'add'; $('#addPinButton').classList.add('active'); toast('지도에서 핀을 놓을 위치를 선택하세요.'); });
  $('#routeButton').addEventListener('click', () => {
    if (state.routeMode) {
      state.routeMode = false;
      state.draftRoute = [];
      $('#routeButton').classList.remove('active');
      toast('경로 지정을 취소했습니다.');
    } else {
      if (currentRole() === 'viewer') return toast('보기 전용 멤버는 경로를 지정할 수 없습니다.');
      state.route = [];
      state.draftRoute = [];
      state.activeRouteId = null;
      state.routeMode = true;
      $('#routeButton').classList.add('active');
      toast('연결할 핀 두 개를 순서대로 선택하세요. 두 번째 핀에서 자동 확정됩니다.');
    }
    updateMeasure(); renderPins();
  }); $('#closeMeasure').addEventListener('click', () => $('#measureCard').classList.add('hidden')); $('#pinSearch').addEventListener('input', renderPins); $('#tagFilter').addEventListener('change', renderPins); $('#placeSearchForm').addEventListener('submit', searchPlace);
  $('#locateButton').addEventListener('click', () => { if (!navigator.geolocation) return toast('이 브라우저는 위치 기능을 지원하지 않습니다.'); toast('현재 위치를 찾는 중입니다.'); navigator.geolocation.getCurrentPosition(pos => { const point = [pos.coords.latitude,pos.coords.longitude]; map.flyTo(point,16,{animate:true,duration:.6}); L.circleMarker(point,{radius:9,color:'#fff',weight:3,fillColor:colors.blue,fillOpacity:1}).addTo(map); toast('현재 위치로 이동했습니다.'); }, () => toast('현재 위치 권한을 허용해 주세요.'), { enableHighAccuracy:true, maximumAge:15000, timeout:15000 }); });
  $('#locationShareButton').addEventListener('click', startLocationShare);
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => void activatePanel(button.dataset.panel)));
  window.visualViewport?.addEventListener('resize', () => {
    if ($('#chatDialog').open) setTimeout(() => scrollChatToBottom(), 120);
    // Safari changes the visual viewport when its address bar or keyboard moves.
    // Leaflet needs an explicit recalculation or touches can land on the wrong place.
    setTimeout(() => map?.invalidateSize({ pan:false }), 120);
  });
}

if (!configured) show('setupView');
else { sb = createClient(PROJECT_URL, SUPABASE_PUBLISHABLE_KEY); bindUi(); sb.auth.onAuthStateChange(async (event, session) => { state.user = session?.user || null; if (!state.user) nicknamePromptedForSession = false; if (event === 'PASSWORD_RECOVERY' && state.user) { show('authView'); showDialog('newPasswordDialog'); return; } if (state.user) { try { await startApp(); } catch (error) { toast(error.message); } } else show('authView'); }); }
