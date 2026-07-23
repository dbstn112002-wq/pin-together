import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const configured = !SUPABASE_URL.startsWith('YOUR_') && !SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_');
// Data API URL을 실수로 넣어도 Supabase 프로젝트 루트 URL로 정규화합니다.
const PROJECT_URL = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '');
const colors = { coral:'#ed7668', blue:'#5d8ddd', amber:'#dea23f', green:'#4da887', purple:'#8b72d5' };
const $ = selector => document.querySelector(selector);
const state = { user:null, profile:null, spaces:[], active:'', pins:[], favorites:new Set(), selected:[], route:[], routeMode:false, markers:null, channel:null, pending:null, commentPin:null, notifications:[] };
let sb, map, lineLayer;

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function show(view) { ['setupView','authView','appView'].forEach(id => $(`#${id}`).classList.toggle('hidden', id !== view)); }
function showDialog(id) { $(`#${id}`).showModal(); }
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
function initials(name='나') { return name.trim().slice(0,1); }
function spaceName() { return state.active === 'all' ? '전체 지도' : state.spaces.find(s => s.space_id === state.active)?.spaces?.name || '지도'; }
function pinIcon(pin) {
  const routeIndex = state.route.findIndex(item => item.id === pin.id);
  return L.divIcon({ className:'', iconSize:[40,34], iconAnchor:[13,25], html:`<div class="pin-marker" style="background:${colors[pin.color] || colors.coral}"><span>${initials(pin.profiles?.nickname || '나')}</span>${routeIndex >= 0 ? `<i class="route-order"><b>${routeIndex + 1}</b></i>` : ''}</div>` });
}
function routeStorageKey() { return `pin-together-route:${state.user?.id || 'guest'}:${state.active}`; }
function persistRoute() { if (state.active && state.active !== 'all') localStorage.setItem(routeStorageKey(), JSON.stringify(state.route.map(pin => pin.id))); }
function restoreRoute() {
  if (!state.active || state.active === 'all') { state.route = []; return; }
  try { const ids = JSON.parse(localStorage.getItem(routeStorageKey()) || '[]'); state.route = ids.map(id => state.pins.find(pin => pin.id === id)).filter(Boolean); } catch { state.route = []; }
}

function initMap() {
  map = L.map('map', { zoomControl:false }).setView([36.5, 127.8], 7);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap contributors' }).addTo(map);
  lineLayer = L.layerGroup().addTo(map);
  map.on('click', event => { if (state.pending === 'add') { state.pending = null; $('#addPinButton').classList.remove('active'); openPinDialog(event.latlng); } });
  // 앱 화면이 숨김 상태였다가 나타날 때와 창 크기가 바뀔 때 타일 영역을 다시 계산합니다.
  const resizeMap = () => map.invalidateSize({ pan:false, animate:false });
  new ResizeObserver(resizeMap).observe($('#map'));
  window.addEventListener('resize', resizeMap);
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
  if (!state.active || (state.active !== 'all' && !state.spaces.some(s => s.space_id === state.active))) state.active = state.spaces[0]?.space_id || 'all';
  select.value = state.active;
}
async function loadPins() {
  // 기본 schema.sql만 실행한 상태에서도 동작하도록 생성 시각 기준으로 정렬합니다.
  const query = sb.from('pins').select('*, profiles!pins_author_id_fkey(nickname,pin_color)').order('created_at', { ascending:false });
  const { data, error } = state.active === 'all' ? await query : await query.eq('space_id', state.active);
  if (error) throw error;
  state.pins = data || [];
  restoreRoute();
  const { data: favs } = await sb.from('favorite_pins').select('pin_id').eq('user_id', state.user.id);
  state.favorites = new Set((favs || []).map(f => f.pin_id));
  renderPins();
}
async function loadMessages() {
  if (state.active === 'all') { $('#messages').innerHTML = '<p class="label">전체 지도에서는 채팅을 볼 수 없습니다. 여행 공간을 선택하세요.</p>'; return; }
  const { data, error } = await sb.from('messages').select('*, profiles!messages_author_id_fkey(nickname)').eq('space_id', state.active).order('created_at').limit(100);
  if (error) throw error;
  $('#messages').innerHTML = (data || []).map(message => `<article class="msg ${message.author_id === state.user.id ? 'mine' : ''}"><small>${escapeHtml(message.profiles?.nickname || '참여자')} · ${timeText(message.created_at)}</small><div class="bubble">${escapeHtml(message.body)}</div></article>`).join('');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
function renderPins() {
  if (state.markers) state.markers.clearLayers(); else state.markers = L.layerGroup().addTo(map);
  const search = $('#pinSearch').value.trim().toLowerCase();
  const pins = state.pins.filter(pin => `${pin.title} ${pin.note}`.toLowerCase().includes(search));
  $('#pinCount').textContent = pins.length;
  const row = pin => `<div class="pin-item ${state.selected.some(p => p.id === pin.id) || state.route.some(p => p.id === pin.id) ? 'selected' : ''}" data-pin="${pin.id}"><span class="dot" style="background:${colors[pin.color]}"></span><button class="pin-open" data-pin="${pin.id}"><strong>${escapeHtml(pin.title)}</strong><small>${escapeHtml(pin.profiles?.nickname || '참여자')} · ${escapeHtml(pin.note || '메모 없음')}</small></button><span class="pin-actions"><button data-comment="${pin.id}" title="댓글">💬</button><button data-edit="${pin.id}" title="수정">✎</button><button data-delete-pin="${pin.id}" title="삭제">×</button></span></div>`;
  $('#favoriteList').innerHTML = pins.filter(pin => state.favorites.has(pin.id)).map(row).join('') || '<small>즐겨찾기한 핀이 없습니다.</small>';
  $('#pinList').innerHTML = pins.map(row).join('') || '<small>아직 핀이 없습니다.</small>';
  pins.forEach(pin => L.marker([pin.latitude, pin.longitude], { icon:pinIcon(pin) }).addTo(state.markers).bindPopup(`<strong>${escapeHtml(pin.title)}</strong><br><small>${escapeHtml(pin.note || '')}</small><br><button class="favorite-popup" data-favorite="${pin.id}">☆ 즐겨찾기</button>`).on('click', () => selectPin(pin)));
  document.querySelectorAll('.pin-open').forEach(el => el.addEventListener('click', () => { const pin = state.pins.find(p => p.id === el.dataset.pin); map.flyTo([pin.latitude, pin.longitude], 15); selectPin(pin); }));
  document.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => editPin(el.dataset.edit)));
  document.querySelectorAll('[data-delete-pin]').forEach(el => el.addEventListener('click', () => deletePin(el.dataset.deletePin)));
  document.querySelectorAll('[data-comment]').forEach(el => el.addEventListener('click', () => openComments(el.dataset.comment)));
  document.querySelectorAll('.favorite-popup').forEach(el => el.addEventListener('click', () => toggleFavorite(el.dataset.favorite)));
}
function selectPin(pin) {
  if (state.routeMode) { const index = state.route.findIndex(p => p.id === pin.id); index >= 0 ? state.route.splice(index, 1) : state.route.push(pin); persistRoute(); }
  else { const index = state.selected.findIndex(p => p.id === pin.id); index >= 0 ? state.selected.splice(index, 1) : state.selected.push(pin); if (state.selected.length > 2) state.selected.shift(); }
  updateMeasure(); renderPins();
}
function updateMeasure() {
  lineLayer.clearLayers();
  const showingRoute = state.routeMode || state.route.length >= 2;
  const route = showingRoute ? state.route : state.selected;
  $('#measureTitle').textContent = showingRoute ? '저장된 경로' : '거리 측정';
  if (route.length < 2) { $('#measureValue').textContent = `${route.length}/2개 핀 선택됨`; $('#measureHint').textContent = state.routeMode ? '연결할 핀을 1번부터 순서대로 선택하세요. 선택 즉시 자동 저장됩니다.' : '핀 두 개를 선택하세요.'; return; }
  const distance = route.slice(1).reduce((sum, pin, index) => sum + map.distance([route[index].latitude, route[index].longitude], [pin.latitude, pin.longitude]), 0) / 1000;
  L.polyline(route.map(pin => [pin.latitude, pin.longitude]), { color:showingRoute ? colors.coral : '#1f2d3d', weight:4, dashArray:showingRoute ? null : '6 7' }).addTo(lineLayer);
  $('#measureValue').textContent = showingRoute ? `${route.length}개 장소 · ${distance.toFixed(2)} km` : `${route[0].title} ↔ ${route[1].title}: ${distance.toFixed(2)} km`;
  $('#measureHint').textContent = showingRoute ? `${route.map((p,i) => `${i+1}. ${p.title}`).join(' → ')} · 자동 저장됨` : '직선거리입니다.';
}
function openPinDialog(latlng) { if (state.active === 'all') return toast('핀을 추가할 여행 공간을 먼저 선택해 주세요.'); state.pending = latlng; $('#pinColor').value = state.profile.pin_color; showDialog('pinDialog'); }
async function createPin(event) {
  event.preventDefault(); if (!state.pending || state.active === 'all') return;
  const { error } = await sb.from('pins').insert({ space_id:state.active, author_id:state.user.id, title:$('#pinTitle').value.trim(), note:$('#pinNote').value.trim(), color:$('#pinColor').value, latitude:state.pending.lat, longitude:state.pending.lng });
  if (error) return toast(error.message); closeDialogs(); state.pending = null; $('#pinForm').reset(); toast('핀이 추가되었습니다.');
}
async function toggleFavorite(pinId) {
  if (state.favorites.has(pinId)) { const { error } = await sb.from('favorite_pins').delete().eq('pin_id', pinId).eq('user_id', state.user.id); if (error) return toast(error.message); state.favorites.delete(pinId); }
  else { const { error } = await sb.from('favorite_pins').insert({ pin_id:pinId, user_id:state.user.id }); if (error) return toast(error.message); state.favorites.add(pinId); }
  renderPins();
}
function currentRole() { return state.spaces.find(item => item.space_id === state.active)?.role; }
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
async function editPin(pinId) {
  const pin = state.pins.find(item => item.id === pinId); if (!pin) return;
  const title = prompt('장소 이름', pin.title); if (title === null || !title.trim()) return;
  const note = prompt('메모', pin.note || ''); if (note === null) return;
  const { error } = await sb.from('pins').update({ title:title.trim(), note:note.trim() }).eq('id', pinId);
  if (error) return toast('수정 권한이 없거나 저장에 실패했습니다.'); toast('핀을 수정했습니다.');
}
async function deletePin(pinId) {
  if (!confirm('이 핀을 삭제할까요? 핀의 댓글과 경로 정보에서도 제거됩니다.')) return;
  const { error } = await sb.from('pins').delete().eq('id', pinId);
  if (error) return toast('삭제 권한이 없거나 삭제에 실패했습니다.'); toast('핀을 삭제했습니다.');
}
async function openComments(pinId) {
  state.commentPin = pinId; const pin = state.pins.find(item => item.id === pinId); $('#commentsTitle').textContent = `${pin.title} 댓글`;
  const { data, error } = await sb.from('pin_comments').select('*, profiles!pin_comments_author_id_fkey(nickname)').eq('pin_id', pinId).order('created_at');
  if (error) return toast('댓글 기능을 사용하려면 comments-migration.sql을 먼저 실행하세요.');
  $('#commentsList').innerHTML = (data || []).map(item => `<article class="comment"><small>${escapeHtml(item.profiles?.nickname || '참여자')} · ${timeText(item.created_at)}</small>${escapeHtml(item.body)}</article>`).join('') || '<p class="label">아직 댓글이 없습니다.</p>';
  showDialog('commentsDialog');
}
async function addComment(event) {
  event.preventDefault(); const body = $('#commentInput').value.trim(); if (!body || !state.commentPin) return;
  const { error } = await sb.from('pin_comments').insert({ pin_id:state.commentPin, author_id:state.user.id, body });
  if (error) return toast('댓글 기능을 사용하려면 comments-migration.sql을 먼저 실행하세요.');
  $('#commentInput').value = ''; await openComments(state.commentPin);
}
async function loadNotifications() {
  const { data, error } = await sb.from('notifications').select('*').eq('user_id', state.user.id).order('created_at', { ascending:false }).limit(30);
  if (error) return;
  state.notifications = data || []; const unread = state.notifications.filter(item => !item.read_at).length; $('#notificationCount').textContent = unread || ''; $('#notificationCount').classList.toggle('hidden', !unread);
}
async function openNotifications() {
  $('#notificationsList').innerHTML = state.notifications.map(item => `<article class="notification-item"><strong>${escapeHtml(item.body)}</strong><small>${timeText(item.created_at)}</small></article>`).join('') || '<p class="label">새 알림이 없습니다.</p>';
  showDialog('notificationsDialog');
  const unreadIds = state.notifications.filter(item => !item.read_at).map(item => item.id);
  if (unreadIds.length) { await sb.from('notifications').update({ read_at:new Date().toISOString() }).in('id', unreadIds); await loadNotifications(); }
}
async function createSpace(event) { event.preventDefault(); const name = $('#spaceName').value.trim(); const { data, error } = await sb.rpc('create_space', { space_name:name }); if (error) return toast(error.message); closeDialogs(); $('#spaceForm').reset(); state.active = data; await refresh(); toast('새 여행 공간을 만들었습니다.'); }
async function joinSpace(event) { event.preventDefault(); const code = $('#inviteCode').value.trim(); const { data, error } = await sb.rpc('accept_invitation', { invite_code:code }); if (error) return toast(error.message); closeDialogs(); state.active = data; await refresh(); toast('여행 공간에 참가했습니다.'); }
async function makeInvite() { if (state.active === 'all') return toast('초대할 여행 공간을 선택하세요.'); const role = state.spaces.find(s => s.space_id === state.active)?.role; if (role !== 'owner') return toast('공간 소유자만 초대 링크를 만들 수 있습니다.'); const { data, error } = await sb.from('invitations').insert({ space_id:state.active, created_by:state.user.id, role:'editor' }).select('code').single(); if (error) return toast(error.message); const link = `${location.origin}${location.pathname}?invite=${data.code}`; await navigator.clipboard?.writeText(link); prompt('초대 링크를 복사해 전달하세요.', link); }
async function sendMessage(event) { event.preventDefault(); const body = $('#messageInput').value.trim(); if (!body) return; if (state.active === 'all') return toast('채팅할 여행 공간을 선택하세요.'); const { error } = await sb.from('messages').insert({ space_id:state.active, author_id:state.user.id, body }); if (error) return toast(error.message); $('#messageInput').value = ''; }
async function saveProfile(event) { event.preventDefault(); const nickname = $('#profileNickname').value.trim(); const { error } = await sb.from('profiles').update({ nickname }).eq('id', state.user.id); if (error) return toast(error.message); state.profile.nickname = nickname; $('#profileButton').textContent = initials(nickname); closeDialogs(); toast('닉네임을 저장했습니다.'); }
async function searchPlace(event) { event.preventDefault(); const query = $('#placeSearch').value.trim(); if (!query) return; $('#placeResults').innerHTML = '<button class="result">검색 중…</button>'; try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=${encodeURIComponent(query)}`); const results = await response.json(); $('#placeResults').innerHTML = results.map((item,index) => `<button class="result" data-result="${index}">${escapeHtml(item.display_name.split(',').slice(0,2).join(','))}<small>${escapeHtml(item.display_name)}</small></button>`).join('') || '<button class="result">검색 결과가 없습니다.</button>'; document.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => { const item = results[button.dataset.result]; map.flyTo([item.lat,item.lon], 15); $('#placeResults').innerHTML = ''; })); } catch { $('#placeResults').innerHTML = '<button class="result">검색에 실패했습니다.</button>'; } }
function subscribe() { state.channel?.unsubscribe(); state.channel = sb.channel(`space-${state.active}`).on('postgres_changes', { event:'*', schema:'public', table:'pins' }, () => loadPins()).on('postgres_changes', { event:'*', schema:'public', table:'messages', filter: state.active === 'all' ? undefined : `space_id=eq.${state.active}` }, () => loadMessages()).subscribe(); }
async function refresh() { await loadSpaces(); await loadPins(); await loadMessages(); await loadNotifications(); subscribe(); $('#spaceSelect').value = state.active; $('#deleteSpaceButton').classList.toggle('hidden', state.active === 'all' || currentRole() !== 'owner'); }
async function startApp() {
  // Leaflet은 숨겨진 요소에서 초기화하면 지도 크기를 0으로 계산할 수 있습니다.
  show('appView');
  if (!map) initMap();
  else map.invalidateSize();
  await loadProfile();
  await refresh();
  // CSS Grid 레이아웃이 완료된 뒤 한 번 더 실행해야 전체 지도 타일이 채워집니다.
  requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize({ pan:false, animate:false })));
  setTimeout(() => map.invalidateSize({ pan:false, animate:false }), 250);
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) { $('#inviteCode').value = invite; showDialog('joinDialog'); }
}
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function timeText(value) { return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }

function bindUi() {
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-auth]').forEach(b => b.classList.toggle('active', b === button)); const signup = button.dataset.auth === 'signup'; $('#nicknameField').classList.toggle('hidden', !signup); $('#nickname').required = signup; $('#authSubmit').textContent = signup ? '회원가입' : '로그인'; $('#authHelp').textContent = signup ? '처음이신가요? 이메일과 비밀번호로 가입하세요.' : '가입한 이메일로 로그인하세요.'; }));
  $('#authForm').addEventListener('submit', async event => { event.preventDefault(); const signup = $('[data-auth].active').dataset.auth === 'signup'; const email = $('#email').value.trim(), password = $('#password').value; const result = signup ? await sb.auth.signUp({ email, password, options:{ data:{ nickname:$('#nickname').value.trim() } } }) : await sb.auth.signInWithPassword({ email, password }); if (result.error) return toast(result.error.message); if (signup && !result.data.session) return toast('이메일 인증 링크를 확인한 후 로그인하세요.'); });
  $('#spaceSelect').addEventListener('change', async event => { state.active = event.target.value; state.selected = []; state.route = []; updateMeasure(); await loadPins(); await loadMessages(); subscribe(); });
  $('#newSpaceButton').addEventListener('click', () => showDialog('spaceDialog')); $('#joinSpaceButton').addEventListener('click', () => showDialog('joinDialog')); $('#inviteButton').addEventListener('click', makeInvite); $('#deleteSpaceButton').addEventListener('click', deleteSpace); $('#notificationButton').addEventListener('click', openNotifications); $('#mobilePanelButton').addEventListener('click', () => $('.app aside').classList.toggle('open')); $('#spaceForm').addEventListener('submit', createSpace); $('#joinForm').addEventListener('submit', joinSpace); $('#pinForm').addEventListener('submit', createPin); $('#messageForm').addEventListener('submit', sendMessage); $('#commentForm').addEventListener('submit', addComment); $('#profileButton').addEventListener('click', () => { $('#profileNickname').value = state.profile.nickname; showDialog('profileDialog'); }); $('#profileForm').addEventListener('submit', saveProfile); $('#signOutButton').addEventListener('click', () => sb.auth.signOut());
  $('#addPinButton').addEventListener('click', () => { if (state.active === 'all') return toast('핀을 추가할 여행 공간을 선택하세요.'); state.pending = 'add'; $('#addPinButton').classList.add('active'); toast('지도에서 핀을 놓을 위치를 선택하세요.'); });
  $('#routeButton').addEventListener('click', () => { state.routeMode = !state.routeMode; $('#routeButton').classList.toggle('active', state.routeMode); updateMeasure(); renderPins(); toast(state.routeMode ? '연결할 핀을 1번부터 순서대로 선택하세요. 경로는 자동 저장됩니다.' : '경로 지정을 종료했습니다. 저장된 경로는 계속 표시됩니다.'); }); $('#closeMeasure').addEventListener('click', () => $('#measureCard').classList.add('hidden')); $('#pinSearch').addEventListener('input', renderPins); $('#placeSearchForm').addEventListener('submit', searchPlace);
  $('#locateButton').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(pos => { map.flyTo([pos.coords.latitude,pos.coords.longitude],15); L.circleMarker([pos.coords.latitude,pos.coords.longitude],{radius:9,color:'#fff',weight:3,fillColor:colors.blue,fillOpacity:1}).addTo(map); }, () => toast('위치 권한이 필요합니다.')));
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('active', b === button)); const chat = button.dataset.panel === 'chat'; $('#pinsPanel').classList.toggle('hidden',chat); $('#chatPanel').classList.toggle('hidden',!chat); }));
}

if (!configured) show('setupView');
else { sb = createClient(PROJECT_URL, SUPABASE_PUBLISHABLE_KEY); bindUi(); sb.auth.onAuthStateChange(async (_event, session) => { state.user = session?.user || null; if (state.user) { try { await startApp(); } catch (error) { toast(error.message); } } else show('authView'); }); }
