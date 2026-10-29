(function (global) {
function createDefaultCars() {
  return [
    { id: 1, name: '1号車', capacity: 4, active: true, companions: [], isEquipmentCar: false },
    { id: 2, name: '2号車', capacity: 4, active: true, companions: [], isEquipmentCar: false },
    { id: 3, name: 'リフト車', capacity: 2, active: true, companions: [], isEquipmentCar: true }
  ];
}

function normalizeCompanion(item, fallbackId) {
  if (!item || typeof item !== 'object') return null;
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  if (!label) return null;
  return {
    id: item.id != null ? item.id : fallbackId,
    label: label
  };
}

const DEFAULT_DRIVER_ROLES = ['ドライバー', '職員', '添乗員', 'その他'];
const DEFAULT_COMPANION_ROLES = ['職員', '添乗員', '看護師', '保護者', 'その他'];
const LEGACY_FAMILY_ROLES = new Set(['父', '母', '祖父', '祖母', '兄', '弟', '姉', '妹', 'コーチ']);
const DRIVER_ROLES_KEY = 'cp_driver_roles';
const COMPANION_ROLES_KEY = 'cp_companion_roles';
const ROLE_LABEL_MAX = 20;

function sanitizeRoleList(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const list = [];
  value.forEach((item) => {
    const label = typeof item === 'string' ? item.trim() : '';
    if (!label || label.length > ROLE_LABEL_MAX || seen.has(label)) return;
    seen.add(label);
    list.push(label);
  });
  return list;
}

function readRoleList(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return defaults.slice();
    const parsed = JSON.parse(raw);
    const list = sanitizeRoleList(parsed);
    if (!list) return defaults.slice();
    const kept = list.filter((item) => !LEGACY_FAMILY_ROLES.has(item));
    if (kept.length !== list.length) {
      const next = kept.length ? kept : defaults.slice();
      writeRoleList(key, next);
      return next;
    }
    return list;
  } catch (e) {
    return defaults.slice();
  }
}

function writeRoleList(key, list) {
  const clean = sanitizeRoleList(list) || [];
  try {
    localStorage.setItem(key, JSON.stringify(clean));
  } catch (e) { /* 容量不足などは無視 */ }
  return clean;
}

function getDriverRoles() {
  return readRoleList(DRIVER_ROLES_KEY, DEFAULT_DRIVER_ROLES);
}

function saveDriverRoles(list) {
  return writeRoleList(DRIVER_ROLES_KEY, list);
}

function getCompanionRoles() {
  return readRoleList(COMPANION_ROLES_KEY, DEFAULT_COMPANION_ROLES);
}

function saveCompanionRoles(list) {
  return writeRoleList(COMPANION_ROLES_KEY, list);
}

function resetRoleLabels() {
  saveDriverRoles(DEFAULT_DRIVER_ROLES);
  saveCompanionRoles(DEFAULT_COMPANION_ROLES);
}

function normalizeDriverRole(value) {
  const role = typeof value === 'string' ? value.trim() : '';
  if (!role || LEGACY_FAMILY_ROLES.has(role)) return 'ドライバー';
  return role.slice(0, ROLE_LABEL_MAX);
}

function normalizeCar(car) {
  let companions = [];
  if (Array.isArray(car.companions)) {
    companions = car.companions
      .map((item, idx) => normalizeCompanion(item, `cmp-${car.id}-${idx}`))
      .filter(Boolean);
  }

  // 旧 familySeats（人数のみ）からの移行
  const legacyFamily = Math.max(0, parseInt(car.familySeats, 10) || 0);
  if (companions.length === 0 && legacyFamily > 0) {
    for (let i = 0; i < legacyFamily; i++) {
      companions.push({ id: `legacy-family-${car.id}-${i}`, label: '身内' });
    }
  }

  return {
    id: car.id,
    name: typeof car.name === 'string' ? car.name : '',
    capacity: Math.max(0, parseInt(car.capacity, 10) || 0),
    active: !!car.active,
    companions: companions,
    isEquipmentCar: !!car.isEquipmentCar,
    driverRole: normalizeDriverRole(car.driverRole),
    dispatchHistory: normalizeDispatchHistory(car.dispatchHistory)
  };
}

const DISPATCH_PERIOD_KEY = 'cp_dispatch_period';
const DISPATCH_PERIODS = new Set([30, 90, 180]);

function localDateString(date) {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeDispatchDate(entry) {
  if (typeof entry === 'number' && Number.isFinite(entry)) {
    const date = new Date(entry);
    if (Number.isNaN(date.getTime())) return null;
    return localDateString(date);
  }
  if (typeof entry === 'string') {
    const match = entry.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (entry && typeof entry === 'object') {
    if (entry.date != null) return normalizeDispatchDate(entry.date);
    if (entry.ts != null) return normalizeDispatchDate(entry.ts);
  }
  return null;
}

function normalizeDispatchHistory(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((entry) => {
    const ymd = normalizeDispatchDate(entry);
    if (ymd) out.push(ymd);
  });
  return out;
}

function getDispatchPeriod() {
  try {
    const n = Number(localStorage.getItem(DISPATCH_PERIOD_KEY));
    if (DISPATCH_PERIODS.has(n)) return n;
  } catch (e) { /* ignore */ }
  return 90;
}

function setDispatchPeriod(days) {
  const n = Number(days);
  const next = DISPATCH_PERIODS.has(n) ? n : 90;
  try {
    localStorage.setItem(DISPATCH_PERIOD_KEY, String(next));
  } catch (e) { /* ignore */ }
  return next;
}

function dispatchAgeDays(ymd, todayYmd) {
  const [y1, m1, d1] = ymd.split('-').map(Number);
  const [y2, m2, d2] = todayYmd.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function getCarDispatchCount(car, days) {
  try {
    const period = Number(days);
    if (!car || !Number.isFinite(period) || period <= 0) return 0;
    const history = Array.isArray(car.dispatchHistory) ? car.dispatchHistory : [];
    const today = localDateString();
    let count = 0;
    history.forEach((entry) => {
      const ymd = normalizeDispatchDate(entry);
      if (!ymd) return;
      const age = dispatchAgeDays(ymd, today);
      if (age >= 0 && age < period) count += 1;
    });
    return count;
  } catch (e) {
    return 0;
  }
}

function companionsOf(car) {
  if (!car || !Array.isArray(car.companions)) return [];
  return car.companions;
}

function companionSeatsOf(car) {
  return companionsOf(car).length;
}

// 互換エイリアス（旧コード参照用）
function familySeatsOf(car) {
  return companionSeatsOf(car);
}

function createDefaultChildren() {
  return [
    { id: 1, name: 'ゆうと', groupClass: '小学部', grade: '小学部', careTags: ['見守り'], pos: '', parentCar: '1号車', fixedVehicle: '1号車', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {} },
    { id: 2, name: 'そうた', groupClass: '小学部', grade: '小学部', careTags: [], pos: '', parentCar: '2号車', fixedVehicle: '2号車', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {} },
    { id: 3, name: 'れん', groupClass: 'A組', grade: 'A組', careTags: ['車酔い配慮'], pos: '', parentCar: '', fixedVehicle: '', fixedCar: '', motionSick: true, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {} },
    { id: 4, name: 'はると', groupClass: 'A組', grade: 'A組', careTags: ['車椅子'], pos: '', parentCar: '', fixedVehicle: '', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {} },
    { id: 5, name: 'こうき', groupClass: 'デイ', grade: 'デイ', careTags: [], pos: '', parentCar: '', fixedVehicle: '', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {} },
    { id: 6, name: '大和', groupClass: 'デイ', grade: 'デイ', careTags: ['見守り'], pos: '', parentCar: 'リフト車', fixedVehicle: 'リフト車', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {} }
  ];
}

function normalizeChildCompanions(child) {
  const meetOnSite = !!child.meetOnSite;
  if (Array.isArray(child.companions)) {
    return child.companions
      .map((item, idx) => normalizeCompanion(item, `ch-cmp-${child.id}-${idx}`))
      .filter(Boolean);
  }

  // 旧 guardianRide / guardianName（1人）からの移行
  if (!meetOnSite && child.guardianRide) {
    const label = (typeof child.guardianName === 'string' ? child.guardianName : '').trim() || '保護者';
    return [{ id: `legacy-guardian-${child.id}`, label: label }];
  }
  return [];
}

function normalizeChild(child) {
  const meetOnSite = !!child.meetOnSite;
  const companions = meetOnSite ? [] : normalizeChildCompanions(child);
  return {
    ...child,
    active: !!child.active,
    meetOnSite: meetOnSite,
    companions: companions,
    motionSick: !!child.motionSick,
    parentCar: typeof child.parentCar === 'string' ? child.parentCar : '',
    fixedCar: typeof child.fixedCar === 'string' ? child.fixedCar : '',
    lastCar: typeof child.lastCar === 'string' ? child.lastCar : '',
    rideHistory: child.rideHistory && typeof child.rideHistory === 'object' && !Array.isArray(child.rideHistory) ? child.rideHistory : {}
  };
}

function childCompanionsOf(child) {
  if (!child || !Array.isArray(child.companions)) return [];
  return child.companions;
}

function childCompanionSeatsOf(child) {
  return childCompanionsOf(child).length;
}

function isParticipating(child) {
  return !!child && !!child.active;
}

function isOnSite(child) {
  return isParticipating(child) && !!child.meetOnSite;
}

function isRiding(child) {
  return isParticipating(child) && !child.meetOnSite;
}

function seatCost(child) {
  if (!isRiding(child)) return 0;
  return 1 + childCompanionSeatsOf(child);
}

function formatRiderLabel(child, carName, options) {
  const showPin = !options || options.showPin !== false;
  const pinned = showPin && child.fixedCar && carName && child.fixedCar === carName ? '📌' : '';
  const sick = child.motionSick ? '🤢' : '';
  const comps = childCompanionsOf(child);
  const companion = comps.length > 0 ? `（＋${comps.map(c => c.label).join('、')}）` : '';
  return `${pinned}${child.name}${sick}${companion}`;
}

function autoFixedLabel(child) {
  const name = child && (child.fixedVehicle || child.parentCar);
  if (name) return `自動（拘束:${name}）`;
  return '自動（指定なし）';
}

function getAttendMode(child) {
  if (!child.active) return 'off';
  return child.meetOnSite ? 'site' : 'ride';
}

function setAttendMode(child, mode) {
  if (mode === 'off') {
    child.active = false;
    child.meetOnSite = false;
    child.companions = [];
    child.fixedCar = '';
  } else if (mode === 'site') {
    child.active = true;
    child.meetOnSite = true;
    child.companions = [];
    child.fixedCar = '';
  } else {
    child.active = true;
    child.meetOnSite = false;
  }
}

function getFixedRidersForCar(carName) {
  if (!carName) return [];
  return children.filter(c => isRiding(c) && c.fixedCar === carName);
}

function fixedSeatsUsed(carName) {
  return getFixedRidersForCar(carName).reduce((sum, c) => sum + seatCost(c), 0);
}

function carSeatSummary(car) {
  const capacity = parseInt(car.capacity, 10) || 0;
  const companions = companionSeatsOf(car);
  const guests = fixedSeatsUsed(car.name);
  const used = companions + guests;
  const remaining = capacity - used;
  return {
    capacity,
    companions,
    guests,
    used,
    remaining,
    isFull: remaining <= 0,
    isOver: remaining < 0
  };
}

function canFitOnCar(car, extraSeats, excludeChildId) {
  if (!car) return false;
  const summary = carSeatSummary(car);
  let used = summary.used;
  if (excludeChildId != null) {
    const existing = children.find(c => c.id === excludeChildId);
    if (existing && existing.fixedCar === car.name && isRiding(existing)) {
      used -= seatCost(existing);
    }
  }
  return used + extraSeats <= summary.capacity;
}

function newCompanionId() {
  return `cmp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * 車両改名時の参照カスケード:
 * 全選手の parentCar / fixedCar / rideHistory / lastCar を oldName → newName に同期する。
 */
function renameCarCascade(car, oldName, newName) {
  if (!car || !oldName || !newName || oldName === newName) return;

  children.forEach((child) => {
    if (child.parentCar === oldName) child.parentCar = newName;
    if (child.fixedCar === oldName) child.fixedCar = newName;
    if (child.lastCar === oldName) child.lastCar = newName;

    if (child.rideHistory && typeof child.rideHistory === 'object' && !Array.isArray(child.rideHistory)) {
      if (Object.prototype.hasOwnProperty.call(child.rideHistory, oldName)) {
        const migrated = child.rideHistory[oldName] || 0;
        child.rideHistory[newName] = (child.rideHistory[newName] || 0) + migrated;
        delete child.rideHistory[oldName];
      }
    }
  });

  // メモリ上の直近配車結果キーも追随（永続化対象外）
  if (typeof currentAssignments !== 'undefined' && currentAssignments && currentAssignments[oldName]) {
    currentAssignments[newName] = currentAssignments[oldName];
    delete currentAssignments[oldName];
  }

  car.name = newName;
}

/**
 * 車両名を更新し、選手側の名前参照をすべて連動更新して保存する。
 * @returns {boolean} 実際に改名した場合 true
 */
function renameCar(carId, newName) {
  const car = cars.find((c) => String(c.id) === String(carId));
  if (!car) return false;

  const oldName = car.name;
  const trimmed = typeof newName === 'string' ? newName.trim() : '';
  if (!trimmed || trimmed === oldName) return false;

  if (cars.some((c) => String(c.id) !== String(carId) && c.name === trimmed)) {
    alert(`「${trimmed}」は既に別の車両で使われています。別の名前にしてください。`);
    return false;
  }

  renameCarCascade(car, oldName, trimmed);
  saveData();
  return true;
}

let cars = [];
let children = [];

function loadData() {
  try {
    const loadedCars = JSON.parse(localStorage.getItem('cp_cars')) || createDefaultCars();
    cars = loadedCars.map(normalizeCar);
  } catch (e) {
    cars = createDefaultCars();
  }

  try {
    const loaded = JSON.parse(localStorage.getItem('cp_children')) || createDefaultChildren();
    children = loaded.map(normalizeChild);
  } catch (e) {
    children = createDefaultChildren();
  }

  // 旧 guardianRide / guardianName を companions 配列へ正規化して永続化
  let changed = false;
  children.forEach(ch => {
    if (ch.guardianRide != null || ch.guardianName != null) {
      delete ch.guardianRide;
      delete ch.guardianName;
      changed = true;
    }
    if (!Array.isArray(ch.companions)) {
      ch.companions = [];
      changed = true;
    }
  });
  if (changed) {
    try {
      localStorage.setItem('cp_children', JSON.stringify(children));
    } catch (e) { /* ignore */ }
  }
}

loadData();

function saveData() {
  try {
    localStorage.setItem('cp_cars', JSON.stringify(cars));
    localStorage.setItem('cp_children', JSON.stringify(children));
  } catch (e) {
    console.error("保存エラー:", e);
  }
}

const TUTORIAL_SEEN_KEY = 'cp_tutorial_seen';

function hasSeenTutorial() {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function markTutorialSeen() {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
  } catch (e) { /* ignore */ }
}

function manualSave() {
  saveData();
  alert("💾 現在の登録内容とチェック状態を保存しました！");
}

/**
 * 次回運用向けリセット:
 * 出欠・同乗・指定枠・車両同乗・配車結果のみクリア。
 * 選手/車両マスタと rideHistory・lastCar は保持。
 */
function resetTodaySession() {
  const msg = '出欠・同乗・指定枠を初期化して、次回の運行を開始しますか？\n（利用者・車両リストと運行履歴は消えません）';
  if (!confirm(msg)) return;

  cars.forEach(c => {
    c.active = true;
    c.companions = [];
    c.isEquipmentCar = false; // 道具車は週ごとに変わるため毎回クリア
  });

  children.forEach(c => {
    // 既存の初期状態に合わせ、全員「乗車」に戻す（マスタ情報は触らない）
    c.active = true;
    c.meetOnSite = false;
    c.companions = [];
    c.fixedCar = '';
  });

  if (typeof openChildCompanionEditors !== 'undefined' && openChildCompanionEditors.clear) {
    openChildCompanionEditors.clear();
  }

  currentAssignments = null;
  lastGeneratedPlan = '';
  if (typeof clearLastSessionCommit === 'function') clearLastSessionCommit();
  const resultCard = document.getElementById('resultCard');
  if (resultCard) resultCard.style.display = 'none';
  const resultText = document.getElementById('resultText');
  if (resultText) resultText.textContent = '';
  if (typeof clearCarpoolDiagnosis === 'function') clearCarpoolDiagnosis();

  saveData();
  renderCars();
  renderChildren();
  updateStatusBar();
}

/** @deprecated 互換: 旧「出欠チェック全解除」→ 本日リセットへ誘導 */
function clearAllChecks() {
  resetTodaySession();
}

function resetAllData() {
  if (confirm("登録した車・子供・履歴データをすべて初期状態に消去しますか？")) {
    if (typeof clearLastSessionCommit === 'function') clearLastSessionCommit();
    try { sessionStorage.removeItem('cp_lastSessionCommit'); } catch (e) { /* ignore */ }
    localStorage.clear();
    location.reload();
  }
}

function isBackupCar(car) {
  return !!car && typeof car === 'object' && typeof car.name === 'string' && car.name.trim() !== '' && car.id != null;
}

function isBackupChild(child) {
  return !!child && typeof child === 'object' && typeof child.name === 'string' && child.name.trim() !== '' && child.id != null;
}

function buildBackupPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    cars: cars,
    children: children
  };
}

/** iOS Safari でも動くクリップボード書き込み（Clipboard API → execCommand フォールバック） */
function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
  }
  return Promise.resolve().then(() => copyTextFallback(text));
}

function copyTextFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  if (!ok) throw new Error('clipboard copy failed');
}

function isShareCanceledError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const msg = String(err.message || err.errorMessage || err);
  return /cancel/i.test(msg);
}

/**
 * 配車表テキスト共有（クリップボード退避 → Capacitor Share → Web Share → alert）
 * Capacitor ネイティブ: window.Capacitor.Plugins.Share
 */
async function shareDispatchText(text) {
  const payload = text == null ? '' : String(text);

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(payload);
    } else {
      copyTextFallback(payload);
    }
  } catch (e) {
    try {
      copyTextFallback(payload);
    } catch (fallbackErr) {
      console.error('clipboard copy failed before share:', fallbackErr);
    }
  }

  const shareOpts = {
    title: '運行計画',
    text: payload,
    dialogTitle: '運行計画テキストをコピー'
  };

  const CapShare = (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins)
    ? window.Capacitor.Plugins.Share
    : null;

  if (CapShare && typeof CapShare.share === 'function') {
    try {
      await CapShare.share(shareOpts);
      return;
    } catch (err) {
      if (isShareCanceledError(err)) return;
      console.error('Capacitor Share error:', err);
    }
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: shareOpts.title,
        text: shareOpts.text
      });
      return;
    } catch (err) {
      if (isShareCanceledError(err)) return;
      console.error('navigator.share error:', err);
    }
  }

  alert('クリップボードにコピーしました');
}

function copyBackupData() {
  const payload = JSON.stringify(buildBackupPayload(), null, 2);
  copyTextToClipboard(payload).then(() => {
    alert('バックアップ用テキストをコピーしました！LINEの自分用トークやメモ帳に貼り付けて保管してください');
  }).catch(() => {
    alert('コピーに失敗しました。ブラウザの権限を確認するか、別のブラウザでお試しください。');
  });
}

function restoreBackupData(text) {
  const raw = (text || '').trim();
  if (!raw) {
    alert('退避テキストを貼り付けてください。');
    return false;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    alert('退避テキストの形式が正しくありません。コピーしたデータをそのまま貼り付けてください。');
    return false;
  }

  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.cars) ||
    !Array.isArray(data.children) ||
    !data.cars.every(isBackupCar) ||
    !data.children.every(isBackupChild)
  ) {
    alert('退避テキストの形式が正しくありません。コピーしたデータをそのまま貼り付けてください。');
    return false;
  }

  if (!confirm('現在のデータを退避テキストの内容で上書きします。よろしいですか？')) {
    return false;
  }

  cars = data.cars.map(normalizeCar);
  children = data.children.map(normalizeChild);
  saveData();
  renderCars();
  renderChildren();
  updateStatusBar();

  if (typeof openChildCompanionEditors !== 'undefined' && openChildCompanionEditors.clear) {
    openChildCompanionEditors.clear();
  }

  const resultCard = document.getElementById('resultCard');
  if (resultCard) resultCard.style.display = 'none';
  const resultText = document.getElementById('resultText');
  if (resultText) resultText.textContent = '';
  currentAssignments = null;
  lastGeneratedPlan = '';

  alert('データを正常に復元しました');
  return true;
}

/* 一括進級機能 */
function promoteAllGrades() {
  if (confirm('全員の区分表記を確認しますか？\n自由記述の区分は自動では繰り上がりません。数値だけの区分だけ +1 します。')) {
    children.forEach(c => {
      const text = c.grade == null ? '' : String(c.grade).trim();
      const n = parseInt(text, 10);
      if (text !== '' && String(n) === text && n < 12) {
        c.grade = n + 1;
        if (c.groupClass == null || String(c.groupClass).trim() === text) c.groupClass = c.grade;
      }
    });
    saveData();
    renderCars();
    renderChildren();
    updateStatusBar();
  }
}


  const HaishaData = {
    get cars() { return cars; },
    set cars(v) { cars = v; },
    get children() { return children; },
    set children(v) { children = v; },
    loadData,
    saveData,
    manualSave,
    hasSeenTutorial,
    markTutorialSeen,
    renameCar,
    renameCarCascade,
    resetTodaySession,
    clearAllChecks,
    resetAllData,
    copyBackupData,
    shareDispatchText,
    restoreBackupData,
    promoteAllGrades,
    copyTextToClipboard,
    normalizeCar,
    getDispatchPeriod,
    setDispatchPeriod,
    getCarDispatchCount,
    getDriverRoles,
    saveDriverRoles,
    getCompanionRoles,
    saveCompanionRoles,
    resetRoleLabels,
    localDateString,
    normalizeChild,
    normalizeCompanion,
    companionsOf,
    companionSeatsOf,
    familySeatsOf,
    childCompanionsOf,
    childCompanionSeatsOf,
    isParticipating,
    isOnSite,
    isRiding,
    seatCost,
    formatRiderLabel,
    autoFixedLabel,
    getAttendMode,
    setAttendMode,
    getFixedRidersForCar,
    fixedSeatsUsed,
    carSeatSummary,
    canFitOnCar,
    newCompanionId,
    buildBackupPayload
  };
  global.HaishaData = HaishaData;

  Object.defineProperty(global, 'cars', {
    get() { return cars; },
    set(v) { cars = v; },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(global, 'children', {
    get() { return children; },
    set(v) { children = v; },
    configurable: true,
    enumerable: true
  });

  // 後方互換: 既存のグローバル呼び出しを維持
  global.loadData = loadData;
  global.saveData = saveData;
  global.manualSave = manualSave;
  global.hasSeenTutorial = hasSeenTutorial;
  global.markTutorialSeen = markTutorialSeen;
  global.renameCar = renameCar;
  global.renameCarCascade = renameCarCascade;
  global.resetTodaySession = resetTodaySession;
  global.clearAllChecks = clearAllChecks;
  global.resetAllData = resetAllData;
  global.copyBackupData = copyBackupData;
  global.shareDispatchText = shareDispatchText;
  global.restoreBackupData = restoreBackupData;
  global.promoteAllGrades = promoteAllGrades;
  global.copyTextToClipboard = copyTextToClipboard;
  global.copyTextFallback = copyTextFallback;
  global.normalizeCar = normalizeCar;
  global.getDispatchPeriod = getDispatchPeriod;
  global.setDispatchPeriod = setDispatchPeriod;
  global.getCarDispatchCount = getCarDispatchCount;
  global.getDriverRoles = getDriverRoles;
  global.saveDriverRoles = saveDriverRoles;
  global.getCompanionRoles = getCompanionRoles;
  global.saveCompanionRoles = saveCompanionRoles;
  global.resetRoleLabels = resetRoleLabels;
  global.localDateString = localDateString;
  global.normalizeChild = normalizeChild;
  global.normalizeCompanion = normalizeCompanion;
  global.normalizeChildCompanions = normalizeChildCompanions;
  global.companionsOf = companionsOf;
  global.companionSeatsOf = companionSeatsOf;
  global.familySeatsOf = familySeatsOf;
  global.childCompanionsOf = childCompanionsOf;
  global.childCompanionSeatsOf = childCompanionSeatsOf;
  global.isParticipating = isParticipating;
  global.isOnSite = isOnSite;
  global.isRiding = isRiding;
  global.seatCost = seatCost;
  global.formatRiderLabel = formatRiderLabel;
  global.autoFixedLabel = autoFixedLabel;
  global.getAttendMode = getAttendMode;
  global.setAttendMode = setAttendMode;
  global.getFixedRidersForCar = getFixedRidersForCar;
  global.fixedSeatsUsed = fixedSeatsUsed;
  global.carSeatSummary = carSeatSummary;
  global.canFitOnCar = canFitOnCar;
  global.newCompanionId = newCompanionId;
  global.buildBackupPayload = buildBackupPayload;
  global.isBackupCar = isBackupCar;
  global.isBackupChild = isBackupChild;
  global.createDefaultCars = createDefaultCars;
  global.createDefaultChildren = createDefaultChildren;

})(typeof window !== 'undefined' ? window : globalThis);
