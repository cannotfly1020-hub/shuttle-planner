(function (global) {
/** 利用者カードの同乗入力を開いている ID（再描画でも維持） */
const openChildCompanionEditors = new Set();

const CHILD_SORT_KEY = 'cp_child_sort';
const CHILD_SORT_MODES = new Set(['default', 'kana', 'grade', 'position']);
const POS_ORDER = {
  '投手': 1, 'ピッチャー': 1,
  '捕手': 2, 'キャッチャー': 2,
  '内野': 3, '内野手': 3,
  '外野': 4, '外野手': 4,
  '未定': 9, '': 9
};

/** 利用者一覧の表示ソート（配列本体は破壊しない） */
let childSortMode = 'default';

function readChildSortMode() {
  try {
    const raw = sessionStorage.getItem(CHILD_SORT_KEY);
    if (CHILD_SORT_MODES.has(raw)) return raw;
  } catch (e) { /* ignore */ }
  return 'default';
}

function writeChildSortMode(mode) {
  const next = CHILD_SORT_MODES.has(mode) ? mode : 'default';
  childSortMode = next;
  try {
    sessionStorage.setItem(CHILD_SORT_KEY, next);
  } catch (e) { /* ignore */ }
  const select = document.getElementById('childSortModeSelect');
  if (select && select.value !== next) select.value = next;
}

function positionSortScore(pos) {
  const raw = typeof pos === 'string' ? pos.trim() : '';
  if (Object.prototype.hasOwnProperty.call(POS_ORDER, raw)) return POS_ORDER[raw];
  const keys = Object.keys(POS_ORDER).filter((k) => k);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (raw.includes(key) || key.includes(raw)) return POS_ORDER[key];
  }
  return 9;
}

function textOrEmpty(value) {
  if (value == null) return '';
  return String(value).trim();
}

function listFromUnknown(value) {
  if (Array.isArray(value)) {
    return value.map((item) => textOrEmpty(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,、]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

const LEGACY_POSITION_LABELS = new Set([
  '投手', 'ピッチャー', 'P',
  '捕手', 'キャッチャー', 'C',
  '内野', '内野手',
  '外野', '外野手',
  '未定'
]);

function isLegacyPositionLabel(value) {
  return LEGACY_POSITION_LABELS.has(textOrEmpty(value));
}

function comparePersonName(a, b) {
  return textOrEmpty(a && a.name).localeCompare(textOrEmpty(b && b.name), 'ja');
}

/** 区分/クラス。未設定なら旧 grade */
function passengerGroupClass(passenger) {
  if (!passenger || typeof passenger !== 'object') return '';
  const next = textOrEmpty(passenger.groupClass);
  if (next) return passenger.groupClass;
  if (passenger.grade != null && textOrEmpty(passenger.grade)) return passenger.grade;
  return '';
}

function formatGroupClassLabel(passenger) {
  return textOrEmpty(passengerGroupClass(passenger));
}

function groupClassSortNumber(passenger) {
  const text = textOrEmpty(passengerGroupClass(passenger));
  if (!text) return 0;
  const n = parseInt(text, 10);
  if (!Number.isNaN(n) && String(n) === text) return n;
  return 0;
}

/** careTags を優先し、無ければ positions。旧ポジション名は除く */
function explicitCareTags(passenger) {
  if (!passenger || typeof passenger !== 'object') return [];
  const primary = listFromUnknown(passenger.careTags);
  const source = primary.length ? primary : listFromUnknown(passenger.positions);
  return source.filter((tag) => !isLegacyPositionLabel(tag));
}

/**
 * 表示用の要配慮タグ。motionSick は「車酔い配慮」として補う。
 */
function passengerCareTags(passenger) {
  if (!passenger || typeof passenger !== 'object') return [];
  const tags = explicitCareTags(passenger).slice();
  if (passenger.motionSick && !tags.some((tag) => tag.indexOf('酔') !== -1)) {
    tags.push('車酔い配慮');
  }
  const seen = new Set();
  return tags.filter((tag) => {
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
}

function careTagBadgeClass(tag) {
  const text = textOrEmpty(tag);
  if (text.indexOf('酔') !== -1) return 'badge-motion';
  if (text.indexOf('車椅') !== -1 || text.indexOf('単独') !== -1) return 'badge-fixed';
  return 'badge';
}

function legacyPositionLabel(passenger) {
  if (!passenger || typeof passenger !== 'object') return '';
  const pos = textOrEmpty(passenger.pos);
  if (pos) return pos;
  const positions = listFromUnknown(passenger.positions);
  return positions[0] || '';
}

function parseCareTagInput(raw) {
  return listFromUnknown(raw).filter((tag) => !isLegacyPositionLabel(tag));
}

function careTagSortKey(passenger) {
  return explicitCareTags(passenger).join('\u0000');
}

/** 固定車両指定。未設定なら旧 parentCar */
function passengerFixedVehicleName(passenger) {
  if (!passenger || typeof passenger !== 'object') return '';
  const next = textOrEmpty(passenger.fixedVehicle);
  const legacy = textOrEmpty(passenger.parentCar);
  if (next && legacy && next !== legacy && typeof cars !== 'undefined' && Array.isArray(cars)) {
    const names = cars.map((car) => (car && car.name) || '');
    if (names.indexOf(legacy) !== -1 && names.indexOf(next) === -1) return legacy;
  }
  return next || legacy || '';
}

function applyGroupClass(passenger, raw) {
  if (!passenger) return;
  const text = textOrEmpty(raw);
  passenger.groupClass = text;
  const n = parseInt(text, 10);
  passenger.grade = text !== '' && String(n) === text ? n : text;
}

function applyFixedVehicle(passenger, name) {
  if (!passenger) return;
  const value = textOrEmpty(name);
  passenger.fixedVehicle = value;
  passenger.parentCar = value;
}

function applyCareTagInput(passenger, raw, motionChecked) {
  if (!passenger) return;
  const typed = parseCareTagInput(raw);
  const tags = typed.filter((tag) => tag.indexOf('酔') === -1);
  const motion = !!motionChecked || typed.some((tag) => tag.indexOf('酔') !== -1);
  if (motion) tags.push('車酔い配慮');
  passenger.careTags = tags;
  passenger.positions = tags.slice();
  passenger.pos = tags[0] || '';
  passenger.motionSick = motion;
}

function careTagsInputValue(passenger) {
  return passengerCareTags(passenger).filter((tag) => tag.indexOf('酔') === -1).join(', ');
}

function syncMotionCareTag(passenger) {
  if (!passenger) return;
  const tags = explicitCareTags(passenger).filter((tag) => tag.indexOf('酔') === -1);
  if (passenger.motionSick) tags.push('車酔い配慮');
  passenger.careTags = tags;
}

/** 特殊・大型車両。未設定なら旧 isEquipmentCar */
function vehicleIsSpecial(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') return false;
  if (vehicle.isSpecialVehicle != null && vehicle.isSpecialVehicle !== '') return !!vehicle.isSpecialVehicle;
  return !!vehicle.isEquipmentCar;
}

function applySpecialVehicle(vehicle, checked) {
  if (!vehicle) return;
  const next = !!checked;
  vehicle.isSpecialVehicle = next;
  vehicle.isEquipmentCar = next;
  const features = Array.isArray(vehicle.features)
    ? vehicle.features.map((feature) => textOrEmpty(feature)).filter((feature) => feature && feature !== 'リフト')
    : [];
  if (next) features.push('リフト');
  vehicle.features = features;
}

function findStaffRole(value) {
  const key = textOrEmpty(value);
  if (!key || typeof getRoles !== 'function') return null;
  try {
    return getRoles().find((role) => role && (role.id === key || role.name === key)) || null;
  } catch (e) {
    return null;
  }
}

function findCareTagMeta(value) {
  const key = textOrEmpty(value);
  if (!key || typeof getCareTags !== 'function') return null;
  try {
    return getCareTags().find((tag) => tag && (tag.id === key || tag.name === key)) || null;
  } catch (e) {
    return null;
  }
}

function contrastTextColor(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(textOrEmpty(hex));
  if (!match) return '#ffffff';
  const n = parseInt(match[1], 16);
  const y = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  return y > 160 ? '#1e293b' : '#ffffff';
}

/** 運転者。ロールIDを名称へ解決し、旧 driver と家族呼称にフォールバック */
function vehicleDriverLabel(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') return '';
  const raw = textOrEmpty(vehicle.driverRole) || textOrEmpty(vehicle.driver);
  const role = findStaffRole(raw);
  if (role) return role.name;
  if (!raw || raw === '父' || raw === '母' || raw === '祖父' || raw === '祖母' || raw === 'コーチ' || raw === 'ドライバー') {
    const drivers = typeof getRoles === 'function' ? getRoles().filter((item) => item.isDriver) : [];
    return drivers.length ? drivers[0].name : '運転手（職員）';
  }
  return raw;
}

function vehicleAssistantLabel(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') return '';
  const raw = textOrEmpty(vehicle.assistantRole);
  if (!raw) return '';
  const role = findStaffRole(raw);
  return role ? role.name : raw;
}

function fixedVehicleAutoLabel(passenger) {
  const name = passengerFixedVehicleName(passenger);
  if (name) return `自動（拘束:${name}）`;
  return '自動（指定なし）';
}

function buildCareTagBadgesHtml(passenger) {
  return passengerCareTags(passenger).map((tag) => {
    const safe = escapeRoleText(tag);
    const meta = findCareTagMeta(tag);
    if (!meta) return `<span class="badge ${careTagBadgeClass(tag)} badge-care" title="要配慮">${safe}</span>`;
    const bg = escapeRoleText(meta.color || '#d97706');
    const fg = escapeRoleText(meta.textColor || contrastTextColor(meta.color));
    return `<span class="badge badge-care" title="要配慮" style="background:${bg};color:${fg};border-color:${bg}">${safe}</span>`;
  }).join('');
}

function compareChildrenForSort(a, b, mode) {
  if (mode === 'kana') {
    return comparePersonName(a, b);
  }
  if (mode === 'grade') {
    const ga = groupClassSortNumber(a);
    const gb = groupClassSortNumber(b);
    if (gb !== ga) return gb - ga;
    const la = textOrEmpty(passengerGroupClass(a));
    const lb = textOrEmpty(passengerGroupClass(b));
    if (la !== lb) return la.localeCompare(lb, 'ja');
    return comparePersonName(a, b);
  }
  if (mode === 'position') {
    const ta = careTagSortKey(a);
    const tb = careTagSortKey(b);
    if (ta !== tb) {
      if (!ta) return 1;
      if (!tb) return -1;
      return ta.localeCompare(tb, 'ja');
    }
    const pa = positionSortScore(legacyPositionLabel(a));
    const pb = positionSortScore(legacyPositionLabel(b));
    if (pa !== pb) return pa - pb;
    const ga = groupClassSortNumber(a);
    const gb = groupClassSortNumber(b);
    if (gb !== ga) return gb - ga;
    return comparePersonName(a, b);
  }
  // default: 登録順（id 昇順、同値なら配列安定のため 0）
  const ia = Number(a && a.id) || 0;
  const ib = Number(b && b.id) || 0;
  if (ia !== ib) return ia - ib;
  return 0;
}

function getSortedChildrenForRender() {
  const mode = CHILD_SORT_MODES.has(childSortMode) ? childSortMode : 'default';
  return [...children].sort((a, b) => compareChildrenForSort(a, b, mode));
}

function setChildSortMode(mode) {
  writeChildSortMode(mode);
  renderChildren();
}

const CAR_SORT_KEY = 'cp_car_sort';
const CAR_SORT_MODES = new Set(['default', 'kana']);

/** 車両一覧の表示ソート。default は配列順、kana だけコピーを並べる */
let carSortMode = 'default';

function readCarSortMode() {
  try {
    const raw = sessionStorage.getItem(CAR_SORT_KEY);
    if (CAR_SORT_MODES.has(raw)) return raw;
  } catch (e) { /* ignore */ }
  return 'default';
}

function writeCarSortMode(mode) {
  const next = CAR_SORT_MODES.has(mode) ? mode : 'default';
  carSortMode = next;
  try {
    sessionStorage.setItem(CAR_SORT_KEY, next);
  } catch (e) { /* ignore */ }
  updateCarSortToggleButton();
}

function updateCarSortToggleButton() {
  const btn = document.getElementById('carSortToggleBtn');
  if (!btn) return;
  if (carSortMode === 'kana') {
    btn.textContent = '📋 登録順';
    btn.title = '登録順に切り替える';
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.textContent = '🔤 50音順';
    btn.title = 'あいうえお順に切り替える';
    btn.setAttribute('aria-pressed', 'false');
  }
}

function getSortedCarsForRender() {
  const mode = CAR_SORT_MODES.has(carSortMode) ? carSortMode : 'default';
  const list = [...cars];
  if (mode === 'kana') {
    list.sort((a, b) => comparePersonName(a, b));
  }
  return list;
}

function commitCarOrder(nextCars) {
  cars.splice(0, cars.length, ...nextCars);
  writeCarSortMode('default');
  saveData();
  renderCars();
}

function moveCar(id, direction) {
  if (direction !== 'up' && direction !== 'down') return;
  const index = cars.findIndex((c) => String(c.id) === String(id));
  if (index < 0) return;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= cars.length) return;
  const next = cars.slice();
  const current = next[index];
  next[index] = next[target];
  next[target] = current;
  commitCarOrder(next);
}

function reorderCar(fromId, toId) {
  const fromKey = String(fromId);
  const toKey = String(toId);
  if (!fromKey || !toKey || fromKey === toKey) return;
  const ids = cars.map((c) => String(c.id));
  const from = ids.indexOf(fromKey);
  const to = ids.indexOf(toKey);
  if (from < 0 || to < 0) return;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  const byId = new Map(cars.map((c) => [String(c.id), c]));
  commitCarOrder(ids.map((carId) => byId.get(carId)).filter(Boolean));
}

let carDragSourceId = null;
let carTouchDrag = null;
let carReorderLockedUntil = 0;

function clearCarDragVisuals() {
  document.querySelectorAll('#carList .car-card.is-dragging, #carList .car-card.is-drag-over').forEach((el) => {
    el.classList.remove('is-dragging', 'is-drag-over');
  });
}

function carCardFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || typeof el.closest !== 'function') return null;
  const card = el.closest('.car-card');
  if (!card || !card.closest('#carList')) return null;
  return card;
}

function markCarDropTarget(card, sourceId) {
  document.querySelectorAll('#carList .car-card.is-drag-over').forEach((el) => {
    if (el !== card) el.classList.remove('is-drag-over');
  });
  if (card && card.dataset.carId !== String(sourceId)) card.classList.add('is-drag-over');
}

function eventElement(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

function onCarDragStart(event) {
  const source = eventElement(event.target);
  const handle = source && source.closest('.car-drag-handle');
  if (!handle) return;
  carDragSourceId = String(handle.dataset.id || '');
  if (!carDragSourceId) return;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', carDragSourceId); } catch (e) { /* ignore */ }
  }
  const card = handle.closest('.car-card');
  if (card) card.classList.add('is-dragging');
}

function onCarDragOver(event) {
  if (!carDragSourceId) return;
  const source = eventElement(event.target);
  const card = source && source.closest('#carList .car-card');
  if (!card) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  markCarDropTarget(card, carDragSourceId);
}

function onCarDrop(event) {
  const source = eventElement(event.target);
  const card = source && source.closest('#carList .car-card');
  const fromId = carDragSourceId;
  if (!card || !fromId) return;
  if (Date.now() < carReorderLockedUntil) return;
  event.preventDefault();
  carDragSourceId = null;
  clearCarDragVisuals();
  reorderCar(fromId, card.dataset.carId);
}

function onCarDragEnd() {
  carDragSourceId = null;
  clearCarDragVisuals();
}

function onCarTouchStart(event) {
  if (carTouchDrag) return;
  const source = eventElement(event.target);
  const handle = source && source.closest('.car-drag-handle');
  if (!handle || !event.touches || event.touches.length !== 1) return;
  const touch = event.touches[0];
  carTouchDrag = {
    id: String(handle.dataset.id || ''),
    x: touch.clientX,
    y: touch.clientY,
    moved: false
  };
  const card = handle.closest('.car-card');
  if (card) card.classList.add('is-dragging');
  document.addEventListener('touchmove', onCarTouchMove, { passive: false });
  document.addEventListener('touchend', onCarTouchEnd);
  document.addEventListener('touchcancel', onCarTouchCancel);
}

function onCarTouchMove(event) {
  if (!carTouchDrag || !event.touches || event.touches.length !== 1) return;
  const touch = event.touches[0];
  const dx = Math.abs(touch.clientX - carTouchDrag.x);
  const dy = Math.abs(touch.clientY - carTouchDrag.y);
  if (!carTouchDrag.moved && dx < 8 && dy < 8) return;
  carTouchDrag.moved = true;
  event.preventDefault();
  const card = carCardFromPoint(touch.clientX, touch.clientY);
  carTouchDrag.overId = card ? card.dataset.carId : null;
  markCarDropTarget(card, carTouchDrag.id);
}

function finishCarTouch(commit) {
  document.removeEventListener('touchmove', onCarTouchMove);
  document.removeEventListener('touchend', onCarTouchEnd);
  document.removeEventListener('touchcancel', onCarTouchCancel);
  const drag = carTouchDrag;
  carTouchDrag = null;
  clearCarDragVisuals();
  if (!commit || !drag || !drag.moved || !drag.overId || drag.overId === drag.id) return;
  carReorderLockedUntil = Date.now() + 400;
  reorderCar(drag.id, drag.overId);
}

function onCarTouchEnd() {
  finishCarTouch(true);
}

function onCarTouchCancel() {
  finishCarTouch(false);
}

function bindCarReorderGestures() {
  if (bindCarReorderGestures.bound || typeof document === 'undefined') return;
  bindCarReorderGestures.bound = true;
  document.addEventListener('dragstart', onCarDragStart);
  document.addEventListener('dragover', onCarDragOver);
  document.addEventListener('drop', onCarDrop);
  document.addEventListener('dragend', onCarDragEnd);
  document.addEventListener('touchstart', onCarTouchStart, { passive: true });
}

function setCarSortMode(mode) {
  writeCarSortMode(mode);
  renderCars();
}

function toggleCarSortMode() {
  setCarSortMode(carSortMode === 'kana' ? 'default' : 'kana');
}

function readSectionOpenState(key, fallback) {
  try {
    const raw = sessionStorage.getItem(`cp_section_${key}`);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch (e) { /* ignore */ }
  return fallback;
}

function writeSectionOpenState(key, isOpen) {
  try {
    sessionStorage.setItem(`cp_section_${key}`, isOpen ? '1' : '0');
  } catch (e) { /* ignore */ }
}

function applySectionOpenState() {
  ['cars', 'children'].forEach((key) => {
    const panel = document.getElementById(key === 'cars' ? 'carsPanel' : 'childrenPanel');
    if (!panel) return;
    const isOpen = readSectionOpenState(key, true);
    panel.classList.toggle('is-open', isOpen);
    const toggle = panel.querySelector('.panel-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

function toggleSection(sectionKey) {
  // ワイド画面では常時展開のためトグル無効
  if (window.matchMedia && window.matchMedia('(min-width: 768px)').matches) return;

  const panel = document.getElementById(sectionKey === 'cars' ? 'carsPanel' : 'childrenPanel');
  if (!panel) return;
  // 開閉は .is-open / aria-expanded / sessionStorage のみ。要約バッジのテキストは触らない
  // （sessionStorage の "0"/"1" を textContent へ流し込まない）
  const nextOpen = !panel.classList.contains('is-open');
  panel.classList.toggle('is-open', nextOpen);
  writeSectionOpenState(sectionKey, nextOpen);
  const toggle = panel.querySelector('.panel-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
}

/** 設定・バックアップ（全画面幅で開閉可能・初期閉じ） */
function toggleSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  const nextOpen = !panel.classList.contains('is-open');
  panel.classList.toggle('is-open', nextOpen);
  writeSectionOpenState('settings', nextOpen);
  const toggle = panel.querySelector('.panel-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  if (nextOpen) revealFacilityMap();
}

function applySettingsPanelState() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  const isOpen = readSectionOpenState('settings', false);
  panel.classList.toggle('is-open', isOpen);
  const toggle = panel.querySelector('.panel-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) revealFacilityMap();
}

function openChildCompanionEditor(childId) {
  const id = Number(childId);
  if (!id) return;
  openChildCompanionEditors.add(id);
  renderChildren();
  const input = document.getElementById(`childCompanionInput-${id}`);
  if (input) {
    input.focus();
    if (typeof input.scrollIntoView === 'function') {
      input.scrollIntoView({ block: 'nearest' });
    }
  }
}

function updatePanelSummaries(activeCarsList, activeSeats, seatDemand, activeKids) {
  const carsSummary = document.getElementById('carsSummary');
  const childrenSummary = document.getElementById('childrenSummary');
  const carCount = Array.isArray(activeCarsList) ? activeCarsList.length : 0;
  const seatCount = Number(activeSeats) || 0;
  const kidCount = Number(activeKids) || 0;
  const remaining = seatCount - (Number(seatDemand) || 0);

  if (carsSummary) {
    // 常に文言付きテンプレート（単独の "0" を出さない）
    if (remaining < 0) {
      carsSummary.textContent = `稼働 ${carCount}台 / ${seatCount}席（${Math.abs(remaining)}席不足）`;
    } else {
      carsSummary.textContent = `稼働 ${carCount}台 / ${seatCount}席`;
    }
    carsSummary.hidden = false;
  }
  if (childrenSummary) {
    childrenSummary.textContent = `利用 ${kidCount}名`;
    childrenSummary.hidden = false;
  }
}

const SERVICE_DATE_KEY = 'shuttle_service_date_v1';
let selectedServiceDate = localDateString();
try {
  const storedDate = sessionStorage.getItem(SERVICE_DATE_KEY);
  const parsedDate = storedDate ? normalizeDispatchDate(storedDate) : null;
  if (parsedDate) selectedServiceDate = parsedDate;
} catch (e) { /* 日付の復元に失敗しても本日で開く */ }

function getSelectedServiceDate() {
  return selectedServiceDate || localDateString();
}

function formatServiceDateCaption(dateStr) {
  const ymd = normalizeDispatchDate(dateStr) || localDateString();
  const parts = ymd.split('-');
  const labels = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
  const prefix = ymd === localDateString() ? '本日: ' : '';
  return `${prefix}${Number(parts[1])}/${Number(parts[2])}(${labels[getDayOfWeekKey(ymd)] || ''})`;
}

function syncServiceDateBar() {
  const ymd = getSelectedServiceDate();
  const caption = document.getElementById('serviceDateCaption');
  const input = document.getElementById('serviceDateInput');
  if (caption) caption.textContent = formatServiceDateCaption(ymd);
  if (input && input.value !== ymd) input.value = ymd;
  const day = getDayOfWeekKey(ymd);
  document.querySelectorAll('#serviceDateBar .weekday-btn').forEach((btn) => {
    const on = btn.dataset.day === day;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setServiceDate(dateStr) {
  const next = normalizeDispatchDate(dateStr) || localDateString();
  selectedServiceDate = next;
  try { sessionStorage.setItem(SERVICE_DATE_KEY, next); } catch (e) { /* セッション保持は任意 */ }
  syncServiceDateBar();
  refreshLists();
}

function setServiceWeekday(dayKey) {
  setServiceDate(dateForWeekday(getSelectedServiceDate(), dayKey));
}

function scheduleRoot(scope) {
  return document.getElementById(scope === 'edit' ? 'editChildWeekdays' : 'newChildWeekdays');
}

function selectedScheduleDays(scope) {
  const root = scheduleRoot(scope);
  if (!root) return WEEKDAY_KEYS.slice();
  const days = [];
  root.querySelectorAll('[data-day]').forEach((btn) => {
    if (btn.getAttribute('aria-pressed') === 'true' && btn.dataset.day) days.push(btn.dataset.day);
  });
  return days;
}

function renderSchedulePills(scope, pattern) {
  const root = scheduleRoot(scope);
  if (!root) return;
  const selected = new Set(Array.isArray(pattern) ? pattern : WEEKDAY_KEYS);
  root.querySelectorAll('[data-day]').forEach((btn) => {
    const on = selected.has(btn.dataset.day);
    btn.classList.toggle('is-selected', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function toggleScheduleDay(scope, day) {
  const root = scheduleRoot(scope);
  if (!root || !day) return;
  const btn = root.querySelector(`[data-day="${day}"]`);
  if (!btn) return;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.classList.toggle('is-selected', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function passengerDayStatus(passenger, dateStr) {
  if (!passenger) return 'off';
  if (passenger.isActive === false) return 'paused';
  const date = dateStr || getSelectedServiceDate();
  const day = getDayOfWeekKey(date);
  const override = getDailyOverride(date);
  const id = String(passenger.id);
  if (override.absentPassengerIds.map(String).includes(id)) return 'absent';
  if (Array.isArray(passenger.schedulePattern) && passenger.schedulePattern.includes(day)) return 'scheduled';
  if (override.spotPassengerIds.map(String).includes(id)) return 'spot';
  return 'off';
}

function dayStatusView(status) {
  if (status === 'scheduled') return { label: '利用予定', className: 'is-scheduled' };
  if (status === 'absent') return { label: '欠席', className: 'is-absent' };
  if (status === 'spot') return { label: '当日スポット', className: 'is-spot' };
  if (status === 'paused') return { label: '休会', className: 'is-paused' };
  return { label: 'お休み', className: 'is-off' };
}

function togglePassengerDayStatus(id) {
  const passenger = children.find((item) => String(item.id) === String(id));
  if (!passenger || passenger.isActive === false) return;
  const date = getSelectedServiceDate();
  const status = passengerDayStatus(passenger, date);
  const override = getDailyOverride(date);
  const sid = String(passenger.id);
  const absent = override.absentPassengerIds.map(String).filter((item) => item !== sid);
  const spot = override.spotPassengerIds.map(String).filter((item) => item !== sid);
  if (status === 'scheduled') absent.push(sid);
  else if (status === 'off') spot.push(sid);
  saveDailyOverride(date, {
    date: date,
    absentPassengerIds: absent,
    spotPassengerIds: spot,
    outOfServiceVehicleIds: override.outOfServiceVehicleIds
  });
  refreshLists();
}

function vehicleOperatesOnSelectedDay(car) {
  if (!car) return false;
  const days = car.operatingDays;
  if (!Array.isArray(days)) return true;
  return days.includes(getDayOfWeekKey(getSelectedServiceDate()));
}

function vehicleInServiceOnSelectedDay(car) {
  if (!car || car.active === false || !vehicleOperatesOnSelectedDay(car)) return false;
  const override = getDailyOverride(getSelectedServiceDate());
  return !override.outOfServiceVehicleIds.map(String).includes(String(car.id));
}

function updateStatusBar() {
  const picked = getActiveEntitiesForDate(getSelectedServiceDate());
  const todayPassengers = picked.activePassengers;
  const activeKids = todayPassengers.filter(isParticipating).length;
  const onSiteKids = todayPassengers.filter(isOnSite).length;
  const activeCarsList = picked.activeVehicles;
  const kidSeats = todayPassengers.reduce((sum, c) => sum + seatCost(c), 0);
  const companionDemand = activeCarsList.reduce((sum, c) => sum + companionSeatsOf(c), 0);
  const seatDemand = kidSeats + companionDemand;
  const activeSeats = activeCarsList.reduce((sum, c) => sum + (parseInt(c.capacity, 10) || 0), 0);
  const diff = activeSeats - seatDemand;

  const countKidsEl = document.getElementById('countKids');
  const countOnSiteEl = document.getElementById('countOnSite');
  const countSeatsEl = document.getElementById('countSeats');
  const bar = document.getElementById('statusBar');
  const diffEl = document.getElementById('statusDiff');
  const labelEl = document.getElementById('statusDiffLabel');

  updatePanelSummaries(activeCarsList, activeSeats, seatDemand, activeKids);

  if (!countKidsEl || !countSeatsEl || !bar || !diffEl || !labelEl) return;

  countKidsEl.innerText = `${activeKids}人`;
  if (countOnSiteEl) countOnSiteEl.innerText = `${onSiteKids}人`;
  countSeatsEl.innerText = `${activeSeats}席`;

  if (diff < 0) {
    bar.classList.add('alert');
    labelEl.innerText = "不足！";
    diffEl.innerText = `${Math.abs(diff)}席 不足`;
  } else {
    bar.classList.remove('alert');
    labelEl.innerText = "状況";
    diffEl.innerText = `+${diff}席 OK`;
  }
}

function buildFixedCarOptionsHtml(selected, child) {
  let html = `<option value="">${fixedVehicleAutoLabel(child || {})}</option>`;
  const activeCars = cars.filter(c => c.active);
  activeCars.forEach(c => {
    html += `<option value="${c.name}" ${selected === c.name ? 'selected' : ''}>${c.name}</option>`;
  });
  if (selected && !activeCars.some(c => c.name === selected)) {
    html += `<option value="${selected}" selected>${selected}（本日休み）</option>`;
  }
  return html;
}

function updateCarSelectOptions() {
  const addSelect = document.getElementById('newChildParentCar');
  const editSelect = document.getElementById('editChildParentCar');
  const editFixedSelect = document.getElementById('editChildFixedCar');
  if (!addSelect) return;

  let currentAddVal = addSelect.value;
  addSelect.innerHTML = '<option value="">専用車両: なし</option>';
  cars.forEach(c => {
    addSelect.innerHTML += `<option value="${c.name}">${c.name}</option>`;
  });
  addSelect.value = currentAddVal;

  if (editSelect) {
    let currentEditVal = editSelect.value;
    editSelect.innerHTML = '<option value="">専用車両: なし</option>';
    cars.forEach(c => {
      editSelect.innerHTML += `<option value="${c.name}">${c.name}</option>`;
    });
    editSelect.value = currentEditVal;
  }

  if (editFixedSelect) {
    const id = parseInt(document.getElementById('editChildId').value, 10);
    const kid = children.find(x => x.id === id);
    const selected = editFixedSelect.value || (kid ? kid.fixedCar : '') || '';
    editFixedSelect.innerHTML = buildFixedCarOptionsHtml(selected, kid);
  }
}

function buildCapacityBadgeHtml(summary) {
  if (summary.isOver) {
    return `<span class="seat-badge seat-badge-over">定員${summary.capacity}・超過${Math.abs(summary.remaining)}</span>`;
  }
  if (summary.isFull) {
    return `<span class="seat-badge seat-badge-full">定員${summary.capacity}・満席</span>`;
  }
  return `<span class="seat-badge seat-badge-ok">定員${summary.capacity}・残${summary.remaining}</span>`;
}

function escapeRoleText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 配車見出しの括弧。運転者を先頭にし、同じ名前の同乗者は重ねない。
 * 運転者が空で同乗者もいなければ空文字（「佐藤号」のまま）。
 */
function formatCarCompanionHeader(car) {
  const role = vehicleDriverLabel(car);
  const assistant = vehicleAssistantLabel(car);
  const companions = companionsOf(car)
    .map((item) => (item && item.label ? String(item.label).trim() : ''))
    .filter((label) => label && label !== role && label !== assistant);
  const parts = [];
  if (role) parts.push(role);
  if (assistant) parts.push(assistant);
  companions.forEach((label) => parts.push(label));
  if (!parts.length) return '';
  return `（${parts.join('、')}）`;
}

function buildRoleOptionsHtml(roles, selectedId) {
  return roles.map((role) => {
    const id = escapeRoleText(role.id);
    const name = escapeRoleText(role.name);
    return `<option value="${id}" ${selectedId === role.id ? 'selected' : ''}>${name}</option>`;
  }).join('');
}

function buildDriverSelectHtml(car) {
  const roles = (typeof getRoles === 'function' ? getRoles() : []).filter((role) => role.isDriver);
  const current = findStaffRole(textOrEmpty(car.driverRole) || textOrEmpty(car.driver));
  const options = roles.slice();
  if (current && !options.some((role) => role.id === current.id)) options.unshift(current);
  if (!options.length) options.push({ id: 'role_driver', name: vehicleDriverLabel(car) || '運転手（職員）' });
  const selectedId = current && options.some((role) => role.id === current.id) ? current.id : options[0].id;
  return `<label class="driver-select-label"><span>運転者:</span><select class="car-driver-select" data-action="set-car-driver" data-id="${car.id}" data-car-id="${car.id}" aria-label="本日の運転者">${buildRoleOptionsHtml(options, selectedId)}</select></label>`;
}

function buildAssistantSelectHtml(car) {
  const roles = (typeof getRoles === 'function' ? getRoles() : []).filter((role) => role.isAssistant);
  const current = findStaffRole(car.assistantRole);
  const options = roles.slice();
  if (current && current.isAssistant === false && !options.some((role) => role.id === current.id)) options.unshift(current);
  else if (current && !options.some((role) => role.id === current.id)) options.unshift(current);
  const selectedId = current ? current.id : '';
  const html = `<option value="">なし</option>${buildRoleOptionsHtml(options, selectedId)}`;
  return `<label class="driver-select-label"><span>添乗員:</span><select class="car-driver-select car-assistant-select" data-action="set-car-assistant" data-id="${car.id}" data-car-id="${car.id}" aria-label="本日の添乗員（任意）">${html}</select></label>`;
}

function setCarDriverRole(id, role) {
  const car = cars.find((item) => String(item.id) === String(id));
  if (!car) return;
  const next = typeof role === 'string' ? role.trim().slice(0, 48) : '';
  if (!next || car.driverRole === next) return;
  car.driverRole = next;
  saveData();
}

function setCarAssistantRole(id, role) {
  const car = cars.find((item) => String(item.id) === String(id));
  if (!car) return;
  const next = typeof role === 'string' ? role.trim().slice(0, 48) : '';
  if ((car.assistantRole || '') === next) return;
  car.assistantRole = next;
  saveData();
}

function buildQuickRoleButtonsHtml(labels, action, ownerId, disabled) {
  return labels.map((label) => {
    const safe = escapeRoleText(label);
    return `<button type="button" class="companion-quick" data-action="${action}" data-id="${ownerId}" data-label="${safe}" ${disabled ? 'disabled' : ''}>${safe}</button>`;
  }).join('');
}

let masterTab = 'roles';

function safeMasterList(getter) {
  if (typeof getter !== 'function') return [];
  try {
    const list = getter();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function renderStaffRoleEditor() {
  const el = document.getElementById('roleMasterList');
  if (!el) return;
  const roles = safeMasterList(typeof getRoles === 'function' ? getRoles : null);
  if (!roles.length) {
    el.innerHTML = '<span class="role-tag-empty">ロールがありません</span>';
    return;
  }
  el.innerHTML = roles.map((role) => {
    const id = escapeRoleText(role.id);
    const name = escapeRoleText(role.name);
    const color = escapeRoleText(role.badgeColor || '#2563eb');
    const fg = escapeRoleText(contrastTextColor(role.badgeColor));
    return `<div class="master-row">
      <input type="color" class="master-color" data-action="edit-role-color" data-role-id="${id}" value="${color}" aria-label="${name}の色">
      <input type="text" class="master-name" data-action="rename-role" data-role-id="${id}" value="${name}" maxlength="40" aria-label="ロール名">
      <label class="master-flag"><input type="checkbox" data-action="toggle-role-driver" data-role-id="${id}" ${role.isDriver ? 'checked' : ''}> 運転</label>
      <label class="master-flag"><input type="checkbox" data-action="toggle-role-assistant" data-role-id="${id}" ${role.isAssistant ? 'checked' : ''}> 添乗</label>
      <span class="master-badge" style="background:${color};color:${fg}">${name}</span>
      <button type="button" class="role-tag-delete" data-action="delete-role" data-role-id="${id}" aria-label="${name}を削除">×</button>
    </div>`;
  }).join('');
}

function renderCareTagEditor() {
  const el = document.getElementById('careTagMasterList');
  if (!el) return;
  const tags = safeMasterList(typeof getCareTags === 'function' ? getCareTags : null);
  if (!tags.length) {
    el.innerHTML = '<span class="role-tag-empty">要配慮タグがありません</span>';
    return;
  }
  el.innerHTML = tags.map((tag) => {
    const id = escapeRoleText(tag.id);
    const name = escapeRoleText(tag.name);
    const color = escapeRoleText(tag.color || '#d97706');
    const fg = escapeRoleText(tag.textColor || contrastTextColor(tag.color));
    return `<div class="master-row">
      <input type="color" class="master-color" data-action="edit-care-tag-color" data-tag-id="${id}" value="${color}" aria-label="${name}の色">
      <input type="text" class="master-name" data-action="rename-care-tag" data-tag-id="${id}" value="${name}" maxlength="40" aria-label="タグ名">
      <label class="master-flag"><input type="checkbox" data-action="toggle-care-tag-disperse" data-tag-id="${id}" ${tag.preventCoOccurrence ? 'checked' : ''}> 分散</label>
      <span class="master-badge" style="background:${color};color:${fg}">${name}</span>
      <button type="button" class="role-tag-delete" data-action="delete-care-tag" data-tag-id="${id}" aria-label="${name}を削除">×</button>
    </div>`;
  }).join('');
}

function syncMasterTab() {
  const showRoles = masterTab !== 'tags';
  const rolesPanel = document.getElementById('roleMasterPanel');
  const tagsPanel = document.getElementById('careTagMasterPanel');
  const rolesTab = document.getElementById('masterTabRoles');
  const tagsTab = document.getElementById('masterTabTags');
  if (rolesPanel) rolesPanel.hidden = !showRoles;
  if (tagsPanel) tagsPanel.hidden = showRoles;
  if (rolesTab) {
    rolesTab.classList.toggle('is-active', showRoles);
    rolesTab.setAttribute('aria-selected', showRoles ? 'true' : 'false');
  }
  if (tagsTab) {
    tagsTab.classList.toggle('is-active', !showRoles);
    tagsTab.setAttribute('aria-selected', showRoles ? 'false' : 'true');
  }
}

function renderRoleMaster() {
  renderStaffRoleEditor();
  renderCareTagEditor();
  renderCarePills('new');
  const editModal = document.getElementById('editModal');
  if (editModal && editModal.classList.contains('is-open')) renderCarePills('edit');
  syncMasterTab();
}

function switchMasterTab(tab) {
  masterTab = tab === 'tags' ? 'tags' : 'roles';
  syncMasterTab();
}

function toggleRoleMaster() {
  const box = document.getElementById('roleMasterContainer');
  const btn = document.getElementById('btnToggleRoleMaster');
  if (!box || !btn) return;
  const willOpen = box.hidden;
  box.hidden = !willOpen;
  btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  btn.textContent = willOpen
    ? '🏷️ スタッフ・ロール / 要配慮タグを編集 ▲'
    : '🏷️ スタッフ・ロール / 要配慮タグを編集 ▼';
  if (willOpen) renderRoleMaster();
}

function refreshAfterMasterChange() {
  renderCars();
  renderChildren();
}

function addRoleFromInput() {
  const nameInput = document.getElementById('newRoleName');
  const colorInput = document.getElementById('newRoleColor');
  const driverInput = document.getElementById('newRoleDriver');
  const assistantInput = document.getElementById('newRoleAssistant');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert('ロール名を入力してください。');
    return;
  }
  const roles = safeMasterList(getRoles);
  if (roles.some((role) => role.name === name)) {
    alert('すでに登録されています。');
    return;
  }
  const isAssistant = !!(assistantInput && assistantInput.checked);
  const isDriver = driverInput ? !!driverInput.checked : !isAssistant;
  const color = colorInput && colorInput.value ? colorInput.value : '#2563eb';
  roles.push({
    id: `role_custom_${Date.now()}`,
    name: name,
    isDriver: isDriver || !isAssistant,
    isAssistant: isAssistant,
    badgeColor: color
  });
  saveRoles(roles);
  if (nameInput) nameInput.value = '';
  refreshAfterMasterChange();
}

function updateRoleById(roleId, mutate) {
  const roles = safeMasterList(getRoles);
  const role = roles.find((item) => item.id === roleId);
  if (!role) return;
  const prevName = role.name;
  mutate(role);
  role.name = textOrEmpty(role.name).slice(0, 40);
  if (!role.name) {
    alert('ロール名を入力してください。');
    renderRoleMaster();
    return;
  }
  if (roles.some((item) => item !== role && item.name === role.name)) {
    alert('すでに登録されています。');
    renderRoleMaster();
    return;
  }
  if (!role.isDriver && !role.isAssistant) role.isAssistant = true;
  saveRoles(roles);
  if (prevName !== role.name) {
    cars.forEach((car) => {
      if (car.driverRole === prevName) car.driverRole = role.id;
      if (car.assistantRole === prevName) car.assistantRole = role.id;
    });
    saveData();
  }
  refreshAfterMasterChange();
}

function renameRole(roleId, name) {
  updateRoleById(roleId, (role) => { role.name = name; });
}

function editRoleColor(roleId, color) {
  updateRoleById(roleId, (role) => { role.badgeColor = color; });
}

function toggleRoleFlag(roleId, flag, checked) {
  updateRoleById(roleId, (role) => { role[flag] = !!checked; });
}

function deleteRole(roleId) {
  const roles = safeMasterList(getRoles);
  const role = roles.find((item) => item.id === roleId);
  if (!role) return;
  if (roles.length <= 1) {
    alert('ロールは1件以上必要です。');
    return;
  }
  if (!confirm(`「${role.name}」を削除しますか？`)) return;
  const next = roles.filter((item) => item.id !== roleId);
  saveRoles(next);
  const fallback = next.find((item) => item.isDriver) || next[0];
  cars.forEach((car) => {
    if (car.driverRole === role.id || car.driverRole === role.name) car.driverRole = fallback ? fallback.id : '';
    if (car.assistantRole === role.id || car.assistantRole === role.name) car.assistantRole = '';
  });
  saveData();
  refreshAfterMasterChange();
}

function rewritePassengerCareTag(passenger, oldName, newName) {
  if (!passenger) return;
  const tags = explicitCareTags(passenger).map((tag) => (tag === oldName ? newName : tag)).filter(Boolean);
  passenger.careTags = tags;
  passenger.positions = tags.slice();
  passenger.pos = tags[0] || '';
  if (oldName.indexOf('酔') !== -1 && (!newName || newName.indexOf('酔') === -1)) passenger.motionSick = false;
  if (newName && newName.indexOf('酔') !== -1) passenger.motionSick = true;
}

function addCareTagFromInput() {
  const nameInput = document.getElementById('newCareTagName');
  const colorInput = document.getElementById('newCareTagColor');
  const disperseInput = document.getElementById('newCareTagDisperse');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert('タグ名を入力してください。');
    return;
  }
  const tags = safeMasterList(getCareTags);
  if (tags.some((tag) => tag.name === name)) {
    alert('すでに登録されています。');
    return;
  }
  const color = colorInput && colorInput.value ? colorInput.value : '#d97706';
  tags.push({
    id: `tag_custom_${Date.now()}`,
    name: name,
    color: color,
    textColor: contrastTextColor(color),
    requiredFeature: '',
    preventCoOccurrence: !!(disperseInput && disperseInput.checked),
    requireAssistant: false,
    requireFrontSeat: name.indexOf('酔') !== -1,
    requireAssistantRole: ''
  });
  saveCareTags(tags);
  if (nameInput) nameInput.value = '';
  if (disperseInput) disperseInput.checked = false;
  refreshAfterMasterChange();
}

function updateCareTagById(tagId, mutate) {
  const tags = safeMasterList(getCareTags);
  const tag = tags.find((item) => item.id === tagId);
  if (!tag) return;
  const prevName = tag.name;
  mutate(tag);
  tag.name = textOrEmpty(tag.name).slice(0, 40);
  if (!tag.name) {
    alert('タグ名を入力してください。');
    renderRoleMaster();
    return;
  }
  if (tags.some((item) => item !== tag && item.name === tag.name)) {
    alert('すでに登録されています。');
    renderRoleMaster();
    return;
  }
  tag.textColor = contrastTextColor(tag.color);
  saveCareTags(tags);
  if (prevName !== tag.name) {
    children.forEach((child) => rewritePassengerCareTag(child, prevName, tag.name));
    saveData();
  }
  refreshAfterMasterChange();
}

function renameCareTag(tagId, name) {
  updateCareTagById(tagId, (tag) => { tag.name = name; });
}

function editCareTagColor(tagId, color) {
  updateCareTagById(tagId, (tag) => { tag.color = color; });
}

function toggleCareTagDisperse(tagId, checked) {
  updateCareTagById(tagId, (tag) => { tag.preventCoOccurrence = !!checked; });
}

function deleteCareTag(tagId) {
  const tags = safeMasterList(getCareTags);
  const tag = tags.find((item) => item.id === tagId);
  if (!tag) return;
  if (!confirm(`「${tag.name}」を削除しますか？`)) return;
  saveCareTags(tags.filter((item) => item.id !== tagId));
  children.forEach((child) => rewritePassengerCareTag(child, tag.name, ''));
  saveData();
  refreshAfterMasterChange();
}

function addDriverRoleFromInput() {
  addRoleFromInput();
}

function addCompanionRoleFromInput() {
  const assistantInput = document.getElementById('newRoleAssistant');
  if (assistantInput) assistantInput.checked = true;
  addRoleFromInput();
}

function removeDriverRole(label) {
  const role = findStaffRole(label);
  if (role) deleteRole(role.id);
}

function removeCompanionRole(label) {
  const role = findStaffRole(label);
  if (!role) return;
  toggleRoleFlag(role.id, 'isAssistant', false);
}

function resetRoleLabelsToDefault() {
  if (!confirm('スタッフ・ロールと要配慮タグを初期値に戻しますか？')) return;
  resetRoleLabels();
  const roleInput = document.getElementById('newRoleName');
  const tagInput = document.getElementById('newCareTagName');
  if (roleInput) roleInput.value = '';
  if (tagInput) tagInput.value = '';
  refreshAfterMasterChange();
}

function selectedCareNames(raw) {
  return parseCareTagInput(raw);
}

function renderCarePills(scope) {
  const hidden = document.getElementById(scope === 'edit' ? 'editChildPos' : 'newChildPos');
  const host = document.getElementById(scope === 'edit' ? 'editChildCarePills' : 'newChildCarePills');
  if (!host) return;
  const selected = hidden ? selectedCareNames(hidden.value) : [];
  const tags = safeMasterList(typeof getCareTags === 'function' ? getCareTags : null);
  if (!tags.length) {
    host.innerHTML = '<span class="role-tag-empty">要配慮タグがありません</span>';
    return;
  }
  host.innerHTML = tags.map((tag) => {
    const on = selected.indexOf(tag.name) !== -1 || selected.indexOf(tag.id) !== -1;
    const style = on
      ? ` style="background:${escapeRoleText(tag.color)};color:${escapeRoleText(tag.textColor || '#ffffff')};border-color:${escapeRoleText(tag.color)}"`
      : '';
    return `<button type="button" class="care-pill${on ? ' is-selected' : ''}" data-action="toggle-care-pill" data-scope="${scope}" data-tag-id="${escapeRoleText(tag.id)}" aria-pressed="${on ? 'true' : 'false'}"${style}>${escapeRoleText(tag.name)}</button>`;
  }).join('');
}

function sicknessTagNames() {
  return safeMasterList(typeof getCareTags === 'function' ? getCareTags : null)
    .filter((tag) => tag.requireFrontSeat || textOrEmpty(tag.name).indexOf('酔') !== -1)
    .map((tag) => tag.name);
}

function toggleCarePill(scope, tagId) {
  const hidden = document.getElementById(scope === 'edit' ? 'editChildPos' : 'newChildPos');
  const tag = findCareTagMeta(tagId);
  if (!hidden || !tag) return;
  const selected = selectedCareNames(hidden.value).filter((name) => name !== tag.id);
  const index = selected.indexOf(tag.name);
  if (index === -1) selected.push(tag.name);
  else selected.splice(index, 1);
  hidden.value = selected.join(', ');
  const motion = document.getElementById(scope === 'edit' ? 'editChildMotionSick' : 'newChildMotionSick');
  if (motion && (tag.requireFrontSeat || tag.name.indexOf('酔') !== -1)) motion.checked = index === -1;
  renderCarePills(scope);
}

function syncMotionSickPills(scope, checked) {
  const hidden = document.getElementById(scope === 'edit' ? 'editChildPos' : 'newChildPos');
  if (!hidden) return;
  const sickness = sicknessTagNames();
  let selected = selectedCareNames(hidden.value);
  if (checked) {
    sickness.forEach((name) => {
      if (selected.indexOf(name) === -1) selected.push(name);
    });
  } else {
    selected = selected.filter((name) => sickness.indexOf(name) === -1);
  }
  hidden.value = selected.join(', ');
  renderCarePills(scope);
}

function buildCompanionChipsHtml(car) {
  const list = companionsOf(car);
  if (list.length === 0) return '';
  return list.map(c => `
    <span class="companion-chip">
      ${c.label}
      <button type="button" class="companion-remove" data-action="remove-companion" data-car-id="${car.id}" data-companion-id="${c.id}" title="削除">✕</button>
    </span>
  `).join('');
}

function buildQuickCompanionButtonsHtml(car, disabled) {
  return buildQuickRoleButtonsHtml(getCompanionRoles(), 'add-companion', car.id, disabled);
}

function buildChildQuickCompanionButtonsHtml(child, disabled) {
  return buildQuickRoleButtonsHtml(getCompanionRoles(), 'add-child-companion', child.id, disabled);
}

function syncDispatchPeriodSelect() {
  const el = document.getElementById('dispatchPeriodSelect');
  if (!el) return;
  el.value = String(getDispatchPeriod());
}

function renderCars() {
  const list = document.getElementById('carList');
  if (!list) return;
  syncDispatchPeriodSelect();
  renderRoleMaster();
  list.innerHTML = '';
  updateCarSortToggleButton();
  getSortedCarsForRender().forEach((car) => {
    const summary = carSeatSummary(car);
    const runsToday = vehicleOperatesOnSelectedDay(car);
    const inService = vehicleInServiceOnSelectedDay(car);
    const inactiveClass = inService ? '' : 'is-inactive';
    const fullBlock = summary.isFull || summary.isOver;
    const addDisabled = !inService || fullBlock ? 'disabled' : '';
    const carChips = buildCompanionChipsHtml(car);
    const orderIndex = cars.findIndex((c) => String(c.id) === String(car.id));
    const isFirst = orderIndex <= 0;
    const isLast = orderIndex < 0 || orderIndex >= cars.length - 1;

    const safeName = String(car.name || '').replace(/"/g, '&quot;');
    const specialVehicle = vehicleIsSpecial(car);
    const equipBadge = specialVehicle ? `<span class="equipment-badge" title="特殊・大型車両">🚐 特殊・大型</span>` : '';
    const periodDays = getDispatchPeriod();
    const periodLabel = periodDays === 30 ? '1ヶ月' : periodDays === 90 ? '3ヶ月' : periodDays === 180 ? '半年' : `${periodDays}日`;
    const dispatchCount = getCarDispatchCount(car, periodDays);
    const dispatchBadge = `<span class="badge-dispatch" title="過去${periodDays}日間の出動回数">直近${periodLabel}: ${dispatchCount}回</span>`;
    list.innerHTML += `
      <div class="car-card ${inactiveClass}${specialVehicle ? ' is-equipment is-special' : ''}" data-car-id="${car.id}">
        <div class="car-card-header">
          <label class="car-name-label">
            <input type="checkbox" data-action="toggle-car" data-id="${car.id}" ${inService ? 'checked' : ''} ${runsToday ? '' : 'disabled'} title="${runsToday ? 'この日の稼働' : 'この曜日は運行予定外'}">
            <input type="text" class="car-name-input" data-action="rename-car" data-id="${car.id}"
              value="${safeName}" maxlength="40" title="車両名（変更すると参照も連動更新）" aria-label="車両名">
          </label>
          ${equipBadge}
          ${buildCapacityBadgeHtml(summary)}
          ${dispatchBadge}
          <div class="car-reorder">
            <span class="car-drag-handle" draggable="true" data-id="${car.id}" title="ドラッグして並び替え" aria-label="並び替え">≡</span>
            <button type="button" class="btn-move-car btn-move-up" data-action="move-car-up" data-id="${car.id}" ${isFirst ? 'disabled' : ''} aria-label="上へ">▲</button>
            <button type="button" class="btn-move-car btn-move-down" data-action="move-car-down" data-id="${car.id}" ${isLast ? 'disabled' : ''} aria-label="下へ">▼</button>
          </div>
          <div class="car-card-tools">
            <label class="cap-edit">定員<input type="number" class="input-cap" data-action="update-capacity" data-id="${car.id}" value="${car.capacity}" min="0"></label>
            <button type="button" class="btn-delete" data-action="delete-car" data-id="${car.id}">✕</button>
          </div>
        </div>

        <div class="car-meta-row">
          <label class="car-equipment-label">
            <input type="checkbox" class="car-equipment-checkbox" data-action="toggle-equipment" data-id="${car.id}" data-car-id="${car.id}" ${specialVehicle ? 'checked' : ''}>
            特殊・大型車両
          </label>
        </div>

        <div class="companion-bar">
          ${carChips ? `<div class="companion-chips">${carChips}</div>` : ''}
          <div class="companion-add-row">
            ${buildDriverSelectHtml(car)}
            ${buildAssistantSelectHtml(car)}
            ${buildQuickCompanionButtonsHtml(car, !!addDisabled)}
            <input type="text" class="companion-input" id="companionInput-${car.id}" placeholder="名前" ${addDisabled} maxlength="20">
            <button type="button" class="companion-add-btn" data-action="add-companion-custom" data-id="${car.id}" ${addDisabled}>＋</button>
          </div>
        </div>
      </div>
    `;
  });
  updateCarSelectOptions();
}

function buildChildCompanionChipsHtml(child) {
  const list = childCompanionsOf(child);
  if (list.length === 0) return '';
  return list.map(cmp => `
    <span class="companion-chip">
      ${cmp.label}
      <button type="button" class="companion-remove" data-action="remove-child-companion" data-child-id="${child.id}" data-companion-id="${cmp.id}" title="削除">✕</button>
    </span>
  `).join('');
}

function childRowHtml(c) {
  const status = passengerDayStatus(c);
  const view = dayStatusView(status);
  const rosterLocked = status === 'absent' || status === 'off' || status === 'paused';
  const rowClass = status === 'absent' ? 'is-absent' : (status === 'off' || status === 'paused' ? 'is-off' : '');
    const mode = getAttendMode(c);
    const fixedDisabled = mode !== 'ride' || rosterLocked ? 'disabled' : '';
    const companionDisabled = mode !== 'ride' || rosterLocked ? 'disabled' : '';
    if (mode !== 'ride') openChildCompanionEditors.delete(Number(c.id));
    const editorOpen = mode === 'ride' && openChildCompanionEditors.has(Number(c.id));
    const chipsHtml = buildChildCompanionChipsHtml(c);

    const groupLabel = formatGroupClassLabel(c);
    const fixedVehicleName = passengerFixedVehicleName(c);
    const careBadges = buildCareTagBadgesHtml(c);

    return `
      <div class="item-row item-row-child ${rowClass}">
        <div class="item-main">
          <div class="child-top-row">
            <button type="button" class="day-status ${view.className}" data-action="toggle-day-status" data-id="${c.id}" ${status === 'paused' ? 'disabled' : ''}>${view.label}</button>
            <select class="attend-select" data-action="set-attend" data-id="${c.id}" ${rosterLocked ? 'disabled' : ''}>
              <option value="off" ${mode === 'off' ? 'selected' : ''}>欠席</option>
              <option value="ride" ${mode === 'ride' ? 'selected' : ''}>乗車</option>
              <option value="site" ${mode === 'site' ? 'selected' : ''}>現地</option>
            </select>
            <span class="child-name">${c.name}</span>
            ${chipsHtml}
            ${mode === 'ride' && !editorOpen && !rosterLocked ? `
              <button type="button" class="btn-add-companion" data-action="open-child-companion" data-id="${c.id}">＋同乗</button>
            ` : ''}
            ${groupLabel ? `<span class="badge-sub">${escapeRoleText(groupLabel)}</span>` : ''}
            ${careBadges}
            ${fixedVehicleName ? `<span class="badge">拘束:${escapeRoleText(fixedVehicleName)}</span>` : ''}
            ${mode === 'site' ? `<span class="badge-site">現地</span>` : ''}
            ${c.fixedCar && mode === 'ride' ? `<span class="badge-fixed">📌${escapeRoleText(c.fixedCar)}</span>` : ''}
          </div>
          ${editorOpen ? `
            <div class="child-companion-editor">
              <div class="companion-add-row">
                ${buildChildQuickCompanionButtonsHtml(c, !!companionDisabled)}
              </div>
              <input type="text" class="child-companion-input" id="childCompanionInput-${c.id}"
                placeholder="名前を入力..." ${companionDisabled} maxlength="20">
              <button type="button" class="companion-add-btn" data-action="add-child-companion" data-id="${c.id}" ${companionDisabled}>＋追加</button>
            </div>
          ` : ''}
          <label class="fixed-car-label ${mode !== 'ride' ? 'is-disabled' : ''}">
            <span>指定</span>
            <select class="fixed-car-select" data-action="set-fixed-car" data-id="${c.id}" ${fixedDisabled}>
              ${buildFixedCarOptionsHtml(c.fixedCar || '', c)}
            </select>
          </label>
        </div>
        <div class="item-right">
          <button type="button" class="btn-edit" data-action="edit-child" data-id="${c.id}">✏️</button>
          <button type="button" class="btn-delete" data-action="delete-child" data-id="${c.id}">✕</button>
        </div>
      </div>
    `;
}

function renderChildren() {
  const list = document.getElementById('childList');
  if (!list) return;
  list.innerHTML = '';
  const select = document.getElementById('childSortModeSelect');
  if (select && select.value !== childSortMode) select.value = childSortMode;

  const roster = [];
  const resting = [];
  getSortedChildrenForRender().forEach((c) => {
    const status = passengerDayStatus(c);
    if (status === 'off' || status === 'paused') resting.push(c);
    else roster.push(c);
  });
  if (roster.length) {
    list.innerHTML += `<p class="child-group-label">この曜日の利用者 ${roster.length}名</p>`;
    roster.forEach((c) => { list.innerHTML += childRowHtml(c); });
  }
  if (resting.length) {
    list.innerHTML += `<p class="child-group-label">お休み ${resting.length}名（タップで当日スポット）</p>`;
    resting.forEach((c) => { list.innerHTML += childRowHtml(c); });
  }
}

function refreshLists() {
  renderCars();
  renderChildren();
  updateStatusBar();
}

function toggleCar(id, checked) {
  const c = cars.find(x => String(x.id) === String(id));
  if (!c) return;
  if (!vehicleOperatesOnSelectedDay(c)) {
    renderCars();
    return;
  }
  const date = getSelectedServiceDate();
  const override = getDailyOverride(date);
  const ids = override.outOfServiceVehicleIds.map(String).filter((item) => item !== String(c.id));
  const nextOn = typeof checked === 'boolean' ? checked : !vehicleInServiceOnSelectedDay(c);
  if (!nextOn) ids.push(String(c.id));
  if (nextOn) c.active = true;
  saveDailyOverride(date, {
    date: date,
    absentPassengerIds: override.absentPassengerIds,
    spotPassengerIds: override.spotPassengerIds,
    outOfServiceVehicleIds: ids
  });
  saveData();
  refreshLists();
}

function updateCapacity(id, val) {
  const c = cars.find(x => x.id === id);
  if (c) c.capacity = parseInt(val) || 0;
  saveData();
  renderCars();
  updateStatusBar();
}

function toggleEquipmentCar(id, checked) {
  const c = cars.find(x => String(x.id) === String(id));
  if (!c) return;
  applySpecialVehicle(c, typeof checked === 'boolean' ? checked : !vehicleIsSpecial(c));
  saveData();
  renderCars();
  updateStatusBar();
}

/** 車両名変更（参照カスケード付き）。失敗時は表示を元に戻す。 */
function commitCarRename(id, newName) {
  const car = cars.find(x => String(x.id) === String(id));
  if (!car) return;
  const prev = car.name;
  const ok = renameCar(id, newName);
  if (!ok) {
    // 空・同一名・重複時は入力をマスタに戻して再描画
    renderCars();
    updateCarSelectOptions();
    return;
  }
  if (prev !== car.name) {
    children.forEach((ch) => {
      if (ch && ch.fixedVehicle === prev) ch.fixedVehicle = car.name;
    });
    saveData();
    refreshLists();
  }
}

function setChildAttend(id, mode) {
  const ch = children.find(x => String(x.id) === String(id));
  if (!ch) return;
  if (mode === 'off') {
    const date = getSelectedServiceDate();
    const override = getDailyOverride(date);
    const sid = String(ch.id);
    const absent = override.absentPassengerIds.map(String).filter((item) => item !== sid);
    const spot = override.spotPassengerIds.map(String).filter((item) => item !== sid);
    absent.push(sid);
    saveDailyOverride(date, {
      date: date,
      absentPassengerIds: absent,
      spotPassengerIds: spot,
      outOfServiceVehicleIds: override.outOfServiceVehicleIds
    });
    refreshLists();
    return;
  }
  setAttendMode(ch, mode);
  saveData();
  refreshLists();
}

function setChildFixedCar(id, carName) {
  const ch = children.find(x => x.id === id);
  if (!ch) return;

  if (!carName) {
    ch.fixedCar = '';
    saveData();
    refreshLists();
    return;
  }

  const car = cars.find(c => c.name === carName);
  if (!car) return;

  const cost = seatCost({ ...ch, fixedCar: carName, meetOnSite: false, active: true }) || 1;
  if (!canFitOnCar(car, cost, ch.id)) {
    alert(`「${car.name}」の定員を超えるため指定できません。`);
    renderChildren();
    return;
  }

  ch.fixedCar = carName;
  saveData();
  refreshLists();
}

function addChildCompanion(childId, label) {
  const ch = children.find(x => x.id === childId);
  const name = (label || '').trim();
  if (!ch || !isRiding(ch) || !name) return;

  if (ch.fixedCar) {
    const car = cars.find(c => c.name === ch.fixedCar);
    // 既存の利用者＋同乗はすでに used に含まれているので、追加1席分だけ判定
    if (car && !canFitOnCar(car, 1)) {
      alert(`「${car.name}」の定員を超えるため、同乗者を追加できません。`);
      return;
    }
  }

  if (!Array.isArray(ch.companions)) ch.companions = [];
  ch.companions.push({ id: newCompanionId(), label: name });
  saveData();
  refreshLists();
}

function addChildCompanionCustom(childId) {
  const input = document.getElementById(`childCompanionInput-${childId}`);
  const name = input ? input.value.trim() : '';
  if (!name) {
    alert('同乗者の名前を入力してください。');
    return;
  }
  openChildCompanionEditors.add(Number(childId));
  addChildCompanion(childId, name);
}

function removeChildCompanion(childId, companionId) {
  const ch = children.find(x => x.id === childId);
  if (!ch || !Array.isArray(ch.companions)) return;
  ch.companions = ch.companions.filter(c => String(c.id) !== String(companionId));
  saveData();
  refreshLists();
}

function addCompanion(carId, label) {
  const car = cars.find(x => x.id === carId);
  const name = (label || '').trim();
  if (!car || !vehicleInServiceOnSelectedDay(car) || !name) return;

  if (!canFitOnCar(car, 1)) {
    alert(`「${car.name}」は満席です。`);
    renderCars();
    return;
  }

  if (!Array.isArray(car.companions)) car.companions = [];
  car.companions.push({ id: newCompanionId(), label: name });
  saveData();
  refreshLists();
}

function addCompanionCustom(carId) {
  const input = document.getElementById(`companionInput-${carId}`);
  const name = input ? input.value.trim() : '';
  if (!name) {
    alert('同乗者の名前を入力してください。');
    return;
  }
  addCompanion(carId, name);
}

function removeCompanion(carId, companionId) {
  const car = cars.find(x => x.id === carId);
  if (!car || !Array.isArray(car.companions)) return;
  car.companions = car.companions.filter(c => String(c.id) !== String(companionId));
  saveData();
  refreshLists();
}

function deleteCar(id) {
  const car = cars.find(x => x.id === id);
  if (car && confirm(`「${car.name}」を削除しますか？`)) {
    cars = cars.filter(x => x.id !== id);
    children.forEach(ch => {
      if (ch.parentCar === car.name) ch.parentCar = '';
      if (ch.fixedVehicle === car.name) ch.fixedVehicle = '';
      if (ch.fixedCar === car.name) ch.fixedCar = '';
    });
    saveData();
    renderCars();
    renderChildren();
    updateStatusBar();
  }
}

function deleteChild(id) {
  const kid = children.find(x => x.id === id);
  if (kid && confirm(`「${kid.name}」を削除しますか？`)) {
    children = children.filter(x => x.id !== id);
    saveData();
    refreshLists();
  }
}

/* 地図ピッカー（Leaflet + 国土地理院。有料の地図APIは使わない） */
const placeMaps = { edit: null, new: null };
const placeSeq = { edit: 0, new: 0 };
let leafletIconsReady = false;
let gsiMuniPromise = null;

function placeDom(scope) {
  const edit = scope === 'edit';
  return {
    panel: document.getElementById(edit ? 'editPlacePicker' : 'newPlacePicker'),
    map: document.getElementById(edit ? 'pickerMap' : 'newPickerMap'),
    search: document.getElementById(edit ? 'editPlaceSearch' : 'newPlaceSearch'),
    link: document.getElementById(edit ? 'editPlaceLink' : 'newPlaceLink'),
    note: document.getElementById(edit ? 'editPlaceNote' : 'newPlaceNote'),
    address: document.getElementById(edit ? 'editChildAddress' : 'newChildAddress'),
    lat: document.getElementById(edit ? 'editChildLat' : 'newChildLat'),
    lng: document.getElementById(edit ? 'editChildLng' : 'newChildLng'),
    toggle: document.querySelector(`[data-action="toggle-place-picker"][data-scope="${scope}"]`)
  };
}

function setPlaceNote(scope, text) {
  const note = placeDom(scope).note;
  if (note) note.textContent = text || '';
}

function roundCoord4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function writeCoordInputs(scope, lat, lng) {
  const dom = placeDom(scope);
  if (dom.lat) dom.lat.value = Number.isFinite(lat) ? roundCoord4(lat).toFixed(4) : '';
  if (dom.lng) dom.lng.value = Number.isFinite(lng) ? roundCoord4(lng).toFixed(4) : '';
}

function readCoordInputs(scope) {
  const dom = placeDom(scope);
  const lat = normalizeCoord(dom.lat ? dom.lat.value : '', -90, 90);
  const lng = normalizeCoord(dom.lng ? dom.lng.value : '', -180, 180);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function placeCenter(scope) {
  const current = readCoordInputs(scope);
  if (current) return { lat: current.lat, lng: current.lng, zoom: 16 };
  const facility = typeof getFacility === 'function' ? getFacility() : null;
  if (facility && facility.lat != null && facility.lng != null) {
    return { lat: Number(facility.lat), lng: Number(facility.lng), zoom: 14 };
  }
  return { lat: 33.9575, lng: 130.9415, zoom: 14 };
}

function placeMarkerIcon() {
  if (typeof L === 'undefined') return null;
  if (!leafletIconsReady) {
    leafletIconsReady = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });
  }
  return leafletIconsReady;
}

function refreshMapSize(map) {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
    setTimeout(() => { if (map && map.invalidateSize) map.invalidateSize(); }, 120);
  });
}

function destroyPlaceMap(scope) {
  const current = placeMaps[scope];
  if (current && current.map) current.map.remove();
  placeMaps[scope] = null;
  const el = placeDom(scope).map;
  if (el) {
    if (el._leaflet_id) delete el._leaflet_id;
    el.innerHTML = '';
  }
}

function ensurePlaceMarker(scope, lat, lng) {
  const state = placeMaps[scope];
  if (!state || !state.map || typeof L === 'undefined') return;
  const ll = L.latLng(lat, lng);
  if (!state.marker) {
    state.marker = L.marker(ll, { draggable: true, autoPan: true, icon: placeMarkerIcon() }).addTo(state.map);
    state.marker.on('drag', () => {
      const point = state.marker.getLatLng();
      writeCoordInputs(scope, point.lat, point.lng);
    });
    state.marker.on('dragend', () => {
      const point = state.marker.getLatLng();
      const lat4 = roundCoord4(point.lat);
      const lng4 = roundCoord4(point.lng);
      writeCoordInputs(scope, lat4, lng4);
      reverseFillAddress(scope, lat4, lng4);
    });
  } else {
    state.marker.setLatLng(ll);
  }
}

function mountPlaceMap(scope) {
  const dom = placeDom(scope);
  if (!dom.map) return null;
  if (typeof L === 'undefined') {
    setPlaceNote(scope, '地図を読み込めませんでした。緯度と経度を直接入力できます。');
    return null;
  }
  const existing = placeMaps[scope];
  if (existing && existing.map && existing.map.getContainer() === dom.map) {
    refreshMapSize(existing.map);
    return existing;
  }
  destroyPlaceMap(scope);
  placeMarkerIcon();
  const center = placeCenter(scope);
  const map = L.map(dom.map, { zoomControl: true }).setView([center.lat, center.lng], center.zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  map.on('click', (event) => {
    placePin(scope, event.latlng.lat, event.latlng.lng, { geocode: true, pan: false });
  });
  const state = { map, marker: null };
  placeMaps[scope] = state;
  const current = readCoordInputs(scope);
  if (current) ensurePlaceMarker(scope, current.lat, current.lng);
  refreshMapSize(map);
  return state;
}

function placePin(scope, lat, lng, options) {
  const opts = options || {};
  const lat4 = roundCoord4(lat);
  const lng4 = roundCoord4(lng);
  if (!Number.isFinite(lat4) || !Number.isFinite(lng4)) return;
  writeCoordInputs(scope, lat4, lng4);
  const dom = placeDom(scope);
  if (dom.panel && dom.panel.hidden) dom.panel.hidden = false;
  const state = mountPlaceMap(scope);
  if (state) {
    ensurePlaceMarker(scope, lat4, lng4);
    if (opts.pan !== false) state.map.setView([lat4, lng4], Math.max(state.map.getZoom(), 16));
  }
  if (opts.geocode) reverseFillAddress(scope, lat4, lng4);
  if (opts.address) {
    const addressEl = placeDom(scope).address;
    if (addressEl && !addressEl.value.trim()) addressEl.value = String(opts.address).slice(0, 120);
  }
}

function syncPinFromInputs(scope) {
  const current = readCoordInputs(scope);
  if (!current || !placeMaps[scope]) return;
  placePin(scope, current.lat, current.lng, { geocode: false, pan: true });
}

function parseMapsLink(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (e) { decoded = raw; }
  const patterns = [
    /[?&]destination=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /\/(?:place|search)\/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = decoded.match(patterns[i]) || raw.match(patterns[i]);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  return null;
}

function applyPlaceLink(scope) {
  const link = placeDom(scope).link;
  const raw = link ? link.value.trim() : '';
  if (!raw) return;
  const parsed = parseMapsLink(raw);
  if (!parsed) {
    if (/maps\.app\.goo\.gl|goo\.gl\//i.test(raw)) {
      setPlaceNote(scope, '短縮URLには座標が含まれていません。開いたあとの長いURLを貼ってください。');
    }
    return;
  }
  const dom = placeDom(scope);
  if (dom.panel) dom.panel.hidden = false;
  syncPlaceToggleLabel(scope);
  placePin(scope, parsed.lat, parsed.lng, { geocode: true, pan: true });
  setPlaceNote(scope, 'リンクから位置を読み取りました。');
}

function loadGsiMuni() {
  window.GSI = window.GSI || {};
  if (window.GSI.MUNI_ARRAY && window.GSI.MUNI_ARRAY['35201']) return Promise.resolve();
  window.GSI.MUNI_ARRAY = window.GSI.MUNI_ARRAY || {};
  if (!gsiMuniPromise) {
    gsiMuniPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://maps.gsi.go.jp/js/muni.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('muni'));
      document.head.appendChild(script);
    }).catch((err) => {
      gsiMuniPromise = null;
      throw err;
    });
  }
  return gsiMuniPromise;
}

function formatGsiAddress(result) {
  if (!result) return '';
  const local = result.lv01Nm || '';
  let pref = '';
  let city = '';
  const table = window.GSI && window.GSI.MUNI_ARRAY;
  if (table && result.muniCd && table[result.muniCd]) {
    const parts = String(table[result.muniCd]).split(',');
    pref = parts[1] || '';
    city = parts[3] || '';
  }
  return `${pref}${city}${local}`.trim();
}

async function reverseAddress(lat, lng) {
  try {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.results) {
        try { await loadGsiMuni(); } catch (e) { /* 市区町村名がなくても町名は使う */ }
        const text = formatGsiAddress(data.results);
        if (text) return text;
      }
    }
  } catch (e) { /* Nominatim に任せる */ }
  const nomi = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=ja`;
  const res = await fetch(nomi);
  if (!res.ok) return '';
  const body = await res.json();
  return body && body.display_name ? String(body.display_name) : '';
}

async function geocodeAddress(query) {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const hit = Array.isArray(data) ? data[0] : null;
      const pair = hit && hit.geometry && hit.geometry.coordinates;
      if (pair && pair.length >= 2) {
        return {
          lng: Number(pair[0]),
          lat: Number(pair[1]),
          title: hit.properties && hit.properties.title ? hit.properties.title : ''
        };
      }
    }
  } catch (e) { /* Nominatim に任せる */ }
  const nomi = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=${encodeURIComponent(query)}`;
  const res2 = await fetch(nomi);
  if (!res2.ok) return null;
  const list = await res2.json();
  if (!Array.isArray(list) || !list[0]) return null;
  return { lat: Number(list[0].lat), lng: Number(list[0].lon), title: list[0].display_name || '' };
}

function reverseFillAddress(scope, lat, lng) {
  const seq = placeSeq[scope] + 1;
  placeSeq[scope] = seq;
  reverseAddress(lat, lng).then((address) => {
    if (placeSeq[scope] !== seq) return;
    if (!address) {
      setPlaceNote(scope, '座標は入りました。住所の自動入力はできませんでした。');
      return;
    }
    const addressEl = placeDom(scope).address;
    if (addressEl) addressEl.value = String(address).slice(0, 120);
    setPlaceNote(scope, '位置と住所を入れました。ピンをドラッグして微調整できます。');
  }).catch(() => {
    if (placeSeq[scope] !== seq) return;
    setPlaceNote(scope, '座標は入りました。住所の自動入力はできませんでした。');
  });
}

function syncPlaceToggleLabel(scope) {
  const toggle = placeDom(scope).toggle;
  const panel = placeDom(scope).panel;
  if (!toggle || !panel) return;
  toggle.textContent = panel.hidden ? '地図を開いて位置を指定' : '地図を閉じる';
}

function togglePlacePicker(scope) {
  const panel = placeDom(scope).panel;
  if (!panel) return;
  panel.hidden = !panel.hidden;
  syncPlaceToggleLabel(scope);
  if (panel.hidden) {
    destroyPlaceMap(scope);
    return;
  }
  mountPlaceMap(scope);
}

async function searchPlace(scope) {
  const dom = placeDom(scope);
  const query = (dom.search && dom.search.value.trim()) || (dom.address && dom.address.value.trim());
  if (!query) {
    setPlaceNote(scope, '検索する住所を入力してください。');
    return;
  }
  if (dom.panel) dom.panel.hidden = false;
  syncPlaceToggleLabel(scope);
  mountPlaceMap(scope);
  setPlaceNote(scope, '検索しています…');
  try {
    const hit = await geocodeAddress(query);
    if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) {
      setPlaceNote(scope, 'その住所は見つかりませんでした。地図をタップして指定できます。');
      return;
    }
    placePin(scope, hit.lat, hit.lng, { geocode: true, pan: true, address: hit.title || query });
  } catch (e) {
    setPlaceNote(scope, '検索できませんでした。地図をタップして指定できます。');
  }
}

function resetPlacePicker(scope) {
  const dom = placeDom(scope);
  if (dom.search) dom.search.value = '';
  if (dom.link) dom.link.value = '';
  if (dom.note) dom.note.textContent = '';
  if (dom.panel) dom.panel.hidden = true;
  syncPlaceToggleLabel(scope);
  destroyPlaceMap(scope);
}

function preparePlacePicker(scope) {
  const dom = placeDom(scope);
  if (dom.link) dom.link.value = '';
  if (dom.search) dom.search.value = '';
  if (dom.note) dom.note.textContent = '';
  const current = readCoordInputs(scope);
  if (current && dom.panel) {
    dom.panel.hidden = false;
    syncPlaceToggleLabel(scope);
    mountPlaceMap(scope);
    return;
  }
  resetPlacePicker(scope);
}

function bindPlacePickerFields() {
  ['edit', 'new'].forEach((scope) => {
    const dom = placeDom(scope);
    if (dom.link) dom.link.addEventListener('input', () => applyPlaceLink(scope));
    if (dom.search) {
      dom.search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        searchPlace(scope);
      });
    }
    if (dom.lat) dom.lat.addEventListener('change', () => syncPinFromInputs(scope));
    if (dom.lng) dom.lng.addEventListener('change', () => syncPinFromInputs(scope));
  });
}

/* 編集機能 */
function openEditModal(id) {
  const kid = children.find(x => x.id === id);
  if (!kid) return;
  document.getElementById('editChildId').value = kid.id;
  document.getElementById('editChildName').value = kid.name;
  document.getElementById('editChildGrade').value = textOrEmpty(passengerGroupClass(kid));
  document.getElementById('editChildPos').value = passengerCareTags(kid).join(', ');
  renderSchedulePills('edit', kid.schedulePattern);
  document.getElementById('editChildMotionSick').checked = !!kid.motionSick || passengerCareTags(kid).some((tag) => tag.indexOf('酔') !== -1);
  renderCarePills('edit');
  updateCarSelectOptions();
  document.getElementById('editChildParentCar').value = passengerFixedVehicleName(kid);
  const addressInput = document.getElementById('editChildAddress');
  const latInput = document.getElementById('editChildLat');
  const lngInput = document.getElementById('editChildLng');
  if (addressInput) addressInput.value = kid.address || '';
  if (latInput) latInput.value = kid.lat == null ? '' : roundCoord4(kid.lat).toFixed(4);
  if (lngInput) lngInput.value = kid.lng == null ? '' : roundCoord4(kid.lng).toFixed(4);
  const fixedSelect = document.getElementById('editChildFixedCar');
  if (fixedSelect) {
    fixedSelect.innerHTML = buildFixedCarOptionsHtml(kid.fixedCar || '', kid);
  }
  const editModal = document.getElementById('editModal');
  editModal.classList.add('is-open');
  editModal.style.display = '';
  preparePlacePicker('edit');
}

function closeEditModal() {
  destroyPlaceMap('edit');
  const panel = document.getElementById('editPlacePicker');
  if (panel) panel.hidden = true;
  syncPlaceToggleLabel('edit');
  const editModal = document.getElementById('editModal');
  editModal.classList.remove('is-open');
  editModal.style.display = '';
}

function saveEditChild() {
  const id = parseInt(document.getElementById('editChildId').value);
  const kid = children.find(x => x.id === id);
  if (kid) {
    kid.name = document.getElementById('editChildName').value.trim() || kid.name;
    applyGroupClass(kid, document.getElementById('editChildGrade').value);
    kid.schedulePattern = selectedScheduleDays('edit');
    applyCareTagInput(kid, document.getElementById('editChildPos').value, document.getElementById('editChildMotionSick').checked);
    applyFixedVehicle(kid, document.getElementById('editChildParentCar').value);
    applyPassengerPlace(kid, 'edit');

    const nextFixed = document.getElementById('editChildFixedCar').value || '';
    if (nextFixed) {
      const car = cars.find(c => c.name === nextFixed);
      const cost = seatCost({ ...kid, fixedCar: nextFixed, meetOnSite: false, active: true }) || 1;
      if (car && !canFitOnCar(car, cost, kid.id)) {
        alert(`「${car.name}」の定員を超えるため指定できません。`);
        return;
      }
      kid.fixedCar = nextFixed;
    } else {
      kid.fixedCar = '';
    }

    saveData();
    refreshLists();
  }
  closeEditModal();
}

/* 並び替えソート機能 */
/** @deprecated 互換: 車両50音表示トグルへ（配列は破壊しない） */
function sortCarsByName() {
  toggleCarSortMode();
}

/** @deprecated 互換: セレクトの区分/クラス順へ */
function sortChildrenByGrade() {
  setChildSortMode('grade');
}

/** @deprecated 互換: セレクトの50音順へ */
function sortChildrenByName() {
  setChildSortMode('kana');
}

function addCar() {
  const nameInput = document.getElementById('newCarName');
  const capInput = document.getElementById('newCarCapacity');
  const name = nameInput.value.trim();
  const cap = parseInt(capInput.value) || 3;
  if (name) {
    cars.push(normalizeCar({
      id: Date.now(),
      name: name,
      capacity: cap,
      active: true,
      companions: [],
      isEquipmentCar: false,
      isSpecialVehicle: false
    }));
    renderCars();
    saveData();
    updateStatusBar();
    nameInput.value = '';
    capInput.value = '3';
  } else {
    alert("車両名を入力してください");
  }
}

function addChild() {
  const nameInput = document.getElementById('newChildName');
  const gradeInput = document.getElementById('newChildGrade');
  const posInput = document.getElementById('newChildPos');
  const parentSelect = document.getElementById('newChildParentCar');
  const motionInput = document.getElementById('newChildMotionSick');

  const name = nameInput ? nameInput.value.trim() : '';
  const gradeRaw = gradeInput ? gradeInput.value.trim() : '';
  const posRaw = posInput ? posInput.value : '';
  const parent = parentSelect ? parentSelect.value : '';
  const motionSick = !!(motionInput && motionInput.checked);

  if (name) {
    const passenger = normalizeChild({
      id: Date.now(),
      name: name,
      grade: '',
      groupClass: '',
      pos: '',
      positions: [],
      careTags: [],
      parentCar: '',
      fixedVehicle: '',
      fixedCar: '',
      motionSick: false,
      companions: [],
      active: true,
      isActive: true,
      meetOnSite: false,
      schedulePattern: selectedScheduleDays('new'),
      address: '',
      lat: null,
      lng: null,
      boardingTimeMinutes: null,
      lastCar: '',
      rideHistory: {}
    });
    applyGroupClass(passenger, gradeRaw);
    applyFixedVehicle(passenger, parent);
    applyCareTagInput(passenger, posRaw, motionSick);
    applyPassengerPlace(passenger, 'new');
    children.push(passenger);
    saveData();
    refreshLists();
    if (nameInput) nameInput.value = '';
    if (gradeInput) gradeInput.value = '';
    if (posInput) posInput.value = '';
    if (parentSelect) parentSelect.value = '';
    const addressInput = document.getElementById('newChildAddress');
    const latInput = document.getElementById('newChildLat');
    const lngInput = document.getElementById('newChildLng');
    if (addressInput) addressInput.value = '';
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
    if (motionInput) motionInput.checked = false;
    resetPlacePicker('new');
    renderCarePills('new');
    renderSchedulePills('new', WEEKDAY_KEYS.slice());
  } else {
    alert("利用者の名前を入力してください");
  }
}

function openRestoreModal() {
  const input = document.getElementById('restoreJson');
  if (input) input.value = '';
  const restoreModal = document.getElementById('restoreModal');
  restoreModal.classList.add('is-open');
  restoreModal.style.display = '';
}

function closeRestoreModal() {
  const restoreModal = document.getElementById('restoreModal');
  restoreModal.classList.remove('is-open');
  restoreModal.style.display = '';
}

function applyRestore() {
  const text = document.getElementById('restoreJson').value;
  if (restoreBackupData(text)) {
    closeRestoreModal();
  }
}

function applyPassengerPlace(passenger, scope) {
  if (!passenger) return;
  const prefix = scope === 'edit' ? 'editChild' : 'newChild';
  const addressEl = document.getElementById(`${prefix}Address`);
  const latEl = document.getElementById(`${prefix}Lat`);
  const lngEl = document.getElementById(`${prefix}Lng`);
  passenger.address = addressEl ? addressEl.value.trim().slice(0, 120) : '';
  passenger.lat = normalizeCoord(latEl ? latEl.value : '', -90, 90);
  passenger.lng = normalizeCoord(lngEl ? lngEl.value : '', -180, 180);
}

let routePlanBase = '';
let facilityFormDirty = false;
let facilityMapState = null;
let facilityPlaceSeq = 0;

function readDepartureTime() {
  const input = document.getElementById('departureTimeInput');
  const facility = getFacility();
  return normalizeClock(input && input.value ? input.value : '') || facility.defaultDepartureTime;
}

function fillFacilityFieldsFromStore() {
  const facility = getFacility();
  const name = document.getElementById('facilityNameInput');
  const address = document.getElementById('facilityAddressInput');
  const lat = document.getElementById('facilityLatInput');
  const lng = document.getElementById('facilityLngInput');
  const depart = document.getElementById('facilityDepartureInput');
  if (name && document.activeElement !== name) name.value = facility.name;
  if (address && document.activeElement !== address) address.value = facility.address || '';
  if (lat && document.activeElement !== lat && facility.lat != null) lat.value = roundCoord4(facility.lat).toFixed(4);
  if (lng && document.activeElement !== lng && facility.lng != null) lng.value = roundCoord4(facility.lng).toFixed(4);
  if (depart && document.activeElement !== depart) depart.value = facility.defaultDepartureTime;
}

function syncFacilityInputs() {
  const facility = getFacility();
  const time = document.getElementById('departureTimeInput');
  const caption = document.getElementById('facilityCaption');
  if (time) time.value = facility.defaultDepartureTime;
  if (caption) caption.textContent = `出発地: ${facility.name}`;
  if (!facilityFormDirty) fillFacilityFieldsFromStore();
}

function setDepartureTime(value) {
  const time = normalizeClock(value) || getFacility().defaultDepartureTime;
  saveFacility({ defaultDepartureTime: time });
  syncFacilityInputs();
  const card = document.getElementById('resultCard');
  if (routePlanBase && currentAssignments && card && card.style.display !== 'none') {
    publishRouteTimeline(routePlanBase);
  }
}

function setFacilityName(value) {
  saveFacility({ name: value });
  syncFacilityInputs();
  refreshRouteIfVisible();
}

function setFacilityCoord(which, value) {
  if (which !== 'lat' && which !== 'lng') return;
  const current = getFacility();
  const next = which === 'lat' ? normalizeCoord(value, -90, 90) : normalizeCoord(value, -180, 180);
  if (next == null) {
    syncFacilityInputs();
    return;
  }
  const patch = which === 'lat' ? { lat: next, lng: current.lng } : { lat: current.lat, lng: next };
  saveFacility(patch);
  syncFacilityInputs();
  refreshRouteIfVisible();
}

function refreshRouteIfVisible() {
  const card = document.getElementById('resultCard');
  if (routePlanBase && currentAssignments && card && card.style.display !== 'none') {
    publishRouteTimeline(routePlanBase);
  }
}

function facilityDom() {
  return {
    map: document.getElementById('facilityPickerMap'),
    search: document.getElementById('facilityPlaceSearch'),
    link: document.getElementById('facilityPlaceLink'),
    note: document.getElementById('facilityPlaceNote'),
    address: document.getElementById('facilityAddressInput'),
    lat: document.getElementById('facilityLatInput'),
    lng: document.getElementById('facilityLngInput'),
    name: document.getElementById('facilityNameInput'),
    time: document.getElementById('facilityDepartureInput')
  };
}

function setFacilityNote(text) {
  const note = facilityDom().note;
  if (note) note.textContent = text || '';
}

function writeFacilityCoords(lat, lng) {
  const dom = facilityDom();
  if (dom.lat) dom.lat.value = Number.isFinite(lat) ? roundCoord4(lat).toFixed(4) : '';
  if (dom.lng) dom.lng.value = Number.isFinite(lng) ? roundCoord4(lng).toFixed(4) : '';
  facilityFormDirty = true;
}

function readFacilityCoords() {
  const dom = facilityDom();
  const lat = normalizeCoord(dom.lat ? dom.lat.value : '', -90, 90);
  const lng = normalizeCoord(dom.lng ? dom.lng.value : '', -180, 180);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function destroyFacilityMap() {
  if (facilityMapState && facilityMapState.map) facilityMapState.map.remove();
  facilityMapState = null;
  const el = facilityDom().map;
  if (el) {
    if (el._leaflet_id) delete el._leaflet_id;
    el.innerHTML = '';
  }
}

function ensureFacilityMarker(lat, lng) {
  if (!facilityMapState || !facilityMapState.map || typeof L === 'undefined') return;
  const ll = L.latLng(lat, lng);
  if (!facilityMapState.marker) {
    facilityMapState.marker = L.marker(ll, { draggable: true, autoPan: true, icon: placeMarkerIcon() }).addTo(facilityMapState.map);
    facilityMapState.marker.on('drag', () => {
      const point = facilityMapState.marker.getLatLng();
      writeFacilityCoords(point.lat, point.lng);
    });
    facilityMapState.marker.on('dragend', () => {
      const point = facilityMapState.marker.getLatLng();
      const lat4 = roundCoord4(point.lat);
      const lng4 = roundCoord4(point.lng);
      writeFacilityCoords(lat4, lng4);
      reverseFillFacility(lat4, lng4);
    });
  } else {
    facilityMapState.marker.setLatLng(ll);
  }
}

function mountFacilityMap() {
  const dom = facilityDom();
  if (!dom.map) return null;
  if (typeof L === 'undefined') {
    setFacilityNote('地図を読み込めませんでした。緯度と経度を直接入力できます。');
    return null;
  }
  if (facilityMapState && facilityMapState.map && facilityMapState.map.getContainer() === dom.map) {
    refreshMapSize(facilityMapState.map);
    return facilityMapState;
  }
  destroyFacilityMap();
  placeMarkerIcon();
  const saved = getFacility();
  const typed = readFacilityCoords();
  const center = typed || { lat: Number(saved.lat), lng: Number(saved.lng) };
  const map = L.map(dom.map, { zoomControl: true }).setView([center.lat, center.lng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  map.on('click', (event) => {
    pinFacility(event.latlng.lat, event.latlng.lng, { geocode: true, pan: false });
  });
  facilityMapState = { map, marker: null };
  ensureFacilityMarker(center.lat, center.lng);
  refreshMapSize(map);
  return facilityMapState;
}

function pinFacility(lat, lng, options) {
  const opts = options || {};
  const lat4 = roundCoord4(lat);
  const lng4 = roundCoord4(lng);
  if (!Number.isFinite(lat4) || !Number.isFinite(lng4)) return;
  writeFacilityCoords(lat4, lng4);
  const state = mountFacilityMap();
  if (state) {
    ensureFacilityMarker(lat4, lng4);
    if (opts.pan !== false) state.map.setView([lat4, lng4], Math.max(state.map.getZoom(), 16));
  }
  if (opts.geocode) reverseFillFacility(lat4, lng4);
  if (opts.address) {
    const addressEl = facilityDom().address;
    if (addressEl && !addressEl.value.trim()) addressEl.value = String(opts.address).slice(0, 120);
  }
}

function reverseFillFacility(lat, lng) {
  const seq = facilityPlaceSeq + 1;
  facilityPlaceSeq = seq;
  reverseAddress(lat, lng).then((address) => {
    if (facilityPlaceSeq !== seq) return;
    if (!address) {
      setFacilityNote('座標は入りました。住所の自動入力はできませんでした。');
      return;
    }
    const addressEl = facilityDom().address;
    if (addressEl) addressEl.value = String(address).slice(0, 120);
    facilityFormDirty = true;
    setFacilityNote('位置と住所を入れました。「施設位置を保存」で運行計画に反映します。');
  }).catch(() => {
    if (facilityPlaceSeq !== seq) return;
    setFacilityNote('座標は入りました。住所の自動入力はできませんでした。');
  });
}

function revealFacilityMap() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || !panel.classList.contains('is-open')) return;
  if (!facilityFormDirty) fillFacilityFieldsFromStore();
  const state = mountFacilityMap();
  if (state && state.map) {
    refreshMapSize(state.map);
    setTimeout(() => {
      if (facilityMapState && facilityMapState.map) facilityMapState.map.invalidateSize();
    }, 240);
  }
}

function applyFacilityLink() {
  const link = facilityDom().link;
  const raw = link ? link.value.trim() : '';
  if (!raw) return;
  const parsed = parseMapsLink(raw);
  if (!parsed) {
    if (/maps\.app\.goo\.gl|goo\.gl\//i.test(raw)) {
      setFacilityNote('短縮URLには座標が含まれていません。開いたあとの長いURLを貼ってください。');
    }
    return;
  }
  pinFacility(parsed.lat, parsed.lng, { geocode: true, pan: true });
  setFacilityNote('リンクから位置を読み取りました。「施設位置を保存」で運行計画に反映します。');
}

async function searchFacilityPlace() {
  const dom = facilityDom();
  const query = (dom.search && dom.search.value.trim()) || (dom.address && dom.address.value.trim());
  if (!query) {
    setFacilityNote('検索する住所を入力してください。');
    return;
  }
  revealFacilityMap();
  setFacilityNote('検索しています…');
  try {
    const hit = await geocodeAddress(query);
    if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) {
      setFacilityNote('その住所は見つかりませんでした。地図をタップして指定できます。');
      return;
    }
    pinFacility(hit.lat, hit.lng, { geocode: true, pan: true, address: hit.title || query });
  } catch (e) {
    setFacilityNote('検索できませんでした。地図をタップして指定できます。');
  }
}

function syncFacilityPinFromInputs() {
  const coords = readFacilityCoords();
  if (!coords) return;
  facilityFormDirty = true;
  if (!facilityMapState) return;
  pinFacility(coords.lat, coords.lng, { geocode: false, pan: true });
}

function saveFacilityPlace() {
  const dom = facilityDom();
  const coords = readFacilityCoords();
  if (!coords) {
    setFacilityNote('地図で施設の位置を指定してください。');
    return;
  }
  const current = getFacility();
  const name = dom.name && dom.name.value.trim() ? dom.name.value.trim().slice(0, 40) : current.name;
  const address = dom.address ? dom.address.value.trim().slice(0, 120) : '';
  const time = normalizeClock(dom.time && dom.time.value ? dom.time.value : '') || current.defaultDepartureTime;
  saveFacility({
    name,
    address,
    lat: coords.lat,
    lng: coords.lng,
    defaultDepartureTime: time
  });
  facilityFormDirty = false;
  syncFacilityInputs();
  if (facilityMapState && facilityMapState.map) {
    facilityMapState.map.setView([coords.lat, coords.lng], Math.max(facilityMapState.map.getZoom(), 16));
    ensureFacilityMarker(coords.lat, coords.lng);
  }
  refreshRouteIfVisible();
  syncPrintHeader();
  setFacilityNote('施設位置を保存しました。出発・帰還の地点がこの位置に切り替わりました。');
}

function bindFacilityPlaceFields() {
  const dom = facilityDom();
  if (dom.link) dom.link.addEventListener('input', () => applyFacilityLink());
  if (dom.search) {
    dom.search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      searchFacilityPlace();
    });
  }
  if (dom.address) {
    dom.address.addEventListener('input', () => { facilityFormDirty = true; });
  }
  if (dom.name) dom.name.addEventListener('input', () => { facilityFormDirty = true; });
  if (dom.time) dom.time.addEventListener('input', () => { facilityFormDirty = true; });
  if (dom.lat) dom.lat.addEventListener('change', () => syncFacilityPinFromInputs());
  if (dom.lng) dom.lng.addEventListener('change', () => syncFacilityPinFromInputs());
}

function stripRouteSection(text) {
  return String(text || '').replace(/\n*【巡回時刻】[\s\S]*?(?=-----+\nよろしくお願いいたします。)/, '\n');
}

/** 座標があればそのピン、無ければ住所。どちらも無ければ空文字。APIキーは不要。 */
function mapsDirectionUrl(point) {
  if (!point) return '';
  const lat = point.lat;
  const lng = point.lng;
  if (lat != null && lat !== '' && lng != null && lng !== '') {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return `https://www.google.com/maps/dir/?api=1&destination=${latNum},${lngNum}`;
    }
  }
  const address = String(point.address || '').trim();
  if (!address) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function routeMapAnchor(point, label) {
  const url = mapsDirectionUrl(point);
  if (!url) return '';
  return `<a class="route-map map-link-btn" href="${escapeRoleText(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeRoleText(label)}">📍 地図</a>`;
}

function passengerMapPoint(schedule, stop) {
  const riders = schedule && Array.isArray(schedule.route) ? schedule.route : [];
  const found = riders.find((passenger) => passenger && String(passenger.id) === String(stop && stop.id));
  return found || stop;
}

function routeTextWithMapLinks(schedules) {
  let text = formatRouteScheduleText(schedules);
  if (!text) return text;
  let cursor = 0;
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    (schedule.timeline || []).forEach((stop) => {
      if (!stop || stop.type !== 'passenger') return;
      const url = mapsDirectionUrl(passengerMapPoint(schedule, stop));
      if (!url) return;
      const marker = `[${stop.arrivalTime}着 - ${stop.departureTime}発] ${stop.name}`;
      const idx = text.indexOf(marker, cursor);
      if (idx < 0) return;
      const lineEnd = text.indexOf('\n', idx);
      const end = lineEnd < 0 ? text.length : lineEnd;
      if (text.slice(idx, end).indexOf(url) >= 0) {
        cursor = end;
        return;
      }
      text = `${text.slice(0, end)} ${url}${text.slice(end)}`;
      cursor = end + url.length + 1;
    });
  });
  return text;
}

function mergeRouteIntoPlan(baseText, schedules) {
  const block = routeTextWithMapLinks(schedules);
  const closing = '---------------------\nよろしくお願いいたします。';
  const base = stripRouteSection(baseText);
  if (!block) return base;
  if (base.indexOf(closing) >= 0) return base.replace(closing, `${block}\n${closing}`);
  return `${base.replace(/\s*$/, '\n')}${block}\n`;
}

function buildCurrentRouteSchedules() {
  if (!currentAssignments) return [];
  const facility = getFacility();
  const departureTime = readDepartureTime();
  const schedules = [];
  cars.forEach((car) => {
    const riders = currentAssignments[car.name];
    if (!Array.isArray(riders) || !riders.length) return;
    try {
      schedules.push(optimizeRouteSchedule({
        vehicle: car,
        passengers: riders,
        facility,
        departureTime
      }));
    } catch (e) {
      schedules.push({
        vehicle: car,
        timeline: [],
        totalMinutes: 0,
        approximated: true,
        route: riders.slice()
      });
    }
  });
  return schedules;
}

function formatPrintServiceDate(dateStr) {
  const ymd = normalizeDispatchDate(dateStr) || localDateString();
  const parts = ymd.split('-');
  const labels = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
  const weekday = labels[getDayOfWeekKey(ymd)] || '';
  return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日（${weekday}）`;
}

const DEFAULT_APP_BRAND = {
  fullName: 'shuttle-planner | 送迎計画・運行最適化',
  shortName: 'shuttle-planner 送迎管理',
  subtitle: '福祉・通所介護・スクール向け送迎最適化',
  productName: 'shuttle-planner',
  planLabel: '本日の送迎運行計画'
};

function appBrand() {
  const facility = typeof getFacility === 'function' ? getFacility() : null;
  const custom = facility && typeof facility.systemName === 'string' ? facility.systemName.trim() : '';
  if (!custom) return DEFAULT_APP_BRAND;
  return {
    fullName: custom,
    shortName: custom,
    subtitle: DEFAULT_APP_BRAND.subtitle,
    productName: custom,
    planLabel: DEFAULT_APP_BRAND.planLabel
  };
}

function planTextHeader() {
  const brand = appBrand();
  return `【${brand.planLabel} - ${brand.productName}】`;
}

function applyPlanBrandHeader(text) {
  const header = planTextHeader();
  const body = String(text || '');
  if (!body) return header;
  const lines = body.split('\n');
  if (lines[0] === '本日の送迎割り当て表' || /^【本日の送迎運行計画 - .+】$/.test(lines[0])) {
    lines[0] = header;
    return lines.join('\n');
  }
  return `${header}\n${body}`;
}

function syncAppBrand() {
  const brand = appBrand();
  document.title = brand.fullName;
  const title = document.querySelector('.app-title');
  if (title) title.textContent = brand.shortName;
  const subtitle = document.querySelector('.app-subtitle');
  if (subtitle) subtitle.textContent = brand.subtitle;
  const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (apple) apple.setAttribute('content', brand.shortName);
  const printTitle = document.getElementById('printPlanTitle');
  if (printTitle) printTitle.textContent = `${brand.planLabel} - ${brand.productName}`;
}

function syncPrintHeader() {
  syncAppBrand();
  const dateEl = document.getElementById('printServiceDate');
  const metaEl = document.getElementById('printCreatedMeta');
  if (dateEl) dateEl.textContent = `運行日: ${formatPrintServiceDate(getSelectedServiceDate())}`;
  if (!metaEl) return;
  const facility = typeof getFacility === 'function' ? getFacility() : null;
  const facilityName = facility && facility.name ? facility.name : '';
  const now = new Date();
  const stamp = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  metaEl.textContent = facilityName ? `${stamp} / ${facilityName}` : stamp;
  const addressEl = document.getElementById('printFacilityAddress');
  if (addressEl) addressEl.textContent = facility && facility.address ? facility.address : '';
}

function printDispatchSheet() {
  syncPrintHeader();
  window.print();
}

function vehiclePrintHeaderText(schedule) {
  const vehicle = schedule && schedule.vehicle ? schedule.vehicle : {};
  const name = escapeRoleText(vehicle.name || '車両');
  const driver = escapeRoleText(vehicleDriverLabel(vehicle) || '未設定');
  const assistant = vehicleAssistantLabel(vehicle);
  const assist = assistant ? `　添乗: ${escapeRoleText(assistant)}` : '';
  return `${name}　運転: ${driver}${assist}`;
}

function renderPrintTimelineTable(schedule) {
  const facility = typeof getFacility === 'function' ? getFacility() : null;
  const facilityAddress = escapeRoleText(facility && facility.address ? facility.address : '');
  const rows = (schedule.timeline || []).map((stop) => {
    if (!stop) return '';
    if (stop.type === 'depot_start') {
      return `<tr><td>${escapeRoleText(stop.departureTime)}発</td><td>出発: ${escapeRoleText(stop.name)}</td><td></td><td></td><td>${facilityAddress}</td></tr>`;
    }
    if (stop.type === 'passenger') {
      const tags = (stop.careTags || []).map((tag) => `<span class="care-tag-badge">${escapeRoleText(tag)}</span>`).join('');
      const dwell = Number.isFinite(stop.dwellMinutes) ? `${stop.dwellMinutes}分` : '';
      return `<tr><td>${escapeRoleText(stop.arrivalTime)}着 ${escapeRoleText(stop.departureTime)}発</td><td>${escapeRoleText(stop.name)}</td><td>${tags}</td><td>${dwell}</td><td>${escapeRoleText(stop.address || '')}</td></tr>`;
    }
    if (stop.type === 'depot_end') {
      return `<tr><td>${escapeRoleText(stop.arrivalTime)}着</td><td>到着: ${escapeRoleText(stop.name)}（総所要 ${schedule.totalMinutes}分）</td><td></td><td></td><td>${facilityAddress}</td></tr>`;
    }
    return '';
  }).join('');
  return `<table class="print-timeline-table"><thead><tr><th>時刻</th><th>氏名</th><th>要配慮・特性</th><th>乗降時間</th><th>住所</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRouteTimeline(schedules) {
  const root = document.getElementById('routeTimeline');
  if (!root) return;
  syncPrintHeader();
  const list = Array.isArray(schedules) ? schedules : [];
  if (!list.length) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = list.map((schedule) => {
    const vehicleName = escapeRoleText(schedule.vehicle && schedule.vehicle.name ? schedule.vehicle.name : '車両');
    const facility = typeof getFacility === 'function' ? getFacility() : null;
    const stops = (schedule.timeline || []).map((stop) => {
      if (stop.type === 'depot_start') {
        const mapLink = routeMapAnchor(facility, `${stop.name}への出発案内をGoogleマップで開く`);
        const depotAddress = facility && facility.address ? `<div class="route-address">${escapeRoleText(facility.address)}</div>` : '';
        return `<div class="route-stop"><span class="route-time">${escapeRoleText(stop.departureTime)}</span><span class="route-stop-body">出発: ${escapeRoleText(stop.name)}</span>${mapLink}</div>${depotAddress}`;
      }
      if (stop.type === 'passenger') {
        const tags = stop.careTags && stop.careTags.length ? ` [${escapeRoleText(stop.careTags.join('、'))}]` : '';
        const address = stop.address ? `<div class="route-address">${escapeRoleText(stop.address)}</div>` : '';
        const mapLink = routeMapAnchor(passengerMapPoint(schedule, stop), `${stop.name}の案内をGoogleマップで開く`);
        return `<div class="route-leg">↓ 車 ${stop.driveMinutes}分</div>
          <div class="route-stop"><span class="route-time">${escapeRoleText(stop.arrivalTime)}着 - ${escapeRoleText(stop.departureTime)}発</span><span class="route-stop-body">${escapeRoleText(stop.name)}${tags} <em class="route-dwell">乗降${stop.dwellMinutes}分</em></span>${mapLink}</div>${address}`;
      }
      if (stop.type === 'depot_end') {
        const mapLink = routeMapAnchor(facility, `${stop.name}への到着案内をGoogleマップで開く`);
        const depotAddress = facility && facility.address ? `<div class="route-address">${escapeRoleText(facility.address)}</div>` : '';
        return `<div class="route-leg">↓ 車 ${stop.driveMinutes}分</div>
          <div class="route-stop"><span class="route-time">${escapeRoleText(stop.arrivalTime)}</span><span class="route-stop-body">到着: ${escapeRoleText(stop.name)}（総所要 ${schedule.totalMinutes}分）</span>${mapLink}</div>${depotAddress}`;
      }
      return '';
    }).join('');
    const note = schedule.approximated ? '<p class="route-note">座標がない区間は登録順のまま、目安5分で積算しています。</p>' : '';
    return `<section class="route-card vehicle-plan-card"><h3 class="route-screen">${vehicleName}の巡回</h3><div class="vehicle-card-header">${vehiclePrintHeaderText(schedule)}</div><div class="route-screen">${stops}</div>${renderPrintTimelineTable(schedule)}${note}</section>`;
  }).join('');
}

function publishRouteTimeline(baseText) {
  const branded = applyPlanBrandHeader(baseText || '');
  routePlanBase = stripRouteSection(branded);
  const schedules = buildCurrentRouteSchedules();
  renderRouteTimeline(schedules);
  lastGeneratedPlan = mergeRouteIntoPlan(routePlanBase, schedules);
  const box = document.getElementById('resultText');
  if (box) box.textContent = routePlanBase;
}

function runDispatchWithRoute() {
  generateCarpool();
  const card = document.getElementById('resultCard');
  if (!card || card.style.display === 'none' || !currentAssignments) {
    routePlanBase = '';
    renderRouteTimeline([]);
    return;
  }
  publishRouteTimeline(lastGeneratedPlan);
}

/** 初回ガイド（オンボーディング） */
let tutorialSlideIndex = 0;
const TUTORIAL_SLIDE_COUNT = 3;

function syncTutorialSlideUI() {
  const modal = document.getElementById('tutorialModal');
  if (!modal) return;

  const slides = modal.querySelectorAll('.tutorial-slide');
  slides.forEach((slide, idx) => {
    const active = idx === tutorialSlideIndex;
    slide.classList.toggle('is-active', active);
    if (active) slide.removeAttribute('hidden');
    else slide.setAttribute('hidden', '');
  });

  const dots = modal.querySelectorAll('.tutorial-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('is-active', idx === tutorialSlideIndex);
  });

  const prevBtn = document.getElementById('tutorialPrevBtn');
  const nextBtn = document.getElementById('tutorialNextBtn');
  const startBtn = document.getElementById('tutorialStartBtn');
  const isLast = tutorialSlideIndex >= TUTORIAL_SLIDE_COUNT - 1;

  if (prevBtn) prevBtn.disabled = tutorialSlideIndex <= 0;
  if (nextBtn) nextBtn.hidden = isLast;
  if (startBtn) startBtn.hidden = !isLast;
}

function openTutorialModal(options) {
  const reset = !options || options.reset !== false;
  if (reset) tutorialSlideIndex = 0;
  const modal = document.getElementById('tutorialModal');
  if (!modal) return;
  syncTutorialSlideUI();
  modal.classList.add('is-open');
  modal.style.display = '';
}

function closeTutorialModal() {
  markTutorialSeen();
  const modal = document.getElementById('tutorialModal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.style.display = '';
}

function tutorialNext() {
  if (tutorialSlideIndex < TUTORIAL_SLIDE_COUNT - 1) {
    tutorialSlideIndex += 1;
    syncTutorialSlideUI();
  }
}

function tutorialPrev() {
  if (tutorialSlideIndex > 0) {
    tutorialSlideIndex -= 1;
    syncTutorialSlideUI();
  }
}

function tutorialGoto(slideIndex) {
  const idx = parseInt(slideIndex, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= TUTORIAL_SLIDE_COUNT) return;
  tutorialSlideIndex = idx;
  syncTutorialSlideUI();
}

function maybeShowTutorialOnLaunch() {
  if (!hasSeenTutorial()) {
    openTutorialModal({ reset: true });
  }
}

bindCarReorderGestures();
bindPlacePickerFields();
bindFacilityPlaceFields();
syncAppBrand();
window.addEventListener('beforeprint', syncPrintHeader);


  const HaishaUI = {
    renderCars,
    renderChildren,
    refreshLists,
    updateStatusBar,
    openCompanionEditor: openChildCompanionEditor,
    openChildCompanionEditor,
    toggleSection,
    toggleSettingsPanel,
    applySectionOpenState,
    applySettingsPanelState,
    toggleCar,
    updateCapacity,
    toggleEquipmentCar,
    commitCarRename,
    setChildAttend,
    setChildFixedCar,
    addCompanion,
    addCompanionCustom,
    removeCompanion,
    addChildCompanion,
    addChildCompanionCustom,
    removeChildCompanion,
    addCar,
    addChild,
    deleteCar,
    deleteChild,
    openEditModal,
    closeEditModal,
    saveEditChild,
    sortCarsByName,
    sortChildrenByGrade,
    sortChildrenByName,
    setChildSortMode,
    readChildSortMode,
    writeChildSortMode,
    getSortedChildrenForRender,
    setCarSortMode,
    readCarSortMode,
    writeCarSortMode,
    toggleCarSortMode,
    getSortedCarsForRender,
    moveCar,
    reorderCar,
    formatCarCompanionHeader,
    setCarDriverRole,
    setCarAssistantRole,
    renderRoleMaster,
    switchMasterTab,
    addRoleFromInput,
    renameRole,
    editRoleColor,
    toggleRoleFlag,
    deleteRole,
    addCareTagFromInput,
    renameCareTag,
    editCareTagColor,
    toggleCareTagDisperse,
    deleteCareTag,
    toggleCarePill,
    syncMotionSickPills,
    renderCarePills,
    toggleRoleMaster,
    addDriverRoleFromInput,
    addCompanionRoleFromInput,
    removeDriverRole,
    removeCompanionRole,
    resetRoleLabelsToDefault,
    syncDispatchPeriodSelect,
    getSelectedServiceDate,
    setServiceDate,
    setServiceWeekday,
    syncServiceDateBar,
    renderSchedulePills,
    toggleScheduleDay,
    togglePassengerDayStatus,
    runDispatchWithRoute,
    printDispatchSheet,
    syncAppBrand,
    searchFacilityPlace,
    saveFacilityPlace,
    togglePlacePicker,
    searchPlace,
    setDepartureTime,
    setFacilityName,
    setFacilityCoord,
    syncFacilityInputs,
    get childSortMode() { return childSortMode; },
    get carSortMode() { return carSortMode; },
    openRestoreModal,
    closeRestoreModal,
    applyRestore,
    openTutorialModal,
    closeTutorialModal,
    tutorialNext,
    tutorialPrev,
    tutorialGoto,
    maybeShowTutorialOnLaunch,
    updateCarSelectOptions,
    get openChildCompanionEditors() { return openChildCompanionEditors; }
  };
  global.HaishaUI = HaishaUI;

  const uiCompatFns = Object.keys(HaishaUI).filter((k) => typeof HaishaUI[k] === 'function');
  uiCompatFns.forEach((name) => { global[name] = HaishaUI[name]; });
  // 明示エイリアス
  global.openCompanionEditor = openChildCompanionEditor;
  global.openChildCompanionEditors = openChildCompanionEditors;

})(typeof window !== 'undefined' ? window : globalThis);
