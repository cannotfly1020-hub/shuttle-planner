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
  const text = textOrEmpty(passengerGroupClass(passenger));
  if (!text) return '';
  if (/^\d+$/.test(text)) return `${text}年`;
  return text;
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

function applyLegacyPositionField(passenger, raw) {
  if (!passenger) return;
  const pos = textOrEmpty(raw) || '未定';
  passenger.pos = pos;
  passenger.positions = pos && pos !== '未定' ? [pos] : [];
  if (!isLegacyPositionLabel(pos)) {
    const kept = listFromUnknown(passenger.careTags).filter((tag) => tag.indexOf('酔') === -1);
    passenger.careTags = kept.concat([pos]);
  }
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
}

/** 運転者。driverRole を優先し、旧 driver にフォールバック */
function vehicleDriverLabel(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') return '';
  const role = textOrEmpty(vehicle.driverRole);
  if (role) return role;
  return textOrEmpty(vehicle.driver);
}

function fixedVehicleAutoLabel(passenger) {
  const name = passengerFixedVehicleName(passenger);
  if (name) return `自動（固定:${name}）`;
  return '自動（指定なし）';
}

function buildCareTagBadgesHtml(passenger) {
  return passengerCareTags(passenger).map((tag) => {
    const safe = escapeRoleText(tag);
    return `<span class="badge ${careTagBadgeClass(tag)} badge-care" title="要配慮">${safe}</span>`;
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
}

function applySettingsPanelState() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  const isOpen = readSectionOpenState('settings', false);
  panel.classList.toggle('is-open', isOpen);
  const toggle = panel.querySelector('.panel-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
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
      carsSummary.textContent = `出勤 ${carCount}台 / ${seatCount}席（${Math.abs(remaining)}席不足）`;
    } else {
      carsSummary.textContent = `出勤 ${carCount}台 / ${seatCount}席`;
    }
    carsSummary.hidden = false;
  }
  if (childrenSummary) {
    childrenSummary.textContent = `利用 ${kidCount}名`;
    childrenSummary.hidden = false;
  }
}

function updateStatusBar() {
  const activeKids = children.filter(isParticipating).length;
  const onSiteKids = children.filter(isOnSite).length;
  const activeCarsList = cars.filter(c => c.active);
  const kidSeats = children.reduce((sum, c) => sum + seatCost(c), 0);
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
  addSelect.innerHTML = '<option value="">固定車両: なし</option>';
  cars.forEach(c => {
    addSelect.innerHTML += `<option value="${c.name}">${c.name}</option>`;
  });
  addSelect.value = currentAddVal;

  if (editSelect) {
    let currentEditVal = editSelect.value;
    editSelect.innerHTML = '<option value="">固定車両: なし</option>';
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
  const companions = companionsOf(car)
    .map((item) => (item && item.label ? String(item.label).trim() : ''))
    .filter((label) => label && label !== role);
  const parts = role ? [role, ...companions] : companions;
  if (!parts.length) return '';
  return `（${parts.join('、')}）`;
}

function buildDriverSelectHtml(car) {
  const roles = getDriverRoles();
  const current = vehicleDriverLabel(car);
  const options = roles.slice();
  if (current && options.indexOf(current) === -1) options.unshift(current);
  if (!options.length) options.push(current || '父');
  const selected = options.indexOf(current) !== -1 ? current : options[0];
  const html = options.map((role) => {
    const safe = escapeRoleText(role);
    return `<option value="${safe}" ${selected === role ? 'selected' : ''}>${safe}</option>`;
  }).join('');
  return `<label class="driver-select-label"><span>運転:</span><select class="car-driver-select" data-action="set-car-driver" data-id="${car.id}" data-car-id="${car.id}" aria-label="本日の運転者">${html}</select></label>`;
}

function setCarDriverRole(id, role) {
  const car = cars.find((item) => String(item.id) === String(id));
  if (!car) return;
  const next = typeof role === 'string' ? role.trim().slice(0, 20) : '';
  if (!next || car.driverRole === next) return;
  car.driverRole = next;
  saveData();
}

function buildQuickRoleButtonsHtml(labels, action, ownerId, disabled) {
  return labels.map((label) => {
    const safe = escapeRoleText(label);
    return `<button type="button" class="companion-quick" data-action="${action}" data-id="${ownerId}" data-label="${safe}" ${disabled ? 'disabled' : ''}>${safe}</button>`;
  }).join('');
}

function renderRoleTagList(elementId, labels, action) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!labels.length) {
    el.innerHTML = '<span class="role-tag-empty">ラベルがありません</span>';
    return;
  }
  el.innerHTML = labels.map((label) => {
    const safe = escapeRoleText(label);
    return `<span class="role-tag">${safe}<button type="button" class="role-tag-delete" data-action="${action}" data-label="${safe}" aria-label="${safe}を削除">×</button></span>`;
  }).join('');
}

function renderRoleMaster() {
  renderRoleTagList('driverRoleTags', getDriverRoles(), 'remove-driver-role');
  renderRoleTagList('companionRoleTags', getCompanionRoles(), 'remove-companion-role');
}

function toggleRoleMaster() {
  const box = document.getElementById('roleMasterContainer');
  const btn = document.getElementById('btnToggleRoleMaster');
  if (!box || !btn) return;
  const willOpen = box.hidden;
  box.hidden = !willOpen;
  btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  btn.textContent = willOpen
    ? '🏷️ 運転者・同乗者ラベルを編集 ▲'
    : '🏷️ 運転者・同乗者ラベルを編集 ▼';
}

function addRoleLabel(inputId, getter, saver, emptyMessage) {
  const input = document.getElementById(inputId);
  const name = input ? input.value.trim() : '';
  if (!name) {
    alert(emptyMessage);
    return;
  }
  const list = getter();
  if (list.indexOf(name) !== -1) {
    alert('すでに登録されています。');
    return;
  }
  list.push(name);
  saver(list);
  if (input) input.value = '';
  renderCars();
  renderChildren();
}

function addDriverRoleFromInput() {
  addRoleLabel('driverRoleInput', getDriverRoles, saveDriverRoles, '運転者ラベルを入力してください。');
}

function addCompanionRoleFromInput() {
  addRoleLabel('companionRoleInput', getCompanionRoles, saveCompanionRoles, '同乗者ラベルを入力してください。');
}

function removeRoleLabel(label, getter, saver) {
  const name = typeof label === 'string' ? label.trim() : '';
  if (!name) return;
  saver(getter().filter((item) => item !== name));
  renderCars();
  renderChildren();
}

function removeDriverRole(label) {
  removeRoleLabel(label, getDriverRoles, saveDriverRoles);
}

function removeCompanionRole(label) {
  removeRoleLabel(label, getCompanionRoles, saveCompanionRoles);
}

function resetRoleLabelsToDefault() {
  resetRoleLabels();
  const driverInput = document.getElementById('driverRoleInput');
  const companionInput = document.getElementById('companionRoleInput');
  if (driverInput) driverInput.value = '';
  if (companionInput) companionInput.value = '';
  renderCars();
  renderChildren();
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
    const inactiveClass = car.active ? '' : 'is-inactive';
    const fullBlock = summary.isFull || summary.isOver;
    const addDisabled = !car.active || fullBlock ? 'disabled' : '';
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
            <input type="checkbox" data-action="toggle-car" data-id="${car.id}" ${car.active ? 'checked' : ''}>
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

function renderChildren() {
  const list = document.getElementById('childList');
  if (!list) return;
  list.innerHTML = '';
  const select = document.getElementById('childSortModeSelect');
  if (select && select.value !== childSortMode) select.value = childSortMode;

  getSortedChildrenForRender().forEach((c) => {
    const mode = getAttendMode(c);
    const fixedDisabled = mode !== 'ride' ? 'disabled' : '';
    const companionDisabled = mode !== 'ride' ? 'disabled' : '';
    if (mode !== 'ride') openChildCompanionEditors.delete(Number(c.id));
    const editorOpen = mode === 'ride' && openChildCompanionEditors.has(Number(c.id));
    const chipsHtml = buildChildCompanionChipsHtml(c);

    const groupLabel = formatGroupClassLabel(c);
    const fixedVehicleName = passengerFixedVehicleName(c);
    const careBadges = buildCareTagBadgesHtml(c);

    list.innerHTML += `
      <div class="item-row item-row-child">
        <div class="item-main">
          <div class="child-top-row">
            <select class="attend-select" data-action="set-attend" data-id="${c.id}">
              <option value="off" ${mode === 'off' ? 'selected' : ''}>欠席</option>
              <option value="ride" ${mode === 'ride' ? 'selected' : ''}>乗車</option>
              <option value="site" ${mode === 'site' ? 'selected' : ''}>現地</option>
            </select>
            <span class="child-name">${c.name}</span>
            ${chipsHtml}
            ${mode === 'ride' && !editorOpen ? `
              <button type="button" class="btn-add-companion" data-action="open-child-companion" data-id="${c.id}">＋同乗</button>
            ` : ''}
            ${groupLabel ? `<span class="badge-sub">${escapeRoleText(groupLabel)}</span>` : ''}
            ${careBadges}
            ${fixedVehicleName ? `<span class="badge">固定:${escapeRoleText(fixedVehicleName)}</span>` : ''}
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
  });
}

function refreshLists() {
  renderCars();
  renderChildren();
  updateStatusBar();
}

function toggleCar(id, checked) {
  const c = cars.find(x => x.id === id);
  if (!c) return;
  c.active = typeof checked === 'boolean' ? checked : !c.active;
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
  const ch = children.find(x => x.id === id);
  if (!ch) return;
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
  if (!car || !car.active || !name) return;

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

/* 編集機能 */
function openEditModal(id) {
  const kid = children.find(x => x.id === id);
  if (!kid) return;
  document.getElementById('editChildId').value = kid.id;
  document.getElementById('editChildName').value = kid.name;
  document.getElementById('editChildGrade').value = passengerGroupClass(kid) || 6;
  document.getElementById('editChildPos').value = legacyPositionLabel(kid) || '未定';
  document.getElementById('editChildMotionSick').checked = !!kid.motionSick;
  updateCarSelectOptions();
  document.getElementById('editChildParentCar').value = passengerFixedVehicleName(kid);
  const fixedSelect = document.getElementById('editChildFixedCar');
  if (fixedSelect) {
    fixedSelect.innerHTML = buildFixedCarOptionsHtml(kid.fixedCar || '', kid);
  }
  const editModal = document.getElementById('editModal');
  editModal.classList.add('is-open');
  editModal.style.display = '';
}

function closeEditModal() {
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
    applyLegacyPositionField(kid, document.getElementById('editChildPos').value);
    applyFixedVehicle(kid, document.getElementById('editChildParentCar').value);
    kid.motionSick = document.getElementById('editChildMotionSick').checked;
    syncMotionCareTag(kid);

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
  const gradeRaw = gradeInput ? gradeInput.value : '';
  const gradeNumber = parseInt(gradeRaw, 10);
  const grade = gradeRaw === '' || Number.isNaN(gradeNumber) ? (gradeRaw || 6) : gradeNumber;
  const pos = posInput ? posInput.value : '';
  const parent = parentSelect ? parentSelect.value : '';
  const motionSick = !!(motionInput && motionInput.checked);
  const careTags = [];
  if (pos && !isLegacyPositionLabel(pos)) careTags.push(pos);
  if (motionSick && careTags.indexOf('車酔い配慮') === -1) careTags.push('車酔い配慮');

  if (name) {
    children.push(normalizeChild({
      id: Date.now(),
      name: name,
      grade: grade,
      groupClass: grade,
      pos: pos,
      positions: pos && pos !== '未定' ? [pos] : [],
      careTags: careTags,
      parentCar: parent,
      fixedVehicle: parent,
      fixedCar: '',
      motionSick: motionSick,
      companions: [],
      active: true,
      meetOnSite: false,
      lastCar: '',
      rideHistory: {}
    }));
    saveData();
    refreshLists();
    if (nameInput) nameInput.value = '';
    if (parentSelect) parentSelect.value = '';
    if (motionInput) motionInput.checked = false;
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
    renderRoleMaster,
    toggleRoleMaster,
    addDriverRoleFromInput,
    addCompanionRoleFromInput,
    removeDriverRole,
    removeCompanionRole,
    resetRoleLabelsToDefault,
    syncDispatchPeriodSelect,
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
