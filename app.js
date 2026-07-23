const colors = { coral: '#ef7868', blue: '#5d8ddd', amber: '#e7aa43', green: '#50aa86', purple: '#8b72d5' };
let pins = [
  { id: 1, name: 'Le Bon Marché', note: '파리에서 꼭 들를 편집숍', user: '민서', color: 'coral', lat: 48.8517, lng: 2.3258, favorite: true },
  { id: 2, name: '에펠탑 야경', note: '해 질 무렵에 보기', user: '준호', color: 'blue', lat: 48.8584, lng: 2.2945, favorite: false },
  { id: 3, name: '생트샤펠', note: '오전 첫 입장 추천', user: '나', color: 'amber', lat: 48.8554, lng: 2.345, favorite: true },
  { id: 4, name: '마레 지구', note: '주말 마켓과 산책', user: '민서', color: 'coral', lat: 48.8577, lng: 2.3622, favorite: false }
];
let selectedPins = [], pendingLatLng = null, addMode = false, markerLayer = null;
const map = L.map('map', { zoomControl: false }).setView([48.8566, 2.3376], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
const lineLayer = L.layerGroup().addTo(map);

function pinIcon(pin) { return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 26], html: `<div class="custom-pin" style="background:${colors[pin.color]}"><span>${pin.user[0]}</span></div>` }); }
function renderPins() {
  if (markerLayer) markerLayer.clearLayers(); else markerLayer = L.layerGroup().addTo(map);
  const search = document.querySelector('#pinSearch').value.toLowerCase();
  const filtered = pins.filter(p => `${p.name} ${p.note}`.toLowerCase().includes(search));
  document.querySelector('#pinCount').textContent = pins.length;
  const makeItem = p => `<button class="pin-item ${selectedPins.some(s => s.id === p.id) ? 'selected' : ''}" data-id="${p.id}"><span class="pin-dot" style="background:${colors[p.color]}"></span><span><strong>${p.name}</strong><small>${p.user} · ${p.note}</small></span>${p.favorite ? '<span class="star">★</span>' : ''}</button>`;
  document.querySelector('#favoriteList').innerHTML = filtered.filter(p => p.favorite).map(makeItem).join('') || '<small>즐겨찾는 핀이 없습니다.</small>';
  document.querySelector('#pinList').innerHTML = filtered.map(makeItem).join('');
  filtered.forEach(pin => L.marker([pin.lat, pin.lng], { icon: pinIcon(pin) }).addTo(markerLayer).bindPopup(`<p class="popup-title">${pin.name}</p><p class="popup-note">${pin.note}</p>`).on('click', () => selectPin(pin)));
  document.querySelectorAll('.pin-item').forEach(el => el.addEventListener('click', () => { const pin = pins.find(p => p.id === Number(el.dataset.id)); map.flyTo([pin.lat, pin.lng], 15); selectPin(pin); }));
}
function selectPin(pin) {
  if (selectedPins.some(p => p.id === pin.id)) selectedPins = selectedPins.filter(p => p.id !== pin.id);
  else { if (selectedPins.length === 2) selectedPins.shift(); selectedPins.push(pin); }
  updateDistance(); renderPins();
}
function updateDistance() {
  lineLayer.clearLayers();
  const text = document.querySelector('#distanceText'), hint = document.querySelector('#distanceHint');
  if (selectedPins.length !== 2) { text.textContent = `핀 ${selectedPins.length}/2개 선택됨`; hint.textContent = '지도나 목록에서 핀을 두 개 선택하세요.'; return; }
  const [a,b] = selectedPins, km = map.distance([a.lat,a.lng], [b.lat,b.lng]) / 1000;
  L.polyline([[a.lat,a.lng],[b.lat,b.lng]], { color: '#1e2b3b', dashArray: '5 7', weight: 3 }).addTo(lineLayer);
  text.textContent = `${a.name} ↔ ${b.name}: ${km.toFixed(2)} km`;
  hint.textContent = '두 장소 사이의 직선거리입니다. 핀을 다시 누르면 선택 해제됩니다.';
}
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }
function openPinDialog(latlng = map.getCenter()) { pendingLatLng = latlng; document.querySelector('#pinForm').reset(); document.querySelector('#pinDialog').showModal(); document.querySelector('#pinName').focus(); }
document.querySelector('#addPinButton').addEventListener('click', () => { addMode = !addMode; document.querySelector('#addPinButton').classList.toggle('active-tool', addMode); toast(addMode ? '지도에서 핀을 놓을 위치를 선택하세요.' : '핀 추가를 취소했습니다.'); });
document.querySelector('#floatingAdd').addEventListener('click', () => openPinDialog());
map.on('click', event => { if (addMode) { addMode = false; document.querySelector('#addPinButton').classList.remove('active-tool'); openPinDialog(event.latlng); } });
document.querySelector('#pinForm').addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.currentTarget); pins.push({ id: Date.now(), name: data.get('pinName'), note: data.get('pinNote') || '메모 없음', user: '나', color: data.get('pinColor'), lat: pendingLatLng.lat, lng: pendingLatLng.lng, favorite: false }); document.querySelector('#pinDialog').close(); renderPins(); toast('새 핀이 지도에 추가되었습니다.'); });
document.querySelector('#cancelPin').addEventListener('click', () => document.querySelector('#pinDialog').close());
document.querySelector('#pinSearch').addEventListener('input', renderPins);
document.querySelector('#closeDistance').addEventListener('click', () => document.querySelector('#distanceCard').style.display = 'none');
document.querySelector('#locateButton').addEventListener('click', () => { if (!navigator.geolocation) return toast('이 브라우저는 위치 기능을 지원하지 않습니다.'); navigator.geolocation.getCurrentPosition(pos => { map.flyTo([pos.coords.latitude,pos.coords.longitude], 15); L.circleMarker([pos.coords.latitude,pos.coords.longitude], { radius: 9, color: '#fff', weight: 3, fillColor: '#4f8ce5', fillOpacity: 1 }).addTo(map).bindPopup('내 현재 위치').openPopup(); toast('현재 위치를 지도에서 확인하고 있습니다.'); }, () => toast('위치 권한이 허용되지 않았습니다.')); });
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); const chat = tab.dataset.tab === 'chat'; document.querySelector('#pinsPanel').classList.toggle('hidden', chat); document.querySelector('#chatPanel').classList.toggle('hidden', !chat); }));
const messages = [{name:'민서',time:'방금',text:'마레 지구에 예쁜 빵집을 찾았어요!',mine:false},{name:'준호',time:'2분 전',text:'에펠탑은 해 질 때 가면 좋을 것 같아요.',mine:false}];
function renderMessages(){ document.querySelector('#chatMessages').innerHTML = messages.map(m => `<div class="message ${m.mine?'mine':''}"><div class="message-meta"><strong>${m.name}</strong><span>${m.time}</span></div><div class="bubble">${m.text}</div></div>`).join(''); }
document.querySelector('#chatForm').addEventListener('submit', e => { e.preventDefault(); const input = document.querySelector('#chatInput'); if (!input.value.trim()) return; messages.push({name:'나',time:'방금',text:input.value.trim(),mine:true}); input.value=''; renderMessages(); });
document.querySelector('#inviteButton').addEventListener('click', () => toast('초대 기능은 로그인·서버 연동 단계에서 연결됩니다.'));
document.querySelector('#mobileMenu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
renderPins(); renderMessages();

// Step 1: nickname stays on this device until account login is added.
let nickname = localStorage.getItem('pintogether-nickname') || '';
function applyNickname() {
  const displayName = nickname || '여행자';
  document.querySelector('#myNickname').textContent = displayName;
  document.querySelector('#myInitial').textContent = displayName[0];
  document.querySelector('#profileButton').textContent = displayName[0];
}
document.querySelector('#nicknameForm').addEventListener('submit', event => {
  event.preventDefault();
  const value = document.querySelector('#nicknameInput').value.trim();
  if (value.length < 2) return;
  nickname = value;
  localStorage.setItem('pintogether-nickname', nickname);
  applyNickname();
  document.querySelector('#nicknameDialog').close();
  toast(`${nickname}님, 반갑습니다!`);
});
document.querySelector('#profileButton').addEventListener('click', () => {
  document.querySelector('#nicknameInput').value = nickname;
  document.querySelector('#nicknameDialog').showModal();
});
document.querySelector('#pinForm').addEventListener('submit', () => {
  if (pins.length) pins[pins.length - 1].user = nickname || '여행자';
  renderPins();
});
document.querySelector('#chatForm').addEventListener('submit', () => {
  if (messages.length) messages[messages.length - 1].name = nickname || '여행자';
  renderMessages();
});
applyNickname();
if (!nickname) document.querySelector('#nicknameDialog').showModal();

// Step 2: each travel space owns its own pins. The all view combines them.
const spaceNames = { all: '전체 지도', korea: '한국 여행', china: '중국 여행' };
const spaceCenters = { all: [30, 105, 3], korea: [37.5665, 126.978, 12], china: [39.9042, 116.4074, 11] };
const spacePins = {
  korea: [
    { id: 201, name: '경복궁', note: '한복 대여 후 방문', user: '민서', color: 'coral', lat: 37.5796, lng: 126.977, favorite: true },
    { id: 202, name: '광장시장', note: '빈대떡 먹어보기', user: '준호', color: 'blue', lat: 37.5702, lng: 126.999, favorite: false },
    { id: 203, name: '남산서울타워', note: '해 질 무렵 예약', user: '여행자', color: 'amber', lat: 37.5512, lng: 126.9882, favorite: true }
  ],
  china: [
    { id: 301, name: '자금성', note: '오전 입장권 확인', user: '민서', color: 'coral', lat: 39.9163, lng: 116.3972, favorite: true },
    { id: 302, name: '천안문 광장', note: '자금성과 함께 둘러보기', user: '준호', color: 'blue', lat: 39.904, lng: 116.397, favorite: false },
    { id: 303, name: '왕푸징 거리', note: '저녁 산책', user: '여행자', color: 'amber', lat: 39.914, lng: 116.4057, favorite: false }
  ]
};
function switchSpace(spaceId) {
  selectedPins = [];
  pins = spaceId === 'all' ? [...spacePins.korea, ...spacePins.china] : spacePins[spaceId];
  const name = spaceNames[spaceId];
  document.querySelector('.sidebar h1').textContent = name;
  document.querySelector('.space-title strong').textContent = name;
  document.querySelector('.mobile-menu span').textContent = name;
  document.querySelector('#spaceSelect').value = spaceId;
  lineLayer.clearLayers();
  renderPins();
  const [lat, lng, zoom] = spaceCenters[spaceId];
  map.flyTo([lat, lng], zoom);
  toast(`${name}을(를) 보고 있습니다.`);
}
document.querySelector('#spaceSelect').addEventListener('change', event => switchSpace(event.target.value));
switchSpace('korea');
