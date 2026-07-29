import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PHOTO_SERVER_URL, VAPID_PUBLIC_KEY } from './config.js?v=20260724-pin-delete-photos';

const configured = !SUPABASE_URL.startsWith('YOUR_') && !SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_');
const masterAccounts = Object.fromEntries([1,2,3,4,5].map(number => [`Master${number}`, `master${number}@example.com`]));
// Data API URL을 실수로 넣어도 Supabase 프로젝트 루트 URL로 정규화합니다.
const PROJECT_URL = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '');
const colors = { coral:'#ed7668', red:'#df5353', orange:'#ef8a3c', amber:'#dea23f', lime:'#93b944', green:'#4da887', teal:'#36a5a3', blue:'#5d8ddd', purple:'#8b72d5', pink:'#d96fa5' };
const pinIconCategories = {
  restaurant:{ icon:'🍽️', label:'맛집' }, cafe:{ icon:'☕', label:'카페' }, lodging:{ icon:'🛏️', label:'숙소' }, shopping:{ icon:'🛍️', label:'쇼핑' }, sightseeing:{ icon:'📷', label:'관광' }, transport:{ icon:'🚆', label:'교통' }, reservation:{ icon:'📅', label:'예약' }, other:{ icon:'✦', label:'기타' }
};
const reactionTypes = [{ kind:'like', icon:'👍', label:'좋아요' }, { kind:'neutral', icon:'😐', label:'보통' }, { kind:'dislike', icon:'👎', label:'싫어요' }];
const isIphoneSafari = /iPhone|iPod/i.test(navigator.userAgent);
if (isIphoneSafari) document.documentElement.classList.add('ios-compact');
const themeStorageKey = 'pin-together-theme';
const initialTheme = localStorage.getItem(themeStorageKey) || 'light';
if (initialTheme === 'dark') document.documentElement.classList.add('dark-mode');
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=20260728-deployment-collapse').catch(error => {
    console.warn('PWA service worker registration failed.', error);
  }));
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'open-notification' || !event.data.notificationId || !state.user) return;
    void (async () => { await loadNotifications(); await openNotificationTarget(event.data.notificationId); })();
  });
}
const $ = selector => document.querySelector(selector);
const state = { user:null, profile:null, sessionNickname:'', spaces:[], active:'', pins:[], pinById:new Map(), favorites:new Set(), selected:[], route:[], draftRoute:[], routes:[], activeRouteId:null, routeMode:false, markers:null, locationMarkers:null, channel:null, pending:null, pendingPinBackground:null, commentPin:null, commentSpaceId:null, editingPinId:null, editingPinBackground:null, openPopupPinId:null, openPopupElement:null, popupCloseTimer:null, notifications:[], members:[], polls:[], checklists:[], messageReads:new Map(), photos:[], photoOrigins:new Map(), backgroundUrls:new Map(), pendingCommentPhotos:[] };
let sb, map, lineLayer, baseLayer, locationWatchId = null, sharingSpaceId = null, routeRequestId = 0, commentOpenRequestId = 0, pinSearchTimer = null, locationChannel = null, locationPresenceSpace = null, latestLocationPayload = null, nicknamePromptedForSession = false, safetySyncTimer = null, notificationHistoryOpen = false, closingNotificationFromBack = false, editPinHistoryOpen = false, closingEditPinFromBack = false, checklistDetailHistoryOpen = false, closingChecklistDetailFromBack = false, checklistReturnPanel = 'checklists', checklistReturnPinId = '', checklistViewMode = 'detail', mobilePanelHistoryOpen = false, exitConfirmed = false, photoViewerHistoryOpen = false, closingPhotoViewerFromBack = false, deletedNoticeSpaceId = null, announcementReturnToNotifications = false, pollOptionDrafts = [], selectedPollPinId = '', pollPinPickerTarget = null, pinPollDialogPinId = '', pinChecklistSourceIds = [], pinChecklistTargetId = '', checklistCreateTargetPinId = '', checklistDetailId = '';
const isAnnouncementNotification = item => item?.kind === 'system' && (/^\[공지\]\n/.test(String(item.body || '')) || String(item.body || '').startsWith('공지: '));
const locationBroadcasts = new Map();

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function recordPerformance(name, startedAt, details={}) {
  const metric = { name, durationMs:Math.round((performance.now() - startedAt) * 10) / 10, at:new Date().toISOString(), ...details };
  window.__pinTogetherPerformance = { ...(window.__pinTogetherPerformance || {}), [name]:metric };
  try {
    if (sessionStorage.getItem('pin-together-performance-debug') === '1') console.info('[performance]', metric);
  } catch (_) {
    // Safari private browsing can restrict session storage; metrics should not affect the app.
  }
  return metric;
}
function show(view) { ['setupView','authView','appView'].forEach(id => $(`#${id}`).classList.toggle('hidden', id !== view)); }
function showDialog(id) {
  const dialog = $(`#${id}`);
  const form = dialog.querySelector('form');
  // Prevent browser autofocus from opening the mobile keyboard as soon as any dialog appears.
  if (form) form.inert = true;
  dialog.showModal();
  requestAnimationFrame(() => { dialog.focus({ preventScroll:true }); if (form) form.inert = false; });
}
function setTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark-mode', dark);
  localStorage.setItem(themeStorageKey, dark ? 'dark' : 'light');
  const button = $('#themeButton');
  if (button) {
    button.textContent = dark ? '☀ 라이트 모드' : '☾ 다크 모드';
    button.title = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
    button.setAttribute('aria-label', button.title);
  }
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
async function signOut() {
  if (!confirm('로그아웃하시겠어요?')) return;
  if (!confirm('한 번 더 확인할게요. 정말 로그아웃할까요?')) return;
  closeDialogs();
  await sb.auth.signOut();
}
function openAnnouncementDialog() {
  const notificationDialog = $('#notificationsDialog');
  announcementReturnToNotifications = notificationDialog.open;
  // iPhone Safari can fail silently when a second modal dialog is opened above
  // the notifications dialog. Close it first, then restore it when composing ends.
  if (notificationDialog.open) {
    closingNotificationFromBack = true;
    notificationDialog.close();
  }
  requestAnimationFrame(() => showDialog('announcementDialog'));
}
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
const notificationPreferenceDefaults = { pin:true, comment:true, reply:true, message:true, route:true, invite:true, reaction:true, favorite:false, location:false, checklist:true, poll:true, announcement:true, system:true, quiet_mode:false };
function notificationPreferenceKey() { return `pin-together-notification-preferences:${state.user?.id || 'guest'}`; }
function loadNotificationPreferences() {
  try { return { ...notificationPreferenceDefaults, ...JSON.parse(localStorage.getItem(notificationPreferenceKey()) || '{}') }; }
  catch { return { ...notificationPreferenceDefaults }; }
}
function isInstalledPwa() { return window.matchMedia?.('(display-mode: standalone)').matches || Boolean(navigator.standalone); }
function updateNotificationSettingsStatus() {
  const status = $('#pwaNotificationStatus');
  if (!status) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) status.textContent = '이 브라우저에서는 웹 알림을 지원하지 않습니다.';
  else if (!isInstalledPwa() && isIphoneSafari) status.textContent = 'iPhone에서는 Safari 공유 메뉴에서 홈 화면에 추가한 뒤 알림을 켤 수 있습니다.';
  else if (Notification.permission === 'granted') status.textContent = '브라우저 알림이 허용되어 있습니다. 선택한 항목만 받습니다.';
  else if (Notification.permission === 'denied') status.textContent = '브라우저 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.';
  else status.textContent = '알림 권한을 허용한 뒤, 선택한 종류의 푸시 알림을 받을 수 있습니다.';
}
function openNotificationSettings() {
  const preferences = loadNotificationPreferences();
  Object.entries(preferences).forEach(([kind, enabled]) => {
    const input = $(`#notificationSettingsForm [name="${kind}"]`);
    if (input) input.checked = enabled;
  });
  updateNotificationSettingsStatus();
  showDialog('notificationSettingsDialog');
}
async function syncNotificationPreferences(preferences) {
  const { error } = await sb.from('notification_preferences').upsert({ user_id:state.user.id, ...preferences, updated_at:new Date().toISOString() }, { onConflict:'user_id' });
  if (error && error.code !== '42P01') throw error;
}
async function saveNotificationSettings(event) {
  event.preventDefault();
  const currentPreferences = loadNotificationPreferences();
  const preferences = Object.fromEntries(Object.keys(notificationPreferenceDefaults).map(kind => [kind, kind === 'quiet_mode' ? Boolean(currentPreferences.quiet_mode) : Boolean($(`#notificationSettingsForm [name="${kind}"]`)?.checked)]));
  try { localStorage.setItem(notificationPreferenceKey(), JSON.stringify(preferences)); }
  catch { return toast('이 브라우저에서는 알림 설정을 저장할 수 없습니다.'); }
  try { await syncNotificationPreferences(preferences); }
  catch { toast('이 기기에는 저장했지만 서버 동기화에는 실패했습니다.'); }
  $('#notificationSettingsDialog').close();
  toast('알림 설정을 저장했습니다.');
}
async function saveQuietActivity() {
  const preferences = { ...loadNotificationPreferences(), quiet_mode:$('#quietActivityToggle').checked };
  try { localStorage.setItem(notificationPreferenceKey(), JSON.stringify(preferences)); }
  catch { return toast('이 브라우저에서는 설정을 저장할 수 없습니다.'); }
  try {
    await syncNotificationPreferences(preferences);
    toast(preferences.quiet_mode ? '조용히 활동하기를 켰습니다. 일반 활동 알림은 다른 참여자에게 가지 않습니다.' : '조용히 활동하기를 껐습니다. 일반 활동 알림을 다시 보냅니다.');
  } catch (error) {
    $('#quietActivityToggle').checked = !preferences.quiet_mode;
    toast('조용히 활동하기 저장에 실패했습니다. 데이터베이스 업데이트가 필요할 수 있습니다.');
  }
}
async function sendReleaseNotification(event) {
  event.preventDefault();
  if (!isMasterUser()) return toast('관리자만 업데이트 알림을 보낼 수 있습니다.');
  const body = $('#releaseNotificationBody').value.trim();
  if (!body || !confirm('시스템 알림을 켠 사용자에게 업데이트 알림을 보낼까요?')) return;
  const { data } = await sb.auth.getSession();
  const response = await fetch('/admin/release-notification', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${data.session?.access_token || ''}` }, body:JSON.stringify({ body }) });
  if (!response.ok) return toast('업데이트 알림 발송에 실패했습니다.');
  $('#releaseNotificationDialog').close(); $('#releaseNotificationBody').value = '';
  toast('업데이트 알림을 발송했습니다.');
}
async function sendAnnouncement(event) {
  event.preventDefault();
  if (!state.active || state.active === 'all') return toast('공지를 보낼 여행 공간을 먼저 선택해 주세요.');
  const body = $('#announcementBody').value.trim();
  const currentSpace = activeSpaceRecord()?.spaces?.name || '현재 여행 공간';
  if (!body || !confirm(`'${currentSpace}'의 공지 알림을 켠 참여자에게 공지를 보낼까요?`)) return;
  const dialog = $('#announcementDialog');
  $('#announcementForm').reset();
  if (dialog.open) dialog.close();
  const { data } = await sb.auth.getSession();
  const response = await fetch('/admin/release-notification', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${data.session?.access_token || ''}` }, body:JSON.stringify({ body, announcement:true, spaceId:state.active }) });
  if (!response.ok) return toast('전체 공지 발송에 실패했습니다.');
  toast('전체 공지를 발송했습니다.');
}
function base64UrlToUint8Array(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
async function savePushSubscription(subscription) {
  const json = subscription.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id:state.user.id,
    endpoint:subscription.endpoint,
    p256dh:json.keys?.p256dh,
    auth:json.keys?.auth,
    user_agent:navigator.userAgent,
    updated_at:new Date().toISOString()
  }, { onConflict:'endpoint' });
  if (error) throw error;
}
async function enablePushSubscription() {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:base64UrlToUint8Array(VAPID_PUBLIC_KEY) });
  await savePushSubscription(subscription);
}
async function requestNotificationPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return toast('이 브라우저에서는 웹 알림을 지원하지 않습니다.');
  if (isIphoneSafari && !isInstalledPwa()) return toast('iPhone에서는 Safari 공유 메뉴에서 홈 화면에 먼저 추가해 주세요.');
  if (Notification.permission === 'denied') return toast('브라우저 설정에서 알림 차단을 해제해 주세요.');
  const permission = await Notification.requestPermission();
  updateNotificationSettingsStatus();
  if (permission !== 'granted') return toast('알림 권한이 허용되지 않았습니다.');
  try {
    await enablePushSubscription();
    toast('푸시 알림을 이 기기에 연결했습니다.');
  } catch (error) {
    toast(`알림 권한은 허용됐지만 푸시 연결에 실패했습니다: ${error.message}`);
  }
}
function isMasterUser() { return Object.values(masterAccounts).includes(state.user?.email); }
function sessionNicknameKey() { return `pin-together-session-nickname:${state.user?.id || 'guest'}`; }
function activeNickname() { return state.sessionNickname || state.profile?.nickname || '참여자'; }
function needsNicknameSetup() { return isMasterUser() && (!state.profile?.nickname || state.profile.nickname === '여행자' || /^Master[1-5]$/i.test(state.profile.nickname)); }
function spaceName() { return state.active === 'all' ? '전체 지도' : state.spaces.find(s => s.space_id === state.active)?.spaces?.name || '지도'; }
function activeSpaceRecord() { return state.spaces.find(space => space.space_id === state.active); }
function isDeletedActiveSpace() { return Boolean(state.active !== 'all' && activeSpaceRecord()?.spaces?.deleted_at); }
function membershipJoinedAt(spaceId) {
  const joinedAt = state.spaces.find(space => space.space_id === spaceId)?.joined_at;
  return joinedAt ? new Date(joinedAt).getTime() : 0;
}
function isActivitySinceJoining(item) {
  if (!item?.space_id) return true;
  const joinedAt = membershipJoinedAt(item.space_id);
  return !joinedAt || new Date(item.created_at).getTime() > joinedAt;
}
function pinIcon(pin) {
  const routeIndex = (state.routeMode ? state.draftRoute : state.route).findIndex(item => item.id === pin.id);
  const commentBadge = pin.comment_count ? `<i class="pin-comment-badge" aria-label="댓글 ${pin.comment_count}개">💬</i>` : '';
  const unreadBadge = pin.unread_comment_count ? `<i class="pin-unread-comment" aria-label="읽지 않은 댓글 ${pin.unread_comment_count}개"></i>` : '';
  const category = pinIconCategories[pin.icon_key];
  if (category) return L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,23], html:`<div class="category-pin-marker" title="${category.label}"><span>${category.icon}</span>${commentBadge}${unreadBadge}${routeIndex >= 0 ? `<i class="route-order"><b>${routeIndex + 1}</b></i>` : ''}</div>` });
  return L.divIcon({ className:'', iconSize:[32,28], iconAnchor:[10,21], html:`<div class="pin-marker" style="background:${colors[pin.color] || colors.coral}"><span>${initials(pin.author_nickname || pin.profiles?.nickname || '나')}</span>${commentBadge}${unreadBadge}${routeIndex >= 0 ? `<i class="route-order"><b>${routeIndex + 1}</b></i>` : ''}</div>` });
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
function scheduledAtValue(input) {
  const value = input?.value;
  return value ? new Date(value).toISOString() : null;
}
function scheduledDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function refreshScheduledCountdowns() {
  document.querySelectorAll('[data-scheduled-at]').forEach(element => {
    element.textContent = scheduledCountdownText(element.dataset.scheduledAt);
  });
}
function addCalendarMonths(date, monthCount) {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + monthCount);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, lastDay));
  return next;
}
function calendarDurationText(earlier, later) {
  let years = later.getFullYear() - earlier.getFullYear();
  let cursor = addCalendarMonths(earlier, years * 12);
  if (cursor > later) { years -= 1; cursor = addCalendarMonths(earlier, years * 12); }
  let months = (later.getFullYear() - cursor.getFullYear()) * 12 + later.getMonth() - cursor.getMonth();
  let monthCursor = addCalendarMonths(cursor, months);
  if (monthCursor > later) { months -= 1; monthCursor = addCalendarMonths(cursor, months); }
  const remainingMinutes = Math.floor(Math.max(0, later.getTime() - monthCursor.getTime()) / 60000);
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  const parts = [[years, '년'], [months, '개월'], [days, '일'], [hours, '시간'], [minutes, '분']]
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount}${unit}`);
  return parts.join(' ') || '0분';
}
function scheduledCountdownText(value) {
  if (!value) return '';
  const scheduledDate = new Date(value);
  const pad = number => String(number).padStart(2, '0');
  const dateText = `${String(scheduledDate.getFullYear()).slice(-2)}년 ${pad(scheduledDate.getMonth() + 1)}월 ${pad(scheduledDate.getDate())}일 ${pad(scheduledDate.getHours())}시 ${pad(scheduledDate.getMinutes())}분`;
  const now = new Date();
  const direction = scheduledDate > now
    ? `여행까지 ${calendarDurationText(now, scheduledDate)} 남음`
    : `여행 후 ${calendarDurationText(scheduledDate, now)} 지남`;
  return `여행일: ${dateText}\n${direction}`;
}
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
  actions.insertAdjacentHTML('afterbegin', '<button id="themeButton" type="button"></button><button id="mapTypeButton" type="button">지도 종류</button><div id="mapTypeMenu" class="hidden"><button type="button" data-map-type="road">🗺 기본 지도</button><button type="button" data-map-type="satellite">🛰 위성 지도</button></div>');
  setTheme(initialTheme);
  $('#themeButton').addEventListener('click', () => setTheme(document.documentElement.classList.contains('dark-mode') ? 'light' : 'dark'));
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
    element.querySelector('[data-popup-poll]')?.addEventListener('click', () => openPinPollDialog(pin.id));
    element.querySelector('[data-popup-checklist]')?.addEventListener('click', () => void openPinChecklist(pin.id));
    element.querySelector('[data-popup-more]')?.addEventListener('click', event => { event.stopPropagation(); const menu = element.querySelector('[data-popup-more-menu]'); const opened = menu?.classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(opened)); });
    state.openPopupPinId = pin.id;
    state.openPopupElement = element;
    void loadSpacePhotos(pin.space_id).then(() => applyPinBackground(element, pin));
    clearTimeout(state.popupCloseTimer);
    state.popupCloseTimer = setTimeout(() => { state.openPopupPinId = null; map.closePopup(); }, 30000);
    const reactionHolder = element.querySelector('[data-popup-reactions]');
    if (reactionHolder && !reactionHolder.querySelector('.pin-reactions')) {
      reactionHolder.innerHTML = reactionMarkup(pin);
      reactionHolder.querySelectorAll('[data-reaction-pin]').forEach(button => button.addEventListener('click', () => void toggleReaction(button.dataset.reactionPin, button.dataset.reactionKind)));
    }
    if (!canManagePin(pin) || element.querySelector('[data-popup-edit]')) return;
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'popup-more-action';
    editButton.dataset.popupEdit = pin.id;
    editButton.textContent = '✎ 핀 편집';
    editButton.addEventListener('click', () => editPin(pin.id));
    element.querySelector('[data-popup-more-menu]')?.append(editButton);
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
  let { data, error } = await sb.from('space_members').select('space_id, role, joined_at, spaces(id,name,owner_id,created_at,deleted_at,purge_at)').eq('user_id', state.user.id).order('joined_at');
  // Keep existing spaces usable until the optional soft-delete SQL migration has been run.
  if (error && /deleted_at|purge_at/i.test(error.message || '')) {
    ({ data, error } = await sb.from('space_members').select('space_id, role, joined_at, spaces(id,name,owner_id,created_at)').eq('user_id', state.user.id).order('joined_at'));
  }
  if (error) throw error;
  state.spaces = data || [];
  const select = $('#spaceSelect');
  select.innerHTML = '<option value="all">전체 지도</option>' + state.spaces.map(row => `<option value="${row.space_id}">${escapeHtml(row.spaces.name)}${row.spaces.deleted_at ? ' (삭제됨)' : ''}</option>`).join('');
  const savedSpace = state.profile?.last_space_id || localStorage.getItem(lastSpaceStorageKey());
  if (savedSpace && state.spaces.some(space => space.space_id === savedSpace)) state.active = savedSpace;
  else if (!state.active || (state.active !== 'all' && !state.spaces.some(s => s.space_id === state.active))) state.active = state.spaces[0]?.space_id || 'all';
  select.value = state.active;
}
function pollIsActive(poll) { return new Date(poll.closes_at).getTime() > Date.now(); }
function pollDeadlineText(value) {
  const minutes = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 60000));
  if (!minutes) return '마감됨';
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  return `마감까지 ${days ? `${days}일 ` : ''}${hours ? `${hours}시간 ` : ''}${mins}분`;
}
async function loadPolls() {
  if (!state.active || state.active === 'all') { state.polls = []; renderPolls(); return; }
  const { data: polls, error } = await sb.from('polls').select('*').eq('space_id', state.active).order('created_at', { ascending:false });
  if (error) { state.polls = []; renderPolls(); return; }
  const ids = (polls || []).map(poll => poll.id);
  const [optionsResult, votesResult, linksResult] = await Promise.all([
    ids.length ? sb.from('poll_options').select('*').in('poll_id', ids).order('position') : Promise.resolve({ data:[] }),
    ids.length ? sb.from('poll_votes').select('poll_id,option_id,voter_id').in('poll_id', ids) : Promise.resolve({ data:[] }),
    ids.length ? sb.from('poll_pin_links').select('poll_id,pin_id').in('poll_id', ids) : Promise.resolve({ data:[] })
  ]);
  const options = optionsResult.data || [], votes = votesResult.data || [], links = linksResult.data || [];
  state.polls = (polls || []).map(poll => ({ ...poll, options:options.filter(option => option.poll_id === poll.id), votes:votes.filter(vote => vote.poll_id === poll.id), pin_ids:links.filter(link => link.poll_id === poll.id).map(link => link.pin_id) }));
  renderPolls();
  if ($('#notificationsDialog').open) renderNotifications();
}
function renderPolls() {
  const list = $('#pollList'), count = $('#pollCount');
  if (!list || !count) return;
  count.textContent = state.polls.filter(pollIsActive).length || '';
  list.innerHTML = state.polls.map(poll => {
    const active = pollIsActive(poll), total = poll.votes.length;
    const pins = linkedPins(poll);
    return `<button type="button" class="poll-card ${active ? 'active' : 'closed'}" data-open-poll="${poll.id}"><strong>${escapeHtml(poll.title)}</strong><small>생성자: ${escapeHtml(pollCreatorName(poll))}</small><small>${active ? pollDeadlineText(poll.closes_at) : '투표 마감'} · ${total}표</small>${pins.length ? `<span class="poll-card-pin">📍 ${pins.map(pin => escapeHtml(pin.title)).join(' · ')}</span>` : ''}</button>`;
  }).join('') || '<p class="label">아직 생성된 투표가 없습니다.</p>';
  list.querySelectorAll('[data-open-poll]').forEach(button => button.addEventListener('click', () => openPollDetail(button.dataset.openPoll)));
}
function renderPollOptionInputs() {
  const container = $('#pollOptionInputs');
  container.innerHTML = pollOptionDrafts.map((value, index) => `<div class="poll-option-input"><input data-poll-option-input="${index}" maxlength="100" value="${escapeHtml(value)}" placeholder="항목 ${index + 1}" /><button type="button" data-remove-poll-option="${index}" aria-label="항목 삭제">×</button></div>`).join('');
  container.querySelectorAll('[data-poll-option-input]').forEach(input => input.addEventListener('input', () => { pollOptionDrafts[Number(input.dataset.pollOptionInput)] = input.value; }));
  container.querySelectorAll('[data-remove-poll-option]').forEach(button => button.addEventListener('click', () => { pollOptionDrafts.splice(Number(button.dataset.removePollOption), 1); renderPollOptionInputs(); }));
}
function openPollCreateDialog(linkedPinId='') {
  if (state.active === 'all') return toast('투표를 만들 여행 공간을 선택해 주세요.');
  selectedPollPinId = linkedPinId; pollOptionDrafts = ['', '']; renderPollOptionInputs(); $('#pollCreateForm').reset(); renderPollCreateLinkedPin(); showDialog('pollCreateDialog');
}
function renderPollCreateLinkedPin() {
  const pin = state.pins.find(item => item.id === selectedPollPinId);
  $('#pollCreateLinkedPin').textContent = pin ? `📍 ${pin.title}` : '연결하지 않음';
}
function renderPollPinPicker() {
  const query = $('#pollPinSearch').value.trim().toLowerCase();
  const pins = state.pins.filter(pin => `${pin.title} ${pin.note || ''} ${(pin.tags || []).join(' ')}`.toLowerCase().includes(query));
  $('#pollPinPickerList').innerHTML = pins.map(pin => `<button type="button" class="poll-pin-choice ${selectedPollPinId === pin.id ? 'selected' : ''}" data-select-poll-pin="${pin.id}"><span>📍</span><div><strong>${escapeHtml(pin.title)}</strong><small>${escapeHtml(pin.note || '메모 없음')}</small></div></button>`).join('') || '<p class="label">일치하는 핀이 없습니다.</p>';
  $('#pollPinPickerList').querySelectorAll('[data-select-poll-pin]').forEach(button => button.addEventListener('click', () => { selectedPollPinId = button.dataset.selectPollPin; renderPollPinPicker(); }));
}
function openPollPinPicker(target='create') {
  pollPinPickerTarget = target; $('#pollPinSearch').value = ''; renderPollPinPicker(); showDialog('pollPinPickerDialog');
}
function linkedPins(poll) { return (poll.pin_ids || []).map(id => state.pins.find(pin => pin.id === id)).filter(Boolean); }
function focusLinkedPin(pinId) {
  const pin = state.pins.find(item => item.id === pinId); if (!pin) return toast('연결된 핀 정보를 찾을 수 없습니다.');
  $('#pollDetailDialog').close(); $('#pinPollDialog').close();
  map.flyTo([pin.latitude, pin.longitude], 15);
  let marker; state.markers?.eachLayer(layer => { if (layer.options?.pinId === pin.id) marker = layer; });
  marker?.openPopup();
}
async function linkPollToPin(pollId, pinId) {
  const { error } = await sb.from('poll_pin_links').upsert({ poll_id:pollId, pin_id:pinId }, { onConflict:'poll_id,pin_id', ignoreDuplicates:true });
  if (error) return toast(`핀 연결에 실패했습니다: ${error.message}`);
  await loadPolls(); toast('기존 투표를 이 핀에 연결했습니다.');
}
function openPinPollDialog(pinId) {
  const pin = state.pins.find(item => item.id === pinId); if (!pin) return;
  pinPollDialogPinId = pinId; $('#pinPollDialogTitle').textContent = `📍 ${pin.title} · 투표`;
  const linkedPolls = state.polls.filter(poll => (poll.pin_ids || []).includes(pinId));
  const availablePolls = state.polls.filter(poll => !(poll.pin_ids || []).includes(pinId));
  const pollMarkup = poll => `<button type="button" class="poll-pin-choice ${pollIsActive(poll) ? '' : 'closed'}" data-link-existing-poll="${poll.id}"><span>🗳️</span><div><strong>${escapeHtml(poll.title)}</strong><small>${pollIsActive(poll) ? pollDeadlineText(poll.closes_at) : '투표 마감'}</small></div></button>`;
  $('#pinPollCandidateList').innerHTML = `${linkedPolls.length ? `<section class="pin-poll-group"><strong>연결된 투표</strong>${linkedPolls.map(poll => `<button type="button" class="poll-pin-choice selected" data-open-linked-poll="${poll.id}"><span>🗳️</span><div><strong>${escapeHtml(poll.title)}</strong><small>${pollIsActive(poll) ? pollDeadlineText(poll.closes_at) : '투표 마감'}</small></div></button>`).join('')}</section>` : ''}<section class="pin-poll-group"><strong>기존 투표</strong>${availablePolls.map(pollMarkup).join('') || '<p class="label">연결할 기존 투표가 없습니다.</p>'}</section>`;
  $('#pinPollCandidateList').querySelectorAll('[data-link-existing-poll]').forEach(button => button.addEventListener('click', async () => { await linkPollToPin(button.dataset.linkExistingPoll, pinId); openPinPollDialog(pinId); }));
  $('#pinPollCandidateList').querySelectorAll('[data-open-linked-poll]').forEach(button => button.addEventListener('click', () => { $('#pinPollDialog').close(); openPollDetail(button.dataset.openLinkedPoll); }));
  showDialog('pinPollDialog');
}
function pollVoterNames(poll, optionId) {
  const votes = poll.votes.filter(vote => vote.option_id === optionId);
  if (poll.is_anonymous) return votes.map(() => '익명');
  const names = new Map(state.members.map(member => [member.user_id, member.nickname]));
  names.set(state.user?.id, activeNickname());
  return votes.map(vote => names.get(vote.voter_id) || '참여자');
}
function openPollVoters(pollId, optionId) {
  const poll = state.polls.find(item => item.id === pollId), option = poll?.options.find(item => item.id === optionId);
  if (!poll || !option) return;
  const names = pollVoterNames(poll, optionId);
  $('#pollVotersTitle').textContent = `${option.label} · 투표자`;
  $('#pollVotersSummary').textContent = poll.is_anonymous ? `${names.length}표 · 익명 투표` : `${names.length}명 참여`;
  $('#pollVotersList').innerHTML = names.length ? names.map(name => `<p>${escapeHtml(name)}</p>`).join('') : '<p class="label">아직 투표한 사람이 없습니다.</p>';
  showDialog('pollVotersDialog');
}
function pollCreatorName(poll) {
  if (poll.creator_id === state.user?.id) return activeNickname();
  return state.members.find(member => member.user_id === poll.creator_id)?.nickname || '참여자';
}
function renderPollDetail(pollId) {
  const poll = state.polls.find(item => item.id === pollId);
  if (!poll) return;
  const active = pollIsActive(poll), myVotes = poll.votes.filter(vote => vote.voter_id === state.user.id).map(vote => vote.option_id);
  const counts = poll.options.map(option => poll.votes.filter(vote => vote.option_id === option.id).length);
  const total = counts.reduce((sum, value) => sum + value, 0), highest = Math.max(0, ...counts);
  $('#pollDetailTitle').textContent = poll.title;
  $('#pollDetailMeta').textContent = `생성자: ${pollCreatorName(poll)} · ${active ? pollDeadlineText(poll.closes_at) : '투표가 마감되었습니다.'} · ${total}표${poll.is_anonymous ? ' · 익명 투표' : ''}`;
  $('#pollDetailPins').innerHTML = linkedPins(poll).map(pin => `<button type="button" class="poll-linked-pin" data-open-linked-pin="${pin.id}">📍 ${escapeHtml(pin.title)}</button>`).join('');
  $('#pollDetailOptions').innerHTML = poll.options.map((option, index) => {
    const votes = counts[index], selected = myVotes.includes(option.id), percentage = total ? Math.round((votes / total) * 100) : 0;
    const voterButton = `<button type="button" class="poll-voter-button" data-poll-voters="${poll.id}" data-poll-option="${option.id}" aria-label="${escapeHtml(option.label)} 투표자 ${votes}명 보기">참여자 <b>${votes}명</b></button>`;
    if (active) return `<article class="poll-option ${selected ? 'selected' : ''}"><button type="button" class="poll-vote-option" data-vote-option="${option.id}" data-vote-poll="${poll.id}"><span>${poll.allow_multiple ? (selected ? '☑' : '☐') : (selected ? '◉' : '○')}</span><span>${escapeHtml(option.label)}</span></button>${voterButton}</article>`;
    return `<article class="poll-result ${votes && votes === highest ? 'winner' : ''}"><div><strong>${escapeHtml(option.label)}${votes && votes === highest ? ' · 최다 득표' : ''}</strong>${voterButton}</div><i><b style="width:${percentage}%"></b></i><small>${votes}표 · ${percentage}%</small></article>`;
  }).join('') || '<p class="label">등록된 항목이 없습니다.</p>';
  $('#pollDetailAddArea').classList.toggle('hidden', !active);
  $('#pollDetailAddButton').dataset.pollId = poll.id;
  $('#deletePollButton').classList.toggle('hidden', poll.creator_id !== state.user?.id);
  $('#deletePollButton').dataset.pollId = poll.id;
  $('#pollDetailOptionDraft').value = '';
  $('#pollDetailOptions').querySelectorAll('[data-vote-option]').forEach(button => button.addEventListener('click', () => void castPollVote(button.dataset.votePoll, button.dataset.voteOption)));
  $('#pollDetailOptions').querySelectorAll('[data-poll-voters]').forEach(button => button.addEventListener('click', () => openPollVoters(button.dataset.pollVoters, button.dataset.pollOption)));
  $('#pollDetailPins').querySelectorAll('[data-open-linked-pin]').forEach(button => button.addEventListener('click', () => focusLinkedPin(button.dataset.openLinkedPin)));
}
function openPollDetail(pollId) { renderPollDetail(pollId); showDialog('pollDetailDialog'); }
async function deletePoll(pollId) {
  const poll = state.polls.find(item => item.id === pollId);
  if (!poll || poll.creator_id !== state.user?.id) return toast('투표 생성자만 삭제할 수 있습니다.');
  if (!confirm(`“${poll.title}” 투표를 삭제할까요? 연결된 핀과 투표 기록도 함께 삭제됩니다.`)) return;
  const { error } = await sb.from('polls').delete().eq('id', pollId).eq('creator_id', state.user.id);
  if (error) return toast(`투표 삭제에 실패했습니다: ${error.message}`);
  $('#pollDetailDialog').close();
  await loadPolls();
  toast('투표를 삭제했습니다.');
}
async function addPollOption(pollId) {
  const poll = state.polls.find(item => item.id === pollId), input = $('#pollDetailOptionDraft'), label = input.value.trim();
  if (!poll || !pollIsActive(poll) || !label) return;
  if (poll.options.some(option => option.label.trim().toLowerCase() === label.toLowerCase())) return toast('같은 이름의 항목이 이미 있습니다.');
  const { error } = await sb.from('poll_options').insert({ poll_id:pollId, label, position:poll.options.length });
  if (error) return toast(`항목 추가에 실패했습니다: ${error.message}`);
  await loadPolls(); renderPollDetail(pollId); toast('새 투표 항목을 추가했습니다.');
}
async function createPoll(event) {
  event.preventDefault();
  const draft = $('#pollOptionDraft').value.trim(); if (draft) pollOptionDrafts.push(draft);
  const options = [...new Set(pollOptionDrafts.map(value => value.trim()).filter(Boolean))];
  if (options.length < 2) return toast('투표 항목은 두 개 이상 입력해 주세요.');
  const closesAt = scheduledAtValue($('#pollClosesAt')) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); if (new Date(closesAt) <= new Date()) return toast('미래의 투표 마감 시간을 지정해 주세요.');
  const { data: poll, error } = await sb.from('polls').insert({ space_id:state.active, creator_id:state.user.id, title:$('#pollTitle').value.trim(), allow_multiple:$('#pollAllowMultiple').checked, is_anonymous:$('#pollAnonymous').checked, allow_change:$('#pollAllowChange').checked, closes_at:closesAt }).select().single();
  if (error) return toast(`투표 생성에 실패했습니다: ${error.message}`);
  const { error: optionError } = await sb.from('poll_options').insert(options.map((label, position) => ({ poll_id:poll.id, label, position })));
  if (optionError) return toast(`투표는 생성됐지만 항목 저장에 실패했습니다: ${optionError.message}`);
  if (selectedPollPinId) { const { error: linkError } = await sb.from('poll_pin_links').insert({ poll_id:poll.id, pin_id:selectedPollPinId }); if (linkError) toast(`투표는 생성됐지만 핀 연결에 실패했습니다: ${linkError.message}`); }
  $('#pollCreateDialog').close(); await loadPolls(); toast('투표를 생성했습니다.');
}
async function castPollVote(pollId, optionId) {
  const poll = state.polls.find(item => item.id === pollId); if (!poll || !pollIsActive(poll)) return;
  const mine = poll.votes.filter(vote => vote.voter_id === state.user.id);
  if (!poll.allow_change && mine.length) return toast('이 투표는 변경할 수 없습니다.');
  const selected = mine.some(vote => vote.option_id === optionId);
  if (selected) { const { error } = await sb.from('poll_votes').delete().eq('poll_id', pollId).eq('option_id', optionId).eq('voter_id', state.user.id); if (error) return toast(error.message); }
  else { if (!poll.allow_multiple) { const { error } = await sb.from('poll_votes').delete().eq('poll_id', pollId).eq('voter_id', state.user.id); if (error) return toast(error.message); } const { error } = await sb.from('poll_votes').insert({ poll_id:pollId, option_id:optionId, voter_id:state.user.id }); if (error) return toast(error.message); }
  await loadPolls();
  if ($('#pollDetailDialog').open) renderPollDetail(pollId);
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
function updateLeaveTravelSpaceButton() {
  const button = $('#leaveTravelSpaceButton');
  if (!button) return;
  const hasActiveSpace = state.active !== 'all';
  button.classList.toggle('hidden', !hasActiveSpace);
  button.title = hasActiveSpace ? '' : '나갈 여행 공간을 먼저 선택하세요.';
}
async function finishLeavingTravelSpace(name) {
  closeDialogs();
  state.active = 'all';
  state.selected = [];
  state.route = [];
  state.draftRoute = [];
  state.activeRouteId = null;
  await rememberActiveSpace();
  await refresh();
  toast(`'${name}'에서 나갔습니다.`);
}
function openOwnerLeaveDialog() {
  const candidates = state.members.filter(member => member.user_id !== state.user.id);
  if (!candidates.length) return toast('소유권을 넘길 다른 참가자가 없습니다. 여행 공간을 삭제하거나 참가자를 먼저 초대해 주세요.');
  $('#ownerTransferTarget').innerHTML = candidates.map(member => `<option value="${member.user_id}">${escapeHtml(member.nickname)} (${member.role === 'editor' ? '편집 가능' : '보기 전용'})</option>`).join('');
  showDialog('ownerLeaveDialog');
}
async function leaveCurrentSpace() {
  if (state.active === 'all') return toast('나갈 여행 공간을 먼저 선택하세요.');
  if (currentRole() === 'owner') return openOwnerLeaveDialog();
  const space = state.spaces.find(item => item.space_id === state.active);
  const name = space?.spaces?.name || '이 여행 공간';
  if (!confirm(`'${name}'에서 나갈까요? 핀과 대화는 공간에 그대로 남습니다.`)) return;
  if (!confirm(`한 번 더 확인할게요. 정말 '${name}'에서 나갈까요?`)) return;
  const { error } = await sb.from('space_members').delete().eq('space_id', state.active).eq('user_id', state.user.id);
  if (error) return toast(`여행 공간 나가기에 실패했습니다: ${error.message}`);
  await finishLeavingTravelSpace(name);
}
async function transferOwnershipAndLeave(event) {
  event.preventDefault();
  if (state.active === 'all' || currentRole() !== 'owner') return toast('여행 공간 소유자만 소유권을 넘길 수 있습니다.');
  const nextOwnerId = $('#ownerTransferTarget').value;
  const nextOwner = state.members.find(member => member.user_id === nextOwnerId);
  if (!nextOwner) return toast('새 소유자를 선택해 주세요.');
  const name = state.spaces.find(item => item.space_id === state.active)?.spaces?.name || '이 여행 공간';
  if (!confirm(`${nextOwner.nickname} 님에게 '${name}'의 소유권을 넘기고 나갈까요?`)) return;
  if (!confirm('한 번 더 확인할게요. 권한을 넘기면 이 작업은 되돌릴 수 없습니다. 정말 나갈까요?')) return;
  const { error } = await sb.rpc('transfer_space_ownership_and_leave', { target_space_id:state.active, next_owner_id:nextOwnerId });
  if (error) return toast(`소유권 이전에 실패했습니다: ${error.message}`);
  await finishLeavingTravelSpace(name);
}
async function loadPins() {
  const startedAt = performance.now();
  const query = sb.from('pins').select('*, profiles!pins_author_id_fkey(nickname,pin_color)').order('created_at', { ascending:false });
  const { data, error } = state.active === 'all' ? await query : await query.eq('space_id', state.active);
  if (error) throw error;
  state.pins = data || [];
  state.pinById = new Map(state.pins.map(pin => [pin.id, pin]));
  const ids = state.pins.map(pin => pin.id);
  const emptyResult = Promise.resolve({ data:[] });
  const [tagResult, reactionResult, commentResult, commentReadResult, favoriteResult] = await Promise.all([
    ids.length ? sb.from('pin_tags').select('pin_id,tag').in('pin_id',ids) : emptyResult,
    ids.length ? sb.from('pin_reactions').select('pin_id,user_id,kind,profiles!pin_reactions_user_id_fkey(nickname)').in('pin_id', ids) : emptyResult,
    ids.length ? sb.from('pin_comments').select('pin_id,author_id,created_at').in('pin_id', ids) : emptyResult,
    ids.length ? sb.from('pin_comment_reads').select('pin_id,last_read_at').eq('user_id', state.user.id).in('pin_id', ids) : emptyResult,
    ids.length ? sb.from('shared_favorite_pins').select('pin_id').in('pin_id', ids) : emptyResult,
    loadSharedRoute()
  ]);
  const tagRows = tagResult.data;
  const tagsByPin = new Map();
  (tagRows || []).forEach(row => tagsByPin.set(row.pin_id, [...(tagsByPin.get(row.pin_id) || []), row.tag]));
  state.pins.forEach(pin => pin.tags = tagsByPin.get(pin.id) || []);
  const reactionRows = reactionResult.data;
  const reactionsByPin = new Map();
  (reactionRows || []).forEach(row => reactionsByPin.set(row.pin_id, [...(reactionsByPin.get(row.pin_id) || []), row]));
  state.pins.forEach(pin => pin.reactions = reactionsByPin.get(pin.id) || []);
  const commentRows = commentResult.data;
  const commentCounts = new Map();
  (commentRows || []).forEach(row => commentCounts.set(row.pin_id, (commentCounts.get(row.pin_id) || 0) + 1));
  state.pins.forEach(pin => pin.comment_count = commentCounts.get(pin.id) || 0);
  const commentReadRows = commentReadResult.data;
  const readAtByPin = new Map((commentReadRows || []).map(row => [row.pin_id, new Date(row.last_read_at).getTime()]));
  const unreadCounts = new Map();
  (commentRows || []).forEach(row => {
    const joinedAt = membershipJoinedAt(state.pinById.get(row.pin_id)?.space_id);
    if (row.author_id === state.user.id || new Date(row.created_at).getTime() <= Math.max(readAtByPin.get(row.pin_id) || 0, joinedAt)) return;
    unreadCounts.set(row.pin_id, (unreadCounts.get(row.pin_id) || 0) + 1);
  });
  state.pins.forEach(pin => pin.unread_comment_count = unreadCounts.get(pin.id) || 0);
  renderTagFilter();
  const favs = favoriteResult.data;
  state.favorites = new Set((favs || []).map(f => f.pin_id));
  if (map) updateMeasure();
  renderPins();
  recordPerformance('loadPins', startedAt, { requests:1 + (ids.length ? 5 : 0) + (state.active === 'all' ? 0 : 1), networkStages:ids.length ? 2 : 1, pins:state.pins.length });
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
  const joinedAt = membershipJoinedAt(state.active);
  let query = sb.from('messages').select('id,author_id').eq('space_id',state.active).neq('author_id',state.user.id);
  if (joinedAt) query = query.gt('created_at', new Date(joinedAt).toISOString());
  const { data: messages } = await query.limit(200);
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
function reactionButtonsMarkup(pin) {
  return reactionTypes.map(type => {
    const rows = (pin.reactions || []).filter(row => row.kind === type.kind);
    const names = rows.map(row => row.profiles?.nickname || '참여자');
    const people = names.length ? `${names.slice(0,2).join(', ')}${names.length > 2 ? ` 외 ${names.length - 2}명` : ''}` : '';
    return `<button type="button" class="reaction-button ${rows.some(row => row.user_id === state.user?.id) ? 'active' : ''}" data-reaction-pin="${pin.id}" data-reaction-kind="${type.kind}" title="${type.label}${people ? `: ${people}` : ''}">${type.icon}<small>${people || '0'}</small></button>`;
  }).join('');
}
function reactionMarkup(pin) {
  return `<div class="pin-reactions">${reactionButtonsMarkup(pin)}</div>`;
}
function bindReactionButtons(root=document) {
  root.querySelectorAll('[data-reaction-pin]').forEach(button => button.addEventListener('click', () => void toggleReaction(button.dataset.reactionPin, button.dataset.reactionKind)));
}
function refreshPinReactionUi(pinId) {
  const pin = state.pinById.get(pinId) || state.pins.find(item => item.id === pinId);
  if (!pin) return;
  document.querySelectorAll('.pin-item').forEach(item => {
    if (item.dataset.pin !== pinId) return;
    const holder = item.querySelector('.pin-reactions');
    if (!holder) return;
    const commentCount = holder.querySelector('.pin-comment-count');
    holder.replaceChildren();
    if (commentCount) holder.append(commentCount);
    holder.insertAdjacentHTML('beforeend', reactionButtonsMarkup(pin));
    bindReactionButtons(holder);
  });
  refreshOpenPopupReactions();
}
async function toggleReaction(pinId, kind) {
  const startedAt = performance.now();
  const pin = state.pinById.get(pinId) || state.pins.find(item => item.id === pinId);
  if (!pin) return;
  const previousReactions = pin.reactions || [];
  const mine = previousReactions.find(row => row.user_id === state.user.id);
  pin.reactions = mine?.kind === kind
    ? previousReactions.filter(row => row.user_id !== state.user.id)
    : [...previousReactions.filter(row => row.user_id !== state.user.id), { pin_id:pinId, user_id:state.user.id, kind, profiles:{ nickname:activeNickname() } }];
  refreshPinReactionUi(pinId);
  const request = mine?.kind === kind
    ? sb.from('pin_reactions').delete().eq('pin_id', pinId).eq('user_id', state.user.id)
    : sb.from('pin_reactions').upsert({ pin_id:pinId, user_id:state.user.id, kind }, { onConflict:'pin_id,user_id' });
  const { error } = await request;
  if (error) {
    pin.reactions = previousReactions;
    refreshPinReactionUi(pinId);
    return toast('반응 기능을 사용하려면 pin-reactions-migration.sql을 실행해 주세요.');
  }
  recordPerformance('toggleReaction', startedAt, { requests:1, pinId });
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
  const row = pin => { const category = pinIconCategories[pin.icon_key]; return `<div class="pin-item ${state.selected.some(p => p.id === pin.id) || displayRoute.some(p => p.id === pin.id) ? 'selected' : ''}" data-pin="${pin.id}"><span class="dot ${category ? 'pin-category-icon' : ''}" style="background:${colors[pin.color] || colors.coral}" title="${category?.label || ''}">${category?.icon || ''}</span><button class="pin-open" data-pin="${pin.id}"><strong>${escapeHtml(pin.title)}${pin.comment_count ? ` <span class="pin-comment-count" title="댓글 ${pin.comment_count}개">↳ ${pin.comment_count}</span>` : ''}${pin.unread_comment_count ? ` <i class="pin-unread-dot" title="읽지 않은 댓글 ${pin.unread_comment_count}개" aria-label="읽지 않은 댓글 ${pin.unread_comment_count}개"></i>` : ''}</strong><small class="pin-note">${escapeHtml(pin.note || '메모 없음')}</small>${pin.scheduled_at ? `<small class="pin-schedule" data-scheduled-at="${escapeHtml(pin.scheduled_at)}">${scheduledCountdownText(pin.scheduled_at)}</small>` : ''}<small>${escapeHtml(pin.author_nickname || pin.profiles?.nickname || '참여자')} · ${timeFull(pin.created_at)}</small>${(pin.tags || []).length ? `<span class="pin-tags">${pin.tags.map(tag => `<i class="pin-tag">#${escapeHtml(tag)}</i>`).join('')}</span>` : ''}</button><span class="pin-actions"><button data-favorite="${pin.id}" title="즐겨찾기">${state.favorites.has(pin.id) ? '★' : '☆'}</button><button data-comment="${pin.id}" title="댓글">💬</button>${canManagePin(pin) ? `<button data-edit="${pin.id}" title="핀 편집">✎</button><button data-delete-pin="${pin.id}" title="핀 삭제">×</button>` : ''}</span></div>`; };
  $('#favoriteList').innerHTML = pins.filter(pin => state.favorites.has(pin.id)).map(row).join('') || '<small>즐겨찾기한 핀이 없습니다.</small>';
  $('#pinList').innerHTML = pins.map(row).join('') || '<small>아직 핀이 없습니다.</small>';
  paintPinListBackgrounds();
  document.querySelectorAll('.pin-item').forEach(item => {
    const pin = state.pins.find(entry => entry.id === item.dataset.pin);
    if (!pin) return;
    item.insertAdjacentHTML('beforeend', reactionMarkup(pin));
    let commentCount = item.querySelector('.pin-comment-count');
    const reactions = item.querySelector('.pin-reactions');
    if (!commentCount) {
      commentCount = document.createElement('span');
      commentCount.className = 'pin-comment-count';
      commentCount.title = '댓글 0개';
      commentCount.textContent = '↳ 0';
    }
    commentCount.classList.toggle('has-unread-comments', Boolean(pin.unread_comment_count));
    item.querySelector('.pin-unread-dot')?.remove();
    if (reactions) reactions.prepend(commentCount);
    item.querySelector('.pin-actions')?.insertAdjacentHTML('beforeend', `<button type="button" data-pin-poll="${pin.id}" title="투표">🗳️</button>`);
    item.querySelector('.pin-actions')?.insertAdjacentHTML('beforeend', `<button type="button" data-pin-checklist="${pin.id}" title="체크리스트">✅</button>`);
  });
  if (!keepMapPopup) state.pins.forEach(pin => L.marker([pin.latitude, pin.longitude], { icon:pinIcon(pin), pinId:pin.id }).addTo(state.markers).bindPopup(`<article class="pin-popup-card"><strong class="pin-popup-title">${escapeHtml(pin.title)}</strong><div class="pin-popup-meta"><small>작성자 · ${escapeHtml(pin.author_nickname || pin.profiles?.nickname || '참여자')}</small><small>${escapeHtml(pin.note || '메모 없음')}</small>${pin.scheduled_at ? `<small class="popup-schedule" data-scheduled-at="${escapeHtml(pin.scheduled_at)}">${scheduledCountdownText(pin.scheduled_at)}</small>` : ''}<small>핀 생성 · ${timeFull(pin.created_at)}</small></div><div class="pin-popup-actions"><button type="button" class="popup-primary-action popup-comment-action" data-popup-comment="${pin.id}"><span>💬</span>댓글</button><button type="button" class="popup-primary-action popup-checklist-action" data-popup-checklist="${pin.id}"><span>✅</span>체크리스트</button><div class="popup-more"><button type="button" class="popup-more-trigger" data-popup-more aria-expanded="false" aria-label="더보기">⋯</button><div class="popup-more-menu" data-popup-more-menu><button type="button" class="popup-more-action popup-favorite-action" data-favorite="${pin.id}">☆ 즐겨찾기</button><button type="button" class="popup-more-action" data-popup-poll="${pin.id}">🗳️ 투표</button></div></div></div><div class="popup-reactions" data-popup-reactions></div></article>`).on('click', () => { if (state.routeMode) selectPin(pin); }).on('popupopen', event => event.popup.getElement()?.querySelector('[data-popup-comment]')?.addEventListener('click', () => openComments(pin.id))));
  refreshScheduledCountdowns();
  document.querySelectorAll('.pin-open').forEach(el => el.addEventListener('click', () => { const pin = state.pins.find(p => p.id === el.dataset.pin); map.flyTo([pin.latitude, pin.longitude], 15); selectPin(pin); }));
  document.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => editPin(el.dataset.edit)));
  document.querySelectorAll('[data-delete-pin]').forEach(el => el.addEventListener('click', () => deletePin(el.dataset.deletePin)));
  document.querySelectorAll('[data-comment]').forEach(el => el.remove());
  document.querySelectorAll('[data-pin-poll]').forEach(button => button.addEventListener('click', () => openPinPollDialog(button.dataset.pinPoll)));
  document.querySelectorAll('[data-pin-checklist]').forEach(button => button.addEventListener('click', () => void openPinChecklist(button.dataset.pinChecklist)));
  document.querySelectorAll('.pin-comment-count').forEach(el => el.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const pinId = el.closest('.pin-item')?.dataset.pin;
    if (pinId) void openComments(pinId);
  }));
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
function renderPinIconChoices(containerId, valueId) {
  const container = $(`#${containerId}`);
  if (!container) return;
  container.innerHTML = Object.entries(pinIconCategories).map(([key, category]) => `<button type="button" class="pin-icon-choice" data-pin-icon-key="${key}" aria-pressed="false"><span>${category.icon}</span>${category.label}</button>`).join('');
  container.querySelectorAll('[data-pin-icon-key]').forEach(button => button.addEventListener('click', () => {
    $(`#${valueId}`).value = button.dataset.pinIconKey;
    container.querySelectorAll('[data-pin-icon-key]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
}
function setPinIconChoice(containerId, valueId, key='') {
  const input = $(`#${valueId}`);
  if (!input) return;
  input.value = pinIconCategories[key] ? key : '';
  $(`#${containerId}`)?.querySelectorAll('[data-pin-icon-key]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pinIconKey === input.value)));
}
function bindPinIconPicker(toggleId, fieldId, containerId, valueId) {
  const toggle = $(`#${toggleId}`), field = $(`#${fieldId}`);
  if (!toggle || !field) return;
  renderPinIconChoices(containerId, valueId);
  toggle.addEventListener('change', () => {
    field.classList.toggle('hidden', !toggle.checked);
    if (!toggle.checked) setPinIconChoice(containerId, valueId);
  });
}
function openPinDialog(latlng) {
  if (state.active === 'all') return toast('핀을 추가할 여행 공간을 먼저 선택해 주세요.');
  state.pending = latlng;
  $('#pinColor').value = state.profile.pin_color;
  $('#pinIconEnabled').checked = false;
  $('#pinIconField').classList.add('hidden');
  setPinIconChoice('pinIconChoices', 'pinIconChoice');
  const form = $('#pinForm');
  // Keep the dialog itself focused while it opens so mobile keyboards do not appear automatically.
  form.inert = true;
  showDialog('pinDialog');
  requestAnimationFrame(() => { $('#pinDialog').focus({ preventScroll:true }); form.inert = false; });
}
async function createPin(event) {
  event.preventDefault(); if (!state.pending || state.active === 'all') return;
  const scheduledAt = $('#pinScheduleEnabled').checked ? scheduledAtValue($('#pinScheduledAt')) : null;
  if ($('#pinScheduleEnabled').checked && !scheduledAt) return toast('여행 일정 날짜와 시간을 지정해 주세요.');
  const iconKey = $('#pinIconEnabled').checked ? $('#pinIconChoice').value || null : null;
  if ($('#pinIconEnabled').checked && !iconKey) return toast('표시할 아이콘을 선택해 주세요.');
  const { data, error } = await sb.from('pins').insert({ space_id:state.active, author_id:state.user.id, title:$('#pinTitle').value.trim(), note:$('#pinNote').value.trim(), color:$('#pinColor').value, icon_key:iconKey, latitude:state.pending.lat, longitude:state.pending.lng, scheduled_at:scheduledAt }).select().single();
  if (error) return toast(error.message);
  for (const sourceId of pinChecklistSourceIds) await cloneChecklistToPin(sourceId, data.id);
  const automaticIconTag = iconKey ? pinIconCategories[iconKey]?.label : '';
  // The category tag comes first so it is still saved when the user already entered five tags.
  const tags = parseTags([automaticIconTag, $('#pinTags')?.value || ''].filter(Boolean).join(','));
  if (tags.length) { const { error: tagError } = await sb.from('pin_tags').insert(tags.map(tag => ({ pin_id:data.id, tag }))); if (tagError) toast('핀은 저장됐지만 태그 DB 설정이 필요합니다.'); }
  try { await uploadPinBackground(data.id, state.pendingPinBackground || $('#pinBackgroundInput')?.files?.[0]); } catch (backgroundError) { alert(`배경 사진 업로드에 실패했습니다.\n${backgroundError.message}`); }
  state.pendingPinBackground = null;
  closeDialogs(); state.pending = null; pinChecklistSourceIds = []; $('#pinForm').reset(); $('#pinChecklistButton').textContent = '체크리스트 가져오기'; $('#pinScheduleField').classList.add('hidden'); await loadPins(); await loadSpacePhotos(); await loadChecklists(); toast('핀이 추가되었습니다.');
}
async function toggleFavorite(pinId) {
  const startedAt = performance.now();
  const isFavorite = state.favorites.has(pinId);
  isFavorite ? state.favorites.delete(pinId) : state.favorites.add(pinId);
  refreshFavoriteUi(pinId);
  const { error } = await sb.rpc('set_shared_pin_favorite', { target_pin:pinId, make_favorite:!isFavorite });
  if (error) {
    isFavorite ? state.favorites.add(pinId) : state.favorites.delete(pinId);
    refreshFavoriteUi(pinId);
    return toast('공통 즐겨찾기 기능을 사용하려면 shared-favorites-migration.sql을 실행해 주세요.');
  }
  recordPerformance('toggleFavorite', startedAt, { requests:1, pinId });
  toast(isFavorite ? '공통 즐겨찾기에서 제거했습니다.' : '모든 참가자에게 공통 즐겨찾기로 표시됩니다.');
}
function refreshFavoriteUi(pinId) {
  const isFavorite = state.favorites.has(pinId);
  document.querySelectorAll(`[data-favorite="${pinId}"]`).forEach(button => {
    button.textContent = (button.classList.contains('favorite-popup') || button.classList.contains('popup-favorite-action'))
      ? `${isFavorite ? '★' : '☆'} 즐겨찾기`
      : (isFavorite ? '★' : '☆');
    button.setAttribute('aria-pressed', String(isFavorite));
  });
  $('#favoriteCount').textContent = state.pins.filter(pin => state.favorites.has(pin.id)).length || '';
  if (!$('#favoritesPanel').classList.contains('hidden')) renderPins();
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
  document.body.insertAdjacentHTML('beforeend', `<dialog id="editPinDialog"><form id="editPinForm"><h2>핀 편집</h2><label>장소 이름<input id="editPinTitle" maxlength="80" required /></label><label>메모<textarea id="editPinNote" maxlength="1000"></textarea></label><label>태그 <small>쉼표로 구분, 최대 5개</small><input id="editPinTags" maxlength="100" /></label><label class="schedule-toggle"><input id="editPinScheduleEnabled" type="checkbox" /> 날짜·시간 지정</label><label id="editPinScheduleField" class="hidden">여행 일정 날짜·시간<input id="editPinScheduledAt" type="datetime-local" /></label><label class="schedule-toggle"><input id="editPinIconEnabled" type="checkbox" /> 아이콘 선택</label><div id="editPinIconField" class="pin-icon-field hidden"><p>아이콘을 고르면 지도와 핀 목록에 표시됩니다. 장소 이름은 위 제목을 사용합니다.</p><div id="editPinIconChoices" class="pin-icon-choices"></div><input id="editPinIconChoice" type="hidden" /></div><label>색상<select id="editPinColor"></select></label><div class="dialog-actions"><button type="button" id="editPinDelete" class="danger-button">삭제</button><button type="button" id="editPinCancel" class="secondary">취소</button><button class="primary">저장</button></div></form></dialog>`);
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
  $('#pinDialog').addEventListener('close', () => { state.pendingPinBackground = null; $('#pinBackgroundInput').value = ''; $('#pinScheduleEnabled').checked = false; $('#pinScheduledAt').value = ''; $('#pinScheduledAt').required = false; $('#pinScheduleField').classList.add('hidden'); $('#pinIconEnabled').checked = false; $('#pinIconField').classList.add('hidden'); setPinIconChoice('pinIconChoices', 'pinIconChoice'); });
  $('#editPinDialog').addEventListener('close', () => { state.editingPinBackground = null; $('#editPinBackgroundInput').value = ''; if (editPinHistoryOpen && !closingEditPinFromBack) history.back(); editPinHistoryOpen = false; closingEditPinFromBack = false; });
  $('#editPinCancel').addEventListener('click', () => $('#editPinDialog').close());
  $('#editPinDelete').addEventListener('click', () => { const id = state.editingPinId; $('#editPinDialog').close(); if (id) void deletePin(id); });
  $('#editPinForm').addEventListener('submit', savePinEdit);
}
async function deleteSpace() {
  if (state.active === 'all') return toast('삭제할 여행 공간을 선택하세요.');
  if (currentRole() !== 'owner') return toast('공간 소유자만 삭제할 수 있습니다.');
  const name = state.spaces.find(item => item.space_id === state.active)?.spaces?.name;
  if (!confirm(`'${name}' 공간을 삭제할까요? 30일 동안 보관되며, 그 뒤 핀·채팅·댓글·경로가 완전 삭제됩니다.`)) return;
  if (prompt(`두 번째 확인입니다. 삭제하려면 공간 이름 '${name}'을 그대로 입력하세요. 30일 안에는 복구할 수 있습니다.`) !== name) return toast('공간 이름이 일치하지 않아 삭제하지 않았습니다.');
  const { error } = await sb.rpc('soft_delete_space', { target_space_id:state.active });
  if (error) return toast(error.message);
  state.active = 'all'; await refresh(); toast('여행 공간을 삭제했습니다.');
}
function showDeletedSpaceDialog() {
  const space = activeSpaceRecord()?.spaces;
  if (!space?.deleted_at || deletedNoticeSpaceId === state.active) return;
  deletedNoticeSpaceId = state.active;
  const date = new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'long', day:'numeric' }).format(new Date(space.purge_at));
  $('#deletedSpaceNotice').textContent = `이 여행 공간은 삭제 예정 상태입니다. ${date}에 완전 삭제됩니다. 복구가 필요하면 공간 소유자에게 문의해 주세요.`;
  $('#restoreDeletedSpaceButton').classList.toggle('hidden', currentRole() !== 'owner');
  showDialog('deletedSpaceDialog');
}
async function restoreDeletedSpace() {
  const name = activeSpaceRecord()?.spaces?.name || '이 여행 공간';
  if (currentRole() !== 'owner') return toast('공간 소유자만 복구할 수 있습니다.');
  if (!confirm(`'${name}' 공간을 복구할까요?`)) return;
  const { error } = await sb.rpc('restore_deleted_space', { target_space_id:state.active });
  if (error) return toast(`여행 공간 복구에 실패했습니다: ${error.message}`);
  deletedNoticeSpaceId = null;
  $('#deletedSpaceDialog').close();
  await refresh();
  toast(`'${name}' 공간을 복구했습니다.`);
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
  $('#editPinScheduleEnabled').checked = Boolean(pin.scheduled_at);
  $('#editPinScheduledAt').value = scheduledDateInputValue(pin.scheduled_at);
  $('#editPinScheduleField').classList.toggle('hidden', !pin.scheduled_at);
  $('#editPinIconEnabled').checked = Boolean(pinIconCategories[pin.icon_key]);
  $('#editPinIconField').classList.toggle('hidden', !$('#editPinIconEnabled').checked);
  setPinIconChoice('editPinIconChoices', 'editPinIconChoice', pin.icon_key);
  $('#editPinColor').value = colors[pin.color] ? pin.color : 'coral';
  showDialog('editPinDialog');
  if (!editPinHistoryOpen) { history.pushState({ pinTogetherModal:'edit-pin' }, ''); editPinHistoryOpen = true; }
}
async function savePinEdit(event) {
  event.preventDefault();
  const pin = state.pins.find(item => item.id === state.editingPinId);
  if (!canManagePin(pin)) return toast('핀 작성자 또는 공간 소유자만 편집할 수 있습니다.');
  const title = $('#editPinTitle').value.trim();
  if (!title) return;
  const scheduledAt = $('#editPinScheduleEnabled').checked ? scheduledAtValue($('#editPinScheduledAt')) : null;
  if ($('#editPinScheduleEnabled').checked && !scheduledAt) return toast('여행 일정 날짜와 시간을 지정해 주세요.');
  const iconKey = $('#editPinIconEnabled').checked ? $('#editPinIconChoice').value || null : null;
  if ($('#editPinIconEnabled').checked && !iconKey) return toast('표시할 아이콘을 선택해 주세요.');
  const { error } = await sb.from('pins').update({ title, note:$('#editPinNote').value.trim(), color:$('#editPinColor').value, icon_key:iconKey, scheduled_at:scheduledAt }).eq('id', pin.id);
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
  state.notifications = (data || []).filter(isActivitySinceJoining); const unread = state.notifications.filter(item => !item.read_at).length; $('#notificationCount').textContent = unread || ''; $('#notificationCount').classList.toggle('hidden', !unread);
  if ($('#notificationsDialog').open) renderNotifications();
}
function renderNotifications() {
  const list = $('#notificationsList');
  const titleByKind = { pin:'핀 알림', comment:'댓글', message:'채팅', route:'경로', member:'참가자', invite:'초대', reaction:'반응', favorite:'즐겨찾기', location:'위치 공유', checklist:'체크리스트', poll:'투표', system:'시스템 알림' };
  const destinationText = item => item.kind === 'comment' ? ' · 댓글 보기' : item.kind === 'message' ? ' · 채팅으로 이동' : item.kind === 'route' ? ' · 경로 보기' : item.pin_id ? ' · 핀 위치로 이동' : '';
  const isAnnouncement = isAnnouncementNotification;
  const isDeploymentNotice = item => item.kind === 'system' && /^\[배포:[^\]]+\]\n/.test(item.body);
  const isPinnedAnnouncement = item => isAnnouncement(item) && item.is_active_announcement && state.active !== 'all' && item.space_id === state.active;
  const notificationBody = item => {
    const text = String(item.body || '').replace(/^\[배포:[^\]]+\]\n/, '').replace(/^\[공지\]\n/, '').replace(/^공지:\s*/, '').replace(/^([^:\n]+):\s*/, '$1 : ');
    const actorPrefix = '(^.+?:\\s*)';
    if (item.kind === 'message') return text.replace(new RegExp(`${actorPrefix}채팅:\\s*`), '$1');
    if (item.kind === 'pin') return text.replace(new RegExp(`${actorPrefix}(?:새 핀|핀 (?:추가|수정|삭제)):\\s*`), '$1');
    if (item.kind === 'comment' || item.kind === 'reply') return text.replace(new RegExp(`${actorPrefix}(「[^」]+」에 )?댓글:\\s*`), '$1$2');
    if (item.kind === 'route') return text.replace(new RegExp(`${actorPrefix}(?:새 경로|경로 (?:변경|삭제)):\\s*`), '$1');
    return text;
  };
  const pinnedAnnouncement = state.notifications.find(isPinnedAnnouncement);
  const activePolls = state.polls.filter(poll => poll.space_id === state.active && pollIsActive(poll));
  const activePollMarkup = activePolls.map(poll => `<section class="active-poll" data-open-poll="${poll.id}"><span aria-hidden="true">🗳️</span><div><strong>투표</strong><span>${escapeHtml(poll.title)} · ${pollDeadlineText(poll.closes_at)}</span></div></section>`).join('');
  const regularNotifications = state.notifications.filter(item => !isPinnedAnnouncement(item));
  const itemMarkup = item => `<article class="notification-item notification-target" data-open-notification="${item.id}" tabindex="0" role="button"><div><strong>${escapeHtml(notificationBody(item))}</strong><small>${timeText(item.created_at)}${destinationText(item)}</small></div>${isAnnouncement(item) ? '' : `<button type="button" class="notification-delete" data-delete-notification="${item.id}" aria-label="알림 삭제">삭제</button>`}</article>`;
  list.innerHTML = `${pinnedAnnouncement ? `<section class="active-announcement"><span class="active-announcement-pin" aria-hidden="true">⚑</span><div><strong>공지</strong><span>${escapeHtml(notificationBody(pinnedAnnouncement))}</span></div></section>` : ''}${activePollMarkup}${regularNotifications.map(itemMarkup).join('') || (pinnedAnnouncement || activePolls.length ? '' : '<p class="label">새 알림이 없습니다.</p>')}`;
  list.querySelectorAll('[data-open-poll]').forEach(card => card.addEventListener('click', () => { $('#notificationsDialog').close(); openPollDetail(card.dataset.openPoll); }));
  list.querySelectorAll('[data-open-notification]').forEach(element => {
    const notification = state.notifications.find(item => item.id === element.dataset.openNotification);
    if (!notification) return;
    const title = element.querySelector('strong');
    if (!title) return;
    const body = document.createElement('span');
    body.textContent = notificationBody(notification);
    title.textContent = `핀투게더 · ${isPinnedAnnouncement(notification) ? '공지' : (isDeploymentNotice(notification) ? '업데이트' : (titleByKind[notification.kind] || '알림'))}`;
    title.insertAdjacentElement('afterend', body);
  });
  $('#clearNotificationsButton').classList.toggle('hidden', !state.notifications.length);
  list.querySelectorAll('[data-delete-notification]').forEach(button => button.addEventListener('click', () => deleteNotification(button.dataset.deleteNotification)));
  list.querySelectorAll('[data-open-notification]').forEach(item => {
    item.addEventListener('click', event => { if (!event.target.closest('[data-delete-notification]')) void openNotificationTarget(item.dataset.openNotification); });
    item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openNotificationTarget(item.dataset.openNotification); } });
  });
}
async function loadChecklists() {
  if (!state.user) return;
  const { data, error } = await sb.from('checklists').select('*,checklist_items(*)').order('created_at',{ascending:false});
  if (error) return;
  state.checklists = (data || []).map(list => ({ ...list, checklist_items:(list.checklist_items || []).sort((a,b) => a.position - b.position) }));
  renderChecklists();
}
function renderChecklists() {
  const personal = state.checklists.filter(list => list.scope === 'personal');
  const space = state.active === 'all' ? [] : state.checklists.filter(list => list.scope === 'space' && list.space_id === state.active);
  $('#checklistCount').textContent = space.length || '';
  const markup = list => `<button type="button" class="checklist-card" data-open-checklist="${list.id}"><span>${escapeHtml(list.icon)}</span><div><strong>${escapeHtml(list.title)}</strong><small>${list.checklist_items.filter(item => item.is_checked).length}/${list.checklist_items.length} 완료</small></div></button>`;
  $('#personalChecklistList').innerHTML = personal.map(markup).join('') || '<p class="label">개인 체크리스트가 없습니다.</p>';
  $('#spaceChecklistList').innerHTML = space.map(markup).join('') || '<p class="label">현재 공간의 체크리스트가 없습니다.</p>';
  document.querySelectorAll('[data-open-checklist]').forEach(button => button.addEventListener('click', () => openChecklistDetail(button.dataset.openChecklist)));
}
function checklistDraftValues() { return $('#checklistDraft').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).slice(0,80); }
function renderChecklistDraft() { $('#checklistDraftItems').innerHTML = checklistDraftValues().map((value,index) => `<small>${index + 1}. ${escapeHtml(value)}</small>`).join(''); }
function openChecklistCreate(pinId='') { checklistCreateTargetPinId = pinId; $('#checklistCreateForm').reset(); $('#checklistDraftItems').innerHTML = ''; showDialog('checklistCreateDialog'); }
async function createChecklist(event) {
  event.preventDefault(); const scope = $('#checklistScope').value, items = checklistDraftValues(), title = $('#checklistTitle').value.trim();
  if (!items.length) return toast('체크리스트 항목을 한 개 이상 입력해 주세요.');
  if (scope === 'space' && state.active === 'all') return toast('공간 체크리스트를 만들 여행 공간을 선택해 주세요.');
  const { data:list, error } = await sb.from('checklists').insert({ scope, owner_id:state.user.id, space_id:scope === 'space' ? state.active : null, title, icon:$('#checklistIcon').value }).select().single();
  if (error) return toast(`체크리스트 생성에 실패했습니다: ${error.message}`);
  const { error:itemError } = await sb.from('checklist_items').insert(items.map((label,position) => ({ checklist_id:list.id, label, position })));
  if (itemError) return toast(`목록은 생성됐지만 항목 저장에 실패했습니다: ${itemError.message}`);
  const targetPinId = checklistCreateTargetPinId;
  checklistCreateTargetPinId = '';
  if (targetPinId) {
    const pin = state.pins.find(item => item.id === targetPinId);
    const { data:copy, error:copyError } = await sb.from('checklists').insert({ scope:'pin', owner_id:state.user.id, space_id:pin?.space_id || state.active, pin_id:targetPinId, title, icon:$('#checklistIcon').value }).select().single();
    if (copyError) return toast(`핀 체크리스트 연결에 실패했습니다: ${copyError.message}`);
    const { error:copyItemsError } = await sb.from('checklist_items').insert(items.map((label,position) => ({ checklist_id:copy.id, label, position })));
    if (copyItemsError) return toast(`핀 체크리스트 항목 저장에 실패했습니다: ${copyItemsError.message}`);
  }
  $('#checklistCreateDialog').close(); await loadChecklists(); if (targetPinId) return void openPinChecklist(targetPinId); toast('체크리스트를 생성했습니다.');
}
function openChecklistDetail(id, returnPanel='checklists', returnPinId='') {
  const list = state.checklists.find(item => item.id === id); if (!list) return;
  checklistReturnPanel = returnPanel; checklistReturnPinId = returnPinId; checklistViewMode = 'detail';
  checklistDetailId = id;
  const editable = true;
  const items = checklistDisplayItems(list);
  $('#checklistDetailTitle').textContent = `${list.icon} ${list.title}`; $('#checklistAllToggle').dataset.checklistId = id;
  $('#checklistAllToggle').textContent = list.checklist_items.every(item => item.is_checked) ? '전체 해제' : '전체 체크';
  $('#checklistDeleteButton').classList.toggle('hidden', list.scope !== 'pin');
  $('#checklistItemAdd').classList.toggle('hidden', !editable);
  $('#checklistDetailItems').innerHTML = items.map((item, index) => `<div class="checklist-item ${item.is_checked ? 'checked' : ''}"><button type="button" class="checklist-item-toggle" data-checklist-item="${item.id}" data-checklist-id="${id}"><span>${item.is_checked ? '☑' : '☐'}</span>${escapeHtml(item.label)}</button>${editable ? `<div class="checklist-item-actions"><button type="button" data-edit-checklist-item="${item.id}" title="수정">✎</button><button type="button" data-move-checklist-item="${item.id}" data-direction="-1" ${index === 0 || items[index - 1].is_checked !== item.is_checked ? 'disabled' : ''} title="위로">↑</button><button type="button" data-move-checklist-item="${item.id}" data-direction="1" ${index === items.length - 1 || items[index + 1].is_checked !== item.is_checked ? 'disabled' : ''} title="아래로">↓</button><button type="button" data-delete-checklist-item="${item.id}" title="삭제">×</button></div>` : ''}</div>`).join('');
  $('#checklistDetailItems').querySelectorAll('[data-checklist-item]').forEach(button => button.addEventListener('click', () => void toggleChecklistItem(button.dataset.checklistId, button.dataset.checklistItem)));
  $('#checklistDetailItems').querySelectorAll('[data-edit-checklist-item]').forEach(button => button.addEventListener('click', () => void editChecklistItem(id, button.dataset.editChecklistItem)));
  $('#checklistDetailItems').querySelectorAll('[data-delete-checklist-item]').forEach(button => button.addEventListener('click', () => void deleteChecklistItem(id, button.dataset.deleteChecklistItem)));
  $('#checklistDetailItems').querySelectorAll('[data-move-checklist-item]').forEach(button => button.addEventListener('click', () => void moveChecklistItem(id, button.dataset.moveChecklistItem, Number(button.dataset.direction))));
  showDialog('checklistDetailDialog');
  if (!checklistDetailHistoryOpen) { history.pushState({ pinTogetherModal:'checklist-detail' }, ''); checklistDetailHistoryOpen = true; }
}
function reopenChecklistDetail(id) { openChecklistDetail(id, checklistReturnPanel, checklistReturnPinId); }
function checklistDisplayItems(list) {
  return [...(list?.checklist_items || [])].sort((a, b) => Number(a.is_checked) - Number(b.is_checked) || a.position - b.position);
}
async function toggleChecklistItem(checklistId,itemId) { const list = state.checklists.find(item => item.id === checklistId), item = list?.checklist_items.find(entry => entry.id === itemId); if (!item) return; const { error } = await sb.from('checklist_items').update({ is_checked:!item.is_checked, updated_at:new Date().toISOString() }).eq('id',itemId); if (error) return toast(error.message); await loadChecklists(); reopenChecklistDetail(checklistId); }
async function toggleAllChecklist(checklistId) { const list = state.checklists.find(item => item.id === checklistId); if (!list) return; const next = !list.checklist_items.every(item => item.is_checked); const { error } = await sb.from('checklist_items').update({ is_checked:next, updated_at:new Date().toISOString() }).eq('checklist_id',checklistId); if (error) return toast(error.message); await loadChecklists(); reopenChecklistDetail(checklistId); }
async function addChecklistItem() { const list = state.checklists.find(item => item.id === checklistDetailId), label = $('#checklistNewItem').value.trim(); if (!list || !label) return; const { error } = await sb.from('checklist_items').insert({ checklist_id:list.id, label, position:list.checklist_items.length }); if (error) return toast(error.message); $('#checklistNewItem').value = ''; await loadChecklists(); reopenChecklistDetail(list.id); }
async function editChecklistItem(checklistId, itemId) { const item = state.checklists.find(list => list.id === checklistId)?.checklist_items.find(entry => entry.id === itemId), label = prompt('항목 문구를 수정하세요.', item?.label || ''); if (!item || label === null || !label.trim()) return; const { error } = await sb.from('checklist_items').update({ label:label.trim(), updated_at:new Date().toISOString() }).eq('id', itemId); if (error) return toast(error.message); await loadChecklists(); reopenChecklistDetail(checklistId); }
async function deleteChecklistItem(checklistId, itemId) { if (!confirm('이 항목을 삭제할까요?')) return; const { error } = await sb.from('checklist_items').delete().eq('id', itemId); if (error) return toast(error.message); await loadChecklists(); reopenChecklistDetail(checklistId); }
async function moveChecklistItem(checklistId, itemId, direction) { const list = state.checklists.find(item => item.id === checklistId), items = checklistDisplayItems(list), index = items.findIndex(item => item.id === itemId), target = items[index + direction]; if (!list || index < 0 || !target || target.is_checked !== items[index].is_checked) return; const item = items[index]; const { error } = await sb.from('checklist_items').upsert([{ id:item.id, checklist_id:checklistId, label:item.label, position:target.position, is_checked:item.is_checked }, { id:target.id, checklist_id:checklistId, label:target.label, position:item.position, is_checked:target.is_checked }]); if (error) return toast(error.message); await loadChecklists(); reopenChecklistDetail(checklistId); }
async function deleteChecklist() { const list = state.checklists.find(item => item.id === checklistDetailId); if (!list || list.scope !== 'pin' || !confirm('이 핀에 복사한 체크리스트만 삭제합니다. 계속할까요?')) return; const { error } = await sb.from('checklists').delete().eq('id', list.id); if (error) return toast(error.message); await loadChecklists(); $('#checklistDetailDialog').close(); }
function renderPinChecklistPicker() { $('#pinChecklistPickerList').innerHTML = state.checklists.filter(list => list.scope !== 'pin').map(list => `<button type="button" class="checklist-card ${pinChecklistSourceIds.includes(list.id) ? 'selected' : ''}" data-pick-checklist="${list.id}"><span>${list.icon}</span><div><strong>${escapeHtml(list.title)}</strong><small>${list.scope === 'personal' ? '개인' : '공간'} · ${list.checklist_items.length}개 항목</small></div></button>`).join('') || '<p class="label">가져올 체크리스트가 없습니다. 아래에서 새로 만들 수 있습니다.</p>'; document.querySelectorAll('[data-pick-checklist]').forEach(button => button.addEventListener('click', () => { const id = button.dataset.pickChecklist; pinChecklistSourceIds = pinChecklistSourceIds.includes(id) ? pinChecklistSourceIds.filter(value => value !== id) : [...pinChecklistSourceIds, id]; renderPinChecklistPicker(); })); }
async function cloneChecklistToPin(templateId, pinId) { const source = state.checklists.find(list => list.id === templateId); if (!source) return; const { data:copy, error } = await sb.from('checklists').insert({ scope:'pin', owner_id:state.user.id, space_id:state.active, pin_id:pinId, title:source.title, icon:source.icon }).select().single(); if (error) return toast(`체크리스트 복사에 실패했습니다: ${error.message}`); if (source.checklist_items.length) await sb.from('checklist_items').insert(source.checklist_items.map((item,position) => ({ checklist_id:copy.id, label:item.label, position, is_checked:false }))); }
async function deletePinChecklistFromManager(listId, pinId) { const list = state.checklists.find(item => item.id === listId); if (!list || list.scope !== 'pin' || !confirm('이 핀에 연결한 체크리스트를 삭제할까요?')) return; const { error } = await sb.from('checklists').delete().eq('id', listId); if (error) return toast(error.message); await loadChecklists(); openPinChecklistList(pinId); }
async function importChecklistsToPin(pinId) { if (!pinChecklistSourceIds.length) return toast('아래에서 가져올 체크리스트를 선택해 주세요.'); for (const sourceId of pinChecklistSourceIds) await cloneChecklistToPin(sourceId, pinId); pinChecklistSourceIds = []; await loadChecklists(); openPinChecklistList(pinId); }
function openPinChecklistList(pinId) { const pin = state.pins.find(item => item.id === pinId), lists = state.checklists.filter(item => item.scope === 'pin' && item.pin_id === pinId), templates = state.checklists.filter(item => item.scope !== 'pin'), spaceName = state.spaces.find(item => item.space_id === pin?.space_id)?.spaces?.name || '현재 공간'; checklistReturnPanel = 'pins'; checklistReturnPinId = pinId; checklistViewMode = 'pin-list'; $('#checklistDetailTitle').textContent = `${spaceName} 체크리스트`; $('#checklistAllToggle').classList.add('hidden'); $('#checklistDeleteButton').classList.add('hidden'); $('#checklistItemAdd').classList.add('hidden'); $('#checklistDetailItems').innerHTML = `<section class="pin-checklist-section"><div class="pin-checklist-section-title"><div><strong>이 핀에 연결된 체크리스트</strong><small>선택하면 항목을 확인하고 편집할 수 있습니다.</small></div><button type="button" class="secondary" data-new-pin-checklist>새 체크리스트</button></div><div class="pin-checklist-linked-list">${lists.map(list => `<div class="pin-checklist-linked"><button type="button" data-open-pin-checklist="${list.id}"><span>${escapeHtml(list.icon)}</span><div><strong>${escapeHtml(list.title)}</strong><small>${list.checklist_items.filter(item => item.is_checked).length}/${list.checklist_items.length} 완료</small></div></button><button type="button" class="danger-button" data-delete-pin-checklist="${list.id}" title="연결된 체크리스트 삭제">×</button></div>`).join('') || '<p class="label">아직 이 핀에 연결된 체크리스트가 없습니다.</p>'}</div></section><section class="pin-checklist-section pin-checklist-import"><div class="pin-checklist-section-title"><div><strong>가져올 개인·공간 체크리스트</strong><small>선택한 목록은 원본을 유지한 채 이 핀에 복사됩니다.</small></div><button type="button" class="primary" data-import-pin-checklists>가져오기</button></div><div class="pin-checklist-template-list">${templates.map(list => `<button type="button" class="checklist-card ${pinChecklistSourceIds.includes(list.id) ? 'selected' : ''}" data-pick-pin-checklist="${list.id}"><span>${escapeHtml(list.icon)}</span><div><strong>${escapeHtml(list.title)}</strong><small>${list.scope === 'personal' ? '개인' : '공간'} · ${list.checklist_items.length}개 항목</small></div></button>`).join('') || '<p class="label">가져올 개인·공간 체크리스트가 없습니다. 새로 만들어 보세요.</p>'}</div></section>`; $('#checklistDetailItems').querySelectorAll('[data-open-pin-checklist]').forEach(button => button.addEventListener('click', () => openChecklistDetail(button.dataset.openPinChecklist, 'pin-checklists', pinId))); $('#checklistDetailItems').querySelectorAll('[data-delete-pin-checklist]').forEach(button => button.addEventListener('click', () => void deletePinChecklistFromManager(button.dataset.deletePinChecklist, pinId))); $('#checklistDetailItems').querySelector('[data-new-pin-checklist]')?.addEventListener('click', () => { $('#checklistDetailDialog').close(); openChecklistCreate(pinId); }); $('#checklistDetailItems').querySelector('[data-import-pin-checklists]')?.addEventListener('click', () => void importChecklistsToPin(pinId)); $('#checklistDetailItems').querySelectorAll('[data-pick-pin-checklist]').forEach(button => button.addEventListener('click', () => { const id = button.dataset.pickPinChecklist; pinChecklistSourceIds = pinChecklistSourceIds.includes(id) ? pinChecklistSourceIds.filter(value => value !== id) : [...pinChecklistSourceIds, id]; openPinChecklistList(pinId); })); showDialog('checklistDetailDialog'); if (!checklistDetailHistoryOpen) { history.pushState({ pinTogetherModal:'checklist-detail' }, ''); checklistDetailHistoryOpen = true; } }
async function openPinChecklist(pinId) { await loadChecklists(); pinChecklistSourceIds = []; openPinChecklistList(pinId); }
async function activatePanel(panel) {
  document.querySelectorAll('[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === panel));
  ['pins','favorites','routes','photos','polls','checklists','members'].forEach(name => $(`#${name}Panel`).classList.toggle('hidden', name !== panel));
  if (matchMedia('(max-width:760px)').matches && !$('.app aside').classList.contains('open')) toggleMobilePanel();
  if (panel === 'routes') renderRoutes();
  if (panel === 'photos') { await loadSpacePhotos(); renderPhotoGallery(); }
  if (panel === 'polls') await loadPolls();
  if (panel === 'checklists') await loadChecklists();
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
  if (isAnnouncementNotification(state.notifications.find(item => item.id === notificationId))) return toast('공지는 삭제할 수 없습니다.');
  const { error } = await sb.from('notifications').delete().eq('id', notificationId).eq('user_id', state.user.id);
  if (error) return toast(`알림 삭제에 실패했습니다: ${error.message}`);
  state.notifications = state.notifications.filter(item => item.id !== notificationId); renderNotifications(); await loadNotifications();
}
async function clearNotifications() {
  if (!state.notifications.length) return;
  $('#clearSystemNotifications').checked = false;
  $('#clearGeneralNotifications').checked = false;
  showDialog('clearNotificationsDialog');
}
async function submitClearNotifications(event) {
  event.preventDefault();
  const clearSystem = $('#clearSystemNotifications').checked;
  const clearGeneral = $('#clearGeneralNotifications').checked;
  if (!clearSystem && !clearGeneral) return toast('삭제할 알림 종류를 선택해 주세요.');
  if (!confirm('선택한 알림을 삭제할까요? 공지는 유지됩니다.')) return;
  // Deletion must cover the whole account history, not just the 30 rows currently
  // rendered in the notification panel. Older system notifications otherwise
  // appear to survive once newer rows disappear.
  const { data: allNotifications, error: readError } = await sb.from('notifications')
    .select('id,kind,body')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending:false })
    .limit(1000);
  if (readError) return toast(`삭제할 알림을 확인하지 못했습니다: ${readError.message}`);
  const targetIds = (allNotifications || [])
    .filter(item => !isAnnouncementNotification(item))
    .filter(item => (item.kind === 'system' && clearSystem) || (item.kind !== 'system' && clearGeneral))
    .map(item => item.id);
  if (!targetIds.length) return toast('선택한 종류의 삭제할 알림이 없습니다.');
  const { error } = await sb.from('notifications').delete().eq('user_id', state.user.id).in('id', targetIds);
  if (error) return toast(`알림 전체 삭제에 실패했습니다: ${error.message}`);
  state.notifications = state.notifications.filter(item => !targetIds.includes(item.id));
  $('#clearNotificationsDialog').close();
  renderNotifications(); await loadNotifications();
}
async function openNotifications() {
  $('#announcementButton').classList.remove('hidden');
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
function subscribe() { state.channel?.unsubscribe(); state.channel = sb.channel(`space-${state.active}`).on('postgres_changes', { event:'*', schema:'public', table:'pins' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'pin_comments' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'pin_reactions' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'shared_favorite_pins' }, () => void loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'messages', filter: state.active === 'all' ? undefined : `space_id=eq.${state.active}` }, () => { void loadMessages(); void loadUnreadCount(); }).on('postgres_changes', { event:'*', schema:'public', table:'message_reads' }, () => { void loadMessages(); void loadUnreadCount(); }).on('postgres_changes', { event:'*', schema:'public', table:'space_routes', filter: state.active === 'all' ? undefined : `space_id=eq.${state.active}` }, () => { void loadPins(); }).on('postgres_changes', { event:'*', schema:'public', table:'route_stops' }, () => { void loadPins(); }).on('postgres_changes', { event:'*', schema:'public', table:'polls', filter: state.active === 'all' ? undefined : `space_id=eq.${state.active}` }, () => void loadPolls()).on('postgres_changes', { event:'*', schema:'public', table:'poll_options' }, () => void loadPolls()).on('postgres_changes', { event:'*', schema:'public', table:'poll_votes' }, () => void loadPolls()).on('postgres_changes', { event:'*', schema:'public', table:'poll_pin_links' }, () => void loadPolls()).on('postgres_changes', { event:'*', schema:'public', table:'checklists' }, () => void loadChecklists()).on('postgres_changes', { event:'*', schema:'public', table:'checklist_items' }, () => void loadChecklists()).on('postgres_changes', { event:'*', schema:'public', table:'notifications', filter:`user_id=eq.${state.user.id}` }, event => { if (event.eventType === 'INSERT' && event.new?.body) toast(event.new.body); void loadNotifications(); }).subscribe(); }
function startSafetySync() { clearInterval(safetySyncTimer); safetySyncTimer = setInterval(() => { if (document.hidden || !state.user) return; void loadPins().catch(() => {}); void loadNotifications().catch(() => {}); void loadPolls().catch(() => {}); if (state.active !== 'all') { void loadMessages().catch(() => {}); void loadUnreadCount().catch(() => {}); } }, 30000); }
async function refresh() {
  await loadSpaces();
  if (isDeletedActiveSpace()) {
    state.channel?.unsubscribe(); state.channel = null;
    state.pins = []; state.pinById = new Map(); state.routes = []; state.members = [];
    state.markers?.clearLayers(); lineLayer?.clearLayers(); renderPins(); renderMembers();
    $('#deleteSpaceButton').classList.add('hidden'); $('#leaveTravelSpaceButton').classList.add('hidden');
    $('#chatButton').disabled = true; $('#inviteButton').disabled = true; $('#addPinButton').disabled = true; $('#routeButton').disabled = true; $('#locationShareButton').disabled = true;
    showDeletedSpaceDialog();
    return;
  }
  deletedNoticeSpaceId = null;
  $('#chatButton').disabled = false; $('#inviteButton').disabled = false; $('#addPinButton').disabled = false; $('#routeButton').disabled = false; $('#locationShareButton').disabled = false;
  await loadPins(); await loadMessages(); await loadUnreadCount(); await loadNotifications(); await loadMembers(); await loadPolls(); await loadChecklists(); await loadSpacePhotos(); renderPhotoGallery(); connectLocationPresence(); subscribe(); startSafetySync(); $('#spaceSelect').value = state.active; $('#deleteSpaceButton').classList.toggle('hidden', state.active === 'all' || currentRole() !== 'owner'); updateLeaveTravelSpaceButton();
}
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
  if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) void enablePushSubscription().catch(() => {});
  const notificationId = new URLSearchParams(location.search).get('notification');
  if (notificationId) {
    const url = new URL(location.href); url.searchParams.delete('notification'); history.replaceState({}, '', url);
    await openNotificationTarget(notificationId);
  }
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
  if (!$('[data-panel="checklists"]')) {
    $('[data-panel="members"]').insertAdjacentHTML('beforebegin', '<button data-panel="checklists">체크리스트 <span id="checklistCount">0</span></button>');
    $('#membersPanel').insertAdjacentHTML('beforebegin', '<section id="checklistsPanel" class="panel hidden"><button id="newChecklistButton" class="primary wide">＋ 체크리스트 생성</button><section class="checklist-section"><p class="label">개인 체크리스트</p><div id="personalChecklistList"></div></section><section class="checklist-section"><p class="label">공간 체크리스트</p><div id="spaceChecklistList"></div></section></section>');
    document.body.insertAdjacentHTML('beforeend', '<dialog id="checklistCreateDialog"><form id="checklistCreateForm"><h2>체크리스트 생성</h2><label>구분<select id="checklistScope"><option value="personal">개인 체크리스트</option><option value="space">공간 체크리스트</option></select></label><label>아이콘<select id="checklistIcon"><option value="✅">✅ 준비</option><option value="🧳">🧳 짐</option><option value="🛂">🛂 서류</option><option value="🏨">🏨 숙소</option><option value="✦">✦ 기타</option></select></label><label>제목<input id="checklistTitle" maxlength="80" required /></label><label>항목 <small>한 줄에 하나씩 붙여넣기 또는 Enter</small><textarea id="checklistDraft" maxlength="3000" placeholder="여권&#10;항공권&#10;유심"></textarea></label><div id="checklistDraftItems" class="checklist-draft-items"></div><div class="dialog-actions"><button type="button" data-close="checklistCreateDialog" class="secondary">취소</button><button class="primary">저장</button></div></form></dialog><dialog id="checklistDetailDialog"><section class="poll-detail-dialog"><div class="notification-dialog-header"><h2 id="checklistDetailTitle">체크리스트</h2><div class="checklist-detail-dialog-actions"><button id="checklistDeleteButton" type="button" class="notification-header-button hidden">삭제</button><button id="checklistAllToggle" type="button" class="notification-header-button">전체 체크</button><button type="button" data-close="checklistDetailDialog" class="notification-header-button">닫기</button></div></div><div id="checklistItemAdd" class="checklist-item-add"><input id="checklistNewItem" maxlength="200" placeholder="새 항목" /><button id="checklistItemAddButton" type="button" class="secondary">추가</button></div><div id="checklistDetailItems" class="checklist-detail-items"></div></section></dialog>');
    $('#notificationSettingsForm [name="system"]').closest('label')?.insertAdjacentHTML('beforebegin', '<label><input type="checkbox" name="checklist" /> 체크리스트</label>');
  }
  if (!$('#notificationSettingsForm [name="poll"]')) {
    ($('#notificationSettingsForm [name="checklist"]') || $('#notificationSettingsForm [name="system"]')).closest('label')?.insertAdjacentHTML('afterend', '<label><input type="checkbox" name="poll" /> 투표</label>');
  }
  if (!$('#pinChecklistButton')) {
    $('#pinForm .dialog-actions').insertAdjacentHTML('beforebegin', '<button type="button" id="pinChecklistButton" class="secondary wide">체크리스트 가져오기</button>');
    document.body.insertAdjacentHTML('beforeend', '<dialog id="pinChecklistPickerDialog"><section class="poll-detail-dialog"><div class="notification-dialog-header"><h2>체크리스트 가져오기</h2><button type="button" data-close="pinChecklistPickerDialog" class="notification-header-button">닫기</button></div><div id="pinChecklistPickerList"></div><div class="dialog-actions"><button type="button" id="pinChecklistNewButton" class="secondary">새 체크리스트 생성</button><button type="button" id="confirmPinChecklistButton" class="primary">선택 완료</button></div></section></dialog>');
    $('#pinChecklistButton').addEventListener('click', async () => { await loadChecklists(); renderPinChecklistPicker(); showDialog('pinChecklistPickerDialog'); });
    $('#pinChecklistNewButton').addEventListener('click', () => { $('#pinChecklistPickerDialog').close(); openChecklistCreate(); });
    $('#confirmPinChecklistButton').addEventListener('click', () => { $('#pinChecklistPickerDialog').close(); $('#pinChecklistButton').textContent = pinChecklistSourceIds.length ? `체크리스트 ${pinChecklistSourceIds.length}개 선택` : '체크리스트 가져오기'; });
    $('#pinChecklistPickerDialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
    // Reuse this picker both while creating a pin and while attaching a list to an existing pin.
    $('#pinChecklistButton').addEventListener('click', () => { pinChecklistTargetId = ''; });
    $('#pinChecklistNewButton').addEventListener('click', () => { if (pinChecklistTargetId) openChecklistCreate(pinChecklistTargetId); });
    $('#confirmPinChecklistButton').addEventListener('click', async () => {
      const targetPinId = pinChecklistTargetId;
      if (!targetPinId) return;
      if (!pinChecklistSourceIds.length) return toast('가져올 체크리스트를 하나 이상 선택하거나 새로 만들어 주세요.');
      for (const sourceId of pinChecklistSourceIds) await cloneChecklistToPin(sourceId, targetPinId);
      pinChecklistSourceIds = []; pinChecklistTargetId = '';
      await openPinChecklist(targetPinId);
    });
    $('#pinChecklistPickerDialog [data-close]').addEventListener('click', () => $('#pinChecklistPickerDialog').close());
  }
  const bindScheduleToggle = (checkboxId, fieldId, inputId) => {
    const checkbox = $(`#${checkboxId}`), field = $(`#${fieldId}`), input = $(`#${inputId}`);
    checkbox?.addEventListener('change', () => {
      field.classList.toggle('hidden', !checkbox.checked);
      input.required = checkbox.checked;
      if (checkbox.checked) input.focus({ preventScroll:true });
    });
  };
  bindScheduleToggle('pinScheduleEnabled', 'pinScheduleField', 'pinScheduledAt');
  bindPinIconPicker('pinIconEnabled', 'pinIconField', 'pinIconChoices', 'pinIconChoice');
  setInterval(refreshScheduledCountdowns, 30000);
  setupPinColorOptions();
  ensureManagementDialogs();
  bindScheduleToggle('editPinScheduleEnabled', 'editPinScheduleField', 'editPinScheduledAt');
  bindPinIconPicker('editPinIconEnabled', 'editPinIconField', 'editPinIconChoices', 'editPinIconChoice');
  history.pushState({ pinTogetherExitGuard:true }, '');
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (button.dataset.close === 'commentsDialog') closeCommentsDialog(); else $(`#${button.dataset.close}`).close(); }));
  $('#commentsDialog').addEventListener('click', event => { if (event.target === event.currentTarget) closeCommentsDialog(); });
  $('#notificationsDialog').addEventListener('click', event => { if (event.target === event.currentTarget) $('#notificationsDialog').close(); });
  $('#notificationSettingsDialog').addEventListener('click', event => { if (event.target === event.currentTarget) $('#notificationSettingsDialog').close(); });
  $('#notificationsDialog').addEventListener('close', () => {
    if (notificationHistoryOpen && !closingNotificationFromBack) {
      // Closing the dialog is not navigation. Keep the exit-guard entry in place
      // instead of calling history.back(), which can be interpreted as leaving on desktop browsers.
      notificationHistoryOpen = false;
      history.replaceState({ pinTogetherExitGuard:true }, '');
    }
    closingNotificationFromBack = false;
  });
  window.addEventListener('popstate', event => {
    if (exitConfirmed) return;
    if ($('#photoViewerDialog').open) { closingPhotoViewerFromBack = true; $('#photoViewerDialog').close(); photoViewerHistoryOpen = false; return; }
    if ($('#checklistDetailDialog')?.open) { closingChecklistDetailFromBack = true; $('#checklistDetailDialog').close(); checklistDetailHistoryOpen = false; return; }
    if ($('#editPinDialog')?.open) { closingEditPinFromBack = true; $('#editPinDialog').close(); editPinHistoryOpen = false; return; }
    if (mobilePanelHistoryOpen) { closeMobilePanel(true); return; }
    if ($('#notificationsDialog').open) { closingNotificationFromBack = true; $('#notificationsDialog').close(); notificationHistoryOpen = false; return; }
    if (event.state?.pinTogetherExitGuard) return;
    if (confirm('페이지를 나가시겠어요?')) { exitConfirmed = true; history.back(); }
    else history.forward();
  });
  window.addEventListener('beforeunload', event => { if (!exitConfirmed) { event.preventDefault(); event.returnValue = ''; } });
  $('#sessionNicknameDialog').addEventListener('cancel', event => event.preventDefault());
  $('#newPollButton').addEventListener('click', openPollCreateDialog);
  $('#newChecklistButton').addEventListener('click', openChecklistCreate);
  $('#checklistCreateForm').addEventListener('submit', createChecklist);
  $('#checklistDraft').addEventListener('input', renderChecklistDraft);
  $('#checklistAllToggle').addEventListener('click', () => void toggleAllChecklist($('#checklistAllToggle').dataset.checklistId));
  $('#checklistItemAddButton').addEventListener('click', () => void addChecklistItem());
  $('#checklistNewItem').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void addChecklistItem(); } });
  $('#checklistDeleteButton').addEventListener('click', () => void deleteChecklist());
  ['checklistCreateDialog','checklistDetailDialog'].forEach(id => $(`#${id}`).addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); }));
  $('#checklistDetailDialog').addEventListener('close', () => {
    if (checklistDetailHistoryOpen && !closingChecklistDetailFromBack) history.replaceState({ pinTogetherExitGuard:true }, '');
    const returnToPinChecklistList = checklistViewMode === 'detail' && checklistReturnPanel === 'pin-checklists' && checklistReturnPinId;
    checklistDetailHistoryOpen = false;
    closingChecklistDetailFromBack = false;
    if (returnToPinChecklistList) openPinChecklistList(checklistReturnPinId);
    else if (checklistReturnPanel === 'checklists') void activatePanel('checklists');
  });
  document.querySelectorAll('#checklistCreateDialog [data-close],#checklistDetailDialog [data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
  $('#pollCreateForm').addEventListener('submit', createPoll);
  $('#pollOptionDraft').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); const value = event.currentTarget.value.trim(); if (!value) return; pollOptionDrafts.push(value); event.currentTarget.value = ''; renderPollOptionInputs(); } });
  $('#pollOptionDraft').addEventListener('blur', event => { const value = event.currentTarget.value.trim(); if (!value) return; pollOptionDrafts.push(value); event.currentTarget.value = ''; renderPollOptionInputs(); });
  $('#pollDetailAddButton').addEventListener('click', () => void addPollOption($('#pollDetailAddButton').dataset.pollId));
  $('#pollDetailOptionDraft').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void addPollOption($('#pollDetailAddButton').dataset.pollId); } });
  $('#pollLinkButton').addEventListener('click', () => openPollPinPicker('create'));
  $('#pollPinSearch').addEventListener('input', renderPollPinPicker);
  $('#deletePollButton').addEventListener('click', () => void deletePoll($('#deletePollButton').dataset.pollId));
  $('#pollDetailDialog').addEventListener('close', () => { if ($('#pollVotersDialog').open) $('#pollVotersDialog').close(); });
  $('#confirmPollPinButton').addEventListener('click', () => { if (!selectedPollPinId) return toast('연결할 핀을 선택해 주세요.'); $('#pollPinPickerDialog').close(); if (pollPinPickerTarget === 'create') renderPollCreateLinkedPin(); });
  $('#createPinLinkedPollButton').addEventListener('click', () => { $('#pinPollDialog').close(); openPollCreateDialog(pinPollDialogPinId); });
  ['pollCreateDialog', 'pollDetailDialog', 'pollVotersDialog', 'pollPinPickerDialog', 'pinPollDialog'].forEach(id => $(`#${id}`).addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); }));
  $('#profileDialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-auth]').forEach(item => item.classList.toggle('active', item === button)); const signup = button.dataset.auth === 'signup'; $('#nicknameField').classList.toggle('hidden', !signup); $('#nickname').required = signup; $('#authSubmit').textContent = signup ? '회원가입' : '로그인'; $('#authHelp').textContent = signup ? '회원가입에는 실제 이메일 주소를 입력해 주세요.' : '가입한 이메일로 로그인하세요.'; }));
  $('#authForm').addEventListener('submit', async event => { event.preventDefault(); const signup = $('[data-auth].active').dataset.auth === 'signup'; const loginId = $('#email').value.trim(); const masterEmail = Object.entries(masterAccounts).find(([name]) => name.toLowerCase() === loginId.toLowerCase())?.[1] || null; if (signup && masterEmail) return toast('마스터 계정은 회원가입할 수 없습니다.'); if (signup && !loginId.includes('@')) return toast('회원가입에는 이메일 주소를 입력해 주세요.'); const email = masterEmail || loginId, password = $('#password').value; if (signup && password.length < 8) return toast('회원가입 비밀번호는 8자 이상이어야 합니다.'); const result = signup ? await sb.auth.signUp({ email, password, options:{ data:{ nickname:$('#nickname').value.trim() }, emailRedirectTo:`${location.origin}${location.pathname}` } }) : await sb.auth.signInWithPassword({ email, password }); if (result.error) return toast(result.error.message); if (signup && !result.data.session) return toast('가입 확인 메일을 보냈습니다. 이메일 인증 후 로그인하세요.'); });
  $('#spaceSelect').addEventListener('change', async event => { if (locationWatchId !== null) stopLocationShare(true); state.active = event.target.value; state.selected = []; state.route = []; state.draftRoute = []; state.activeRouteId = null; updateMeasure(); await rememberActiveSpace(); await refresh(); });
  $('#newSpaceButton').addEventListener('click', () => showDialog('spaceDialog')); $('#joinSpaceButton').addEventListener('click', () => showDialog('joinDialog')); $('#inviteButton').addEventListener('click', makeInvite); $('#deleteSpaceButton').addEventListener('click', deleteSpace); $('#leaveTravelSpaceButton').addEventListener('click', () => void leaveCurrentSpace()); $('#restoreDeletedSpaceButton').addEventListener('click', () => void restoreDeletedSpace()); $('#chatButton').addEventListener('click', () => void openChat()); $('#closeChatButton').addEventListener('click', () => $('#chatDialog').close()); $('#chatDialog').addEventListener('click', event => { if (event.target === event.currentTarget) $('#chatDialog').close(); }); $('#notificationButton').addEventListener('click', openNotifications); $('#mobilePanelButton').addEventListener('click', toggleMobilePanel); $('#spaceForm').addEventListener('submit', createSpace); $('#pinForm').addEventListener('submit', createPin); $('#messageForm').addEventListener('submit', sendMessage); $('#messageInput').addEventListener('focus', () => setTimeout(() => scrollChatToBottom(true), 180)); $('#commentForm').addEventListener('submit', addComment); $('#commentPhotoInput').addEventListener('change', event => { state.pendingCommentPhotos.forEach(photo => URL.revokeObjectURL(photo.url)); const files = [...event.target.files]; state.pendingCommentPhotos = files.slice(0,5).map(file => ({ file, tags:'', url:URL.createObjectURL(file) })); if (files.length > 5) toast('사진은 최대 5장까지 선택할 수 있습니다.'); renderCommentPhotoPreview(); }); $('#photoSearch').addEventListener('input', renderPhotoGallery); $('#photoViewerDialog').addEventListener('close', () => { $('#photoViewerImage').removeAttribute('src'); $('#photoViewerStatus').textContent = ''; if (photoViewerHistoryOpen && !closingPhotoViewerFromBack) { photoViewerHistoryOpen = false; history.back(); } closingPhotoViewerFromBack = false; }); bindPhotoViewer(); $('#profileButton').addEventListener('click', () => { $('#profileNickname').value = state.profile.nickname; $('#profilePassword').value = ''; $('#profilePasswordConfirm').value = ''; $('#quietActivityToggle').checked = Boolean(loadNotificationPreferences().quiet_mode); $('#releaseNotificationButton').classList.toggle('hidden', !isMasterUser()); showDialog('profileDialog'); requestAnimationFrame(() => $('#profileDialog').focus({ preventScroll:true })); }); $('#profileForm').addEventListener('submit', saveProfile); $('#quietActivityToggle').addEventListener('change', () => void saveQuietActivity()); $('#releaseNotificationButton').addEventListener('click', () => showDialog('releaseNotificationDialog')); $('#releaseNotificationForm').addEventListener('submit', sendReleaseNotification); $('#ownerLeaveForm').addEventListener('submit', transferOwnershipAndLeave); $('#notificationSettingsButton').addEventListener('click', openNotificationSettings); $('#notificationSettingsForm').addEventListener('submit', saveNotificationSettings); $('#notificationPermissionButton').addEventListener('click', () => void requestNotificationPermission()); $('#forgotPasswordButton').addEventListener('click', () => { $('#forgotPasswordEmail').value = $('#email').value.trim(); showDialog('forgotPasswordDialog'); }); $('#forgotPasswordForm').addEventListener('submit', requestPasswordReset); $('#newPasswordForm').addEventListener('submit', setRecoveredPassword);
  $('#joinForm').addEventListener('submit', joinSpace); $('#sessionNicknameForm').addEventListener('submit', saveSessionNickname); $('#profileSignOutButton').addEventListener('click', () => void signOut()); $('#clearNotificationsButton').addEventListener('click', clearNotifications); $('#clearNotificationsForm').addEventListener('submit', submitClearNotifications); $('#announcementButton').addEventListener('click', openAnnouncementDialog); $('#announcementForm').addEventListener('submit', sendAnnouncement); $('#announcementDialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); }); $('#announcementDialog').addEventListener('close', () => { if (!announcementReturnToNotifications) return; announcementReturnToNotifications = false; requestAnimationFrame(() => void openNotifications()); });
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
  }); $('#closeMeasure').addEventListener('click', () => $('#measureCard').classList.add('hidden')); $('#pinSearch').addEventListener('input', () => { clearTimeout(pinSearchTimer); pinSearchTimer = setTimeout(() => { const startedAt = performance.now(); renderPins(); recordPerformance('pinSearch', startedAt, { debounceMs:180 }); }, 180); }); $('#tagFilter').addEventListener('change', renderPins); $('#placeSearchForm').addEventListener('submit', searchPlace);
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
else {
  sb = createClient(PROJECT_URL, SUPABASE_PUBLISHABLE_KEY);
  // Always reveal a usable first screen before optional UI enhancements run.
  // Otherwise one failed listener can leave every view hidden as a white page.
  show('authView');
  try { bindUi(); }
  catch (error) {
    console.error('UI initialization failed.', error);
    toast('화면을 준비하는 중 문제가 생겼습니다. 새로고침해 주세요.');
  }
  sb.auth.onAuthStateChange(async (event, session) => { state.user = session?.user || null; if (!state.user) nicknamePromptedForSession = false; if (event === 'PASSWORD_RECOVERY' && state.user) { show('authView'); showDialog('newPasswordDialog'); return; } if (state.user) { try { await startApp(); } catch (error) { toast(error.message); } } else show('authView'); });
}
