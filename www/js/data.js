(function (global) {
const STANDARD_OPERATING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function createDefaultCars() {
  return [
    {
      id: 1,
      name: '1号車',
      capacity: 4,
      active: true,
      companions: [],
      isEquipmentCar: false,
      isSpecialVehicle: false,
      driverRole: 'role_driver',
      assistantRole: '',
      operatingDays: STANDARD_OPERATING_DAYS.slice(),
      features: ['一般車']
    },
    {
      id: 2,
      name: '2号車',
      capacity: 4,
      active: true,
      companions: [],
      isEquipmentCar: false,
      isSpecialVehicle: false,
      driverRole: 'role_driver',
      assistantRole: '',
      operatingDays: STANDARD_OPERATING_DAYS.slice(),
      features: ['一般車']
    },
    {
      id: 3,
      name: 'リフト車',
      capacity: 3,
      active: true,
      companions: [],
      isEquipmentCar: true,
      isSpecialVehicle: true,
      driverRole: 'role_driver',
      assistantRole: 'role_instructor',
      operatingDays: STANDARD_OPERATING_DAYS.slice(),
      features: ['リフト', '大型車']
    }
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

const LEGACY_DEFAULT_DRIVER_ROLES = ['ドライバー', '職員', '添乗員', 'その他'];
const LEGACY_DEFAULT_COMPANION_ROLES = ['職員', '添乗員', '看護師', '保護者', 'その他'];
const DEFAULT_DRIVER_ROLES = LEGACY_DEFAULT_DRIVER_ROLES;
const DEFAULT_COMPANION_ROLES = LEGACY_DEFAULT_COMPANION_ROLES;
const LEGACY_FAMILY_ROLES = new Set(['父', '母', '祖父', '祖母', '兄', '弟', '姉', '妹', 'コーチ']);
const DRIVER_ROLES_KEY = 'cp_driver_roles';
const COMPANION_ROLES_KEY = 'cp_companion_roles';
const ROLE_LABEL_MAX = 40;
const STORAGE_KEYS = {
  ROLES: 'shuttle_roles_v1',
  CARE_TAGS: 'shuttle_care_tags_v1',
  DAILY_OVERRIDE: 'shuttle_daily_override_v1',
  FACILITY: 'shuttle_facility_v1'
};

const DEFAULT_FACILITY = {
  name: 'ひまわり放課後デイ 施設',
  address: '',
  systemName: '',
  lat: 33.9575,
  lng: 130.9415,
  defaultDepartureTime: '14:30'
};

const ALL_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_ROLES = [
  { id: 'role_driver', name: '運転手（職員）', isDriver: true, isAssistant: false, badgeColor: '#2563eb' },
  { id: 'role_outsource', name: '委託ドライバー', isDriver: true, isAssistant: false, badgeColor: '#4b5563' },
  { id: 'role_instructor', name: '児童指導員 / 介護職', isDriver: true, isAssistant: true, badgeColor: '#059669' },
  { id: 'role_nurse', name: '看護師（医療ケア）', isDriver: false, isAssistant: true, badgeColor: '#dc2626' }
];

const DEFAULT_CARE_TAGS = [
  {
    id: 'tag_wheelchair',
    name: '車椅子',
    color: '#d97706',
    textColor: '#ffffff',
    requiredFeature: 'リフト',
    preventCoOccurrence: true
  },
  {
    id: 'tag_single_ng',
    name: '単独乗車NG',
    color: '#ea580c',
    textColor: '#ffffff',
    requireAssistant: true,
    preventCoOccurrence: true
  },
  {
    id: 'tag_sickness',
    name: '車酔い配慮',
    color: '#ef4444',
    textColor: '#ffffff',
    requireFrontSeat: true,
    preventCoOccurrence: false
  },
  {
    id: 'tag_medical',
    name: '医療的ケア',
    color: '#7c3aed',
    textColor: '#ffffff',
    requireAssistantRole: 'role_nurse',
    preventCoOccurrence: false
  }
];

let staffRoles = [];
let careTagMaster = [];
let careTagMasterReady = false;

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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function textColorForHex(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!match) return '#ffffff';
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y > 160 ? '#1e293b' : '#ffffff';
}

function listsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function sanitizeRole(item, index) {
  if (!item || typeof item !== 'object') return null;
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, ROLE_LABEL_MAX) : '';
  if (!name) return null;
  const rawId = typeof item.id === 'string' ? item.id.trim().slice(0, 48) : '';
  const badgeColor = isHexColor(item.badgeColor) ? item.badgeColor.toLowerCase() : '#2563eb';
  return {
    id: rawId || `role_custom_${index + 1}`,
    name: name,
    isDriver: !!item.isDriver,
    isAssistant: !!item.isAssistant,
    badgeColor: badgeColor
  };
}

function sanitizeRoles(value) {
  if (!Array.isArray(value)) return [];
  const seenId = new Set();
  const seenName = new Set();
  const list = [];
  value.forEach((item, index) => {
    const role = sanitizeRole(item, index);
    if (!role || seenName.has(role.name)) return;
    let id = role.id;
    let n = 2;
    while (seenId.has(id)) {
      id = `${role.id}_${n}`;
      n += 1;
    }
    role.id = id;
    seenId.add(id);
    seenName.add(role.name);
    list.push(role);
  });
  return list;
}

function sanitizeCareTag(item, index) {
  if (!item || typeof item !== 'object') return null;
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
  if (!name) return null;
  const rawId = typeof item.id === 'string' ? item.id.trim().slice(0, 48) : '';
  const color = isHexColor(item.color) ? item.color.toLowerCase() : '#d97706';
  const textColor = isHexColor(item.textColor) ? item.textColor.toLowerCase() : textColorForHex(color);
  const feature = typeof item.requiredFeature === 'string' ? item.requiredFeature.trim().slice(0, 40) : '';
  const assistantRole = typeof item.requireAssistantRole === 'string' ? item.requireAssistantRole.trim().slice(0, 48) : '';
  return {
    id: rawId || `tag_custom_${index + 1}`,
    name: name,
    color: color,
    textColor: textColor,
    requiredFeature: feature,
    preventCoOccurrence: !!item.preventCoOccurrence,
    requireAssistant: !!item.requireAssistant,
    requireFrontSeat: !!item.requireFrontSeat,
    requireAssistantRole: assistantRole
  };
}

function sanitizeCareTags(value) {
  if (!Array.isArray(value)) return [];
  const seenId = new Set();
  const seenName = new Set();
  const list = [];
  value.forEach((item, index) => {
    const tag = sanitizeCareTag(item, index);
    if (!tag || seenName.has(tag.name)) return;
    let id = tag.id;
    let n = 2;
    while (seenId.has(id)) {
      id = `${tag.id}_${n}`;
      n += 1;
    }
    tag.id = id;
    seenId.add(id);
    seenName.add(tag.name);
    list.push(tag);
  });
  return list;
}

function defaultRoles() {
  return sanitizeRoles(cloneJson(DEFAULT_ROLES));
}

function defaultCareTags() {
  return sanitizeCareTags(cloneJson(DEFAULT_CARE_TAGS));
}

function migrateLegacyRoleLists() {
  const drivers = sanitizeRoleList(readJsonStorage(DRIVER_ROLES_KEY));
  const companions = sanitizeRoleList(readJsonStorage(COMPANION_ROLES_KEY));
  if (!drivers && !companions) return defaultRoles();
  const driverList = drivers || [];
  const companionList = companions || [];
  if (
    listsEqual(driverList, LEGACY_DEFAULT_DRIVER_ROLES) &&
    listsEqual(companionList, LEGACY_DEFAULT_COMPANION_ROLES)
  ) {
    return defaultRoles();
  }
  const palette = ['#2563eb', '#4b5563', '#059669', '#dc2626', '#7c3aed', '#0891b2'];
  const byName = new Map();
  driverList.forEach((name) => {
    if (byName.has(name)) return;
    byName.set(name, {
      id: `role_migrated_${byName.size + 1}`,
      name: name,
      isDriver: true,
      isAssistant: false,
      badgeColor: palette[byName.size % palette.length]
    });
  });
  companionList.forEach((name) => {
    const existing = byName.get(name);
    if (existing) {
      existing.isAssistant = true;
      return;
    }
    byName.set(name, {
      id: `role_migrated_${byName.size + 1}`,
      name: name,
      isDriver: false,
      isAssistant: true,
      badgeColor: palette[byName.size % palette.length]
    });
  });
  const migrated = sanitizeRoles(Array.from(byName.values()));
  return migrated.length ? migrated : defaultRoles();
}

function extraCareTagsFromChildren(baseTags) {
  const tags = baseTags.slice();
  const known = new Set(tags.map((tag) => tag.name));
  const palette = ['#0ea5e9', '#64748b', '#16a34a', '#db2777'];
  const found = [];
  (Array.isArray(children) ? children : []).forEach((child) => {
    if (!child || typeof child !== 'object') return;
    const source = Array.isArray(child.careTags) ? child.careTags : [];
    source.forEach((item) => {
      const name = typeof item === 'string' ? item.trim() : '';
      if (name) found.push(name);
    });
    if (child.motionSick) found.push('車酔い配慮');
  });
  found.forEach((name) => {
    if (known.has(name)) return;
    known.add(name);
    const color = palette[(tags.length) % palette.length];
    tags.push({
      id: `tag_custom_${tags.length + 1}`,
      name: name,
      color: color,
      textColor: textColorForHex(color),
      requiredFeature: '',
      preventCoOccurrence: false,
      requireAssistant: false,
      requireFrontSeat: name.indexOf('酔') !== -1,
      requireAssistantRole: ''
    });
  });
  return sanitizeCareTags(tags);
}

function loadRoleMaster() {
  const stored = sanitizeRoles(readJsonStorage(STORAGE_KEYS.ROLES));
  staffRoles = stored.length ? stored : migrateLegacyRoleLists();
  if (!stored.length) writeJsonStorage(STORAGE_KEYS.ROLES, staffRoles);
  return staffRoles;
}

function loadCareTagMaster() {
  const raw = readJsonStorage(STORAGE_KEYS.CARE_TAGS);
  if (Array.isArray(raw)) {
    careTagMaster = sanitizeCareTags(raw);
    careTagMasterReady = true;
    return careTagMaster;
  }
  careTagMaster = extraCareTagsFromChildren(defaultCareTags());
  careTagMasterReady = true;
  writeJsonStorage(STORAGE_KEYS.CARE_TAGS, careTagMaster);
  return careTagMaster;
}

function getRoles() {
  if (!staffRoles.length) return defaultRoles();
  return staffRoles.map((role) => ({
    id: role.id,
    name: role.name,
    isDriver: !!role.isDriver,
    isAssistant: !!role.isAssistant,
    badgeColor: role.badgeColor
  }));
}

function saveRoles(list) {
  const next = sanitizeRoles(list);
  staffRoles = next.length ? next : defaultRoles();
  writeJsonStorage(STORAGE_KEYS.ROLES, staffRoles);
  const driverNames = staffRoles.filter((role) => role.isDriver).map((role) => role.name);
  const assistantNames = staffRoles.filter((role) => role.isAssistant).map((role) => role.name);
  writeRoleList(DRIVER_ROLES_KEY, driverNames.length ? driverNames : LEGACY_DEFAULT_DRIVER_ROLES);
  writeRoleList(COMPANION_ROLES_KEY, assistantNames.length ? assistantNames : LEGACY_DEFAULT_COMPANION_ROLES);
  return getRoles();
}

function getCareTags() {
  if (!careTagMasterReady) return defaultCareTags();
  return careTagMaster.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    textColor: tag.textColor,
    requiredFeature: tag.requiredFeature || '',
    preventCoOccurrence: !!tag.preventCoOccurrence,
    requireAssistant: !!tag.requireAssistant,
    requireFrontSeat: !!tag.requireFrontSeat,
    requireAssistantRole: tag.requireAssistantRole || ''
  }));
}

function saveCareTags(list) {
  careTagMaster = sanitizeCareTags(list);
  careTagMasterReady = true;
  writeJsonStorage(STORAGE_KEYS.CARE_TAGS, careTagMaster);
  return getCareTags();
}

function getDriverRoles() {
  const names = getRoles().filter((role) => role.isDriver).map((role) => role.name);
  return names.length ? names : defaultRoles().filter((role) => role.isDriver).map((role) => role.name);
}

function saveDriverRoles(list) {
  const names = sanitizeRoleList(list) || [];
  const current = getRoles();
  const kept = current.filter((role) => !role.isDriver || names.indexOf(role.name) !== -1);
  names.forEach((name) => {
    const found = kept.find((role) => role.name === name);
    if (found) found.isDriver = true;
    else {
      kept.push({
        id: `role_custom_${Date.now()}_${kept.length}`,
        name: name,
        isDriver: true,
        isAssistant: false,
        badgeColor: '#2563eb'
      });
    }
  });
  return saveRoles(kept).filter((role) => role.isDriver).map((role) => role.name);
}

function getCompanionRoles() {
  const names = getRoles().filter((role) => role.isAssistant).map((role) => role.name);
  return names.length ? names : ['看護師（医療ケア）'];
}

function saveCompanionRoles(list) {
  const names = sanitizeRoleList(list) || [];
  const current = getRoles();
  const kept = current.filter((role) => !role.isAssistant || names.indexOf(role.name) !== -1);
  names.forEach((name) => {
    const found = kept.find((role) => role.name === name);
    if (found) found.isAssistant = true;
    else {
      kept.push({
        id: `role_custom_${Date.now()}_${kept.length}`,
        name: name,
        isDriver: false,
        isAssistant: true,
        badgeColor: '#dc2626'
      });
    }
  });
  return saveRoles(kept).filter((role) => role.isAssistant).map((role) => role.name);
}

function resetRoleLabels() {
  saveRoles(defaultRoles());
  saveCareTags(defaultCareTags());
  return getRoles();
}

function defaultDriverName() {
  const drivers = staffRoles.filter((role) => role.isDriver);
  if (drivers.length) return drivers[0].name;
  return '運転手（職員）';
}

function normalizeAssistantRole(value) {
  const role = typeof value === 'string' ? value.trim() : '';
  if (!role || role === 'none') return '';
  return role.slice(0, ROLE_LABEL_MAX);
}

function normalizeDriverRole(value) {
  const role = typeof value === 'string' ? value.trim() : '';
  if (!role || LEGACY_FAMILY_ROLES.has(role)) return defaultDriverName();
  if (role === 'ドライバー' && !staffRoles.some((item) => item.name === 'ドライバー' || item.id === role)) {
    return defaultDriverName();
  }
  return role.slice(0, ROLE_LABEL_MAX);
}

function normalizeVehicleFeatures(car) {
  const seen = new Set();
  const out = [];
  const push = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text.slice(0, 40));
  };
  if (car && Array.isArray(car.features)) car.features.forEach(push);
  const special = !!(car && (car.isSpecialVehicle || car.isEquipmentCar));
  if (special) push('リフト');
  return out;
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

  const special = !!(car.isSpecialVehicle || car.isEquipmentCar);
  const parsedDays = coerceDayList(car.operatingDays);
  return {
    id: car.id,
    name: typeof car.name === 'string' ? car.name : '',
    capacity: Math.max(0, parseInt(car.capacity, 10) || 0),
    active: !!car.active,
    companions: companions,
    isEquipmentCar: special,
    isSpecialVehicle: special,
    features: normalizeVehicleFeatures(Object.assign({}, car, { isEquipmentCar: special, isSpecialVehicle: special })),
    driverRole: normalizeDriverRole(car.driverRole != null ? car.driverRole : car.driver),
    assistantRole: normalizeAssistantRole(car.assistantRole),
    operatingDays: parsedDays == null ? ALL_DAY_KEYS.slice() : parsedDays,
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

/** 配列なら曜日キーへ正規化（空配列は「定期なし」として維持）。未設定は null。 */
function coerceDayList(value) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(ALL_DAY_KEYS);
  const seen = new Set();
  const out = [];
  value.forEach((item) => {
    const key = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!allowed.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

function getDayOfWeekKey(targetDateStr) {
  const ymd = normalizeDispatchDate(targetDateStr) || localDateString();
  const [y, m, d] = ymd.split('-').map(Number);
  return JS_DAY_TO_KEY[new Date(y, m - 1, d).getDay()];
}

/** 選択中の週のまま、指定曜日の日付（YYYY-MM-DD）へ移動する。週の開始は月曜。 */
function dateForWeekday(baseDateStr, dayKey) {
  const ymd = normalizeDispatchDate(baseDateStr) || localDateString();
  const order = ALL_DAY_KEYS;
  const from = order.indexOf(getDayOfWeekKey(ymd));
  const to = order.indexOf(dayKey);
  if (from < 0 || to < 0) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + (to - from));
  return localDateString(dt);
}

let dailyOverrides = {};

function emptyDailyOverride(dateStr) {
  return {
    date: dateStr,
    absentPassengerIds: [],
    spotPassengerIds: [],
    outOfServiceVehicleIds: []
  };
}

function sanitizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  value.forEach((item) => {
    if (item == null) return;
    const id = String(item).trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function sanitizeDailyOverride(dateStr, value) {
  const src = value && typeof value === 'object' ? value : {};
  return {
    date: dateStr,
    absentPassengerIds: sanitizeIdList(src.absentPassengerIds),
    spotPassengerIds: sanitizeIdList(src.spotPassengerIds),
    outOfServiceVehicleIds: sanitizeIdList(src.outOfServiceVehicleIds)
  };
}

function loadDailyOverrides() {
  dailyOverrides = {};
  const raw = readJsonStorage(STORAGE_KEYS.DAILY_OVERRIDE);
  if (!raw || typeof raw !== 'object') return;
  const entries = Array.isArray(raw)
    ? raw
    : (typeof raw.date === 'string' && (raw.absentPassengerIds || raw.spotPassengerIds || raw.outOfServiceVehicleIds)
      ? [raw]
      : Object.keys(raw).map((key) => Object.assign({ date: key }, raw[key])));
  entries.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const date = normalizeDispatchDate(item.date);
    if (!date) return;
    const next = sanitizeDailyOverride(date, item);
    if (!next.absentPassengerIds.length && !next.spotPassengerIds.length && !next.outOfServiceVehicleIds.length) return;
    dailyOverrides[date] = next;
  });
}

function getDailyOverride(dateStr) {
  const date = normalizeDispatchDate(dateStr) || localDateString();
  const found = dailyOverrides[date];
  if (!found) return emptyDailyOverride(date);
  return {
    date: date,
    absentPassengerIds: found.absentPassengerIds.slice(),
    spotPassengerIds: found.spotPassengerIds.slice(),
    outOfServiceVehicleIds: found.outOfServiceVehicleIds.slice()
  };
}

function saveDailyOverride(dateStr, overrideData) {
  const date = normalizeDispatchDate(dateStr) || localDateString();
  const next = sanitizeDailyOverride(date, overrideData);
  const empty = !next.absentPassengerIds.length && !next.spotPassengerIds.length && !next.outOfServiceVehicleIds.length;
  if (empty) delete dailyOverrides[date];
  else dailyOverrides[date] = next;
  writeJsonStorage(STORAGE_KEYS.DAILY_OVERRIDE, dailyOverrides);
  return getDailyOverride(date);
}

function idSet(list) {
  return new Set((Array.isArray(list) ? list : []).map((item) => String(item)));
}

/**
 * 指定日の配車対象。曜日契約と当日オーバーライドだけを見る。
 * 欠席・スポット・運休はマスタの schedulePattern / operatingDays を書き換えない。
 */
function getActiveEntitiesForDate(targetDateStr) {
  const date = normalizeDispatchDate(targetDateStr) || localDateString();
  const dayOfWeek = getDayOfWeekKey(date);
  let override = emptyDailyOverride(date);
  try {
    override = getDailyOverride(date);
  } catch (e) { /* 壊れた上書きは無視してマスタ側だけ使う */ }
  const absent = idSet(override.absentPassengerIds);
  const spot = idSet(override.spotPassengerIds);
  const stopped = idSet(override.outOfServiceVehicleIds);

  const activeVehicles = (Array.isArray(cars) ? cars : []).filter((vehicle) => {
    if (!vehicle) return false;
    if (stopped.has(String(vehicle.id))) return false;
    if (vehicle.active === false) return false;
    const days = vehicle.operatingDays;
    if (!Array.isArray(days)) return true;
    return days.includes(dayOfWeek);
  });

  const activePassengers = (Array.isArray(children) ? children : []).filter((passenger) => {
    if (!passenger || passenger.isActive === false) return false;
    const id = String(passenger.id);
    if (absent.has(id)) return false;
    if (spot.has(id)) return true;
    return Array.isArray(passenger.schedulePattern) && passenger.schedulePattern.includes(dayOfWeek);
  });

  return { activePassengers, activeVehicles, date, dayOfWeek };
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
    { id: 1, name: 'ゆうと', furigana: 'ゆうと', groupClass: '小学部', grade: '小学部', careTags: ['見守り'], pos: '', parentCar: '1号車', fixedVehicle: '1号車', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {}, address: '山口県下関市綾羅木町1-1', lat: 33.968, lng: 130.95, boardingTimeMinutes: null },
    { id: 2, name: 'そうた', furigana: 'そうた', groupClass: '小学部', grade: '小学部', careTags: [], pos: '', parentCar: '2号車', fixedVehicle: '2号車', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {}, address: '山口県下関市安岡町2-2', lat: 33.95, lng: 130.958, boardingTimeMinutes: null },
    { id: 3, name: 'れん', furigana: 'れん', groupClass: 'A組', grade: 'A組', careTags: ['車酔い配慮'], pos: '', parentCar: '', fixedVehicle: '', fixedCar: '', motionSick: true, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {}, address: '山口県下関市椋野町3-3', lat: 33.9665, lng: 130.928, boardingTimeMinutes: null },
    { id: 4, name: 'はると', furigana: 'はると', groupClass: 'A組', grade: 'A組', careTags: ['車椅子'], pos: '', parentCar: '', fixedVehicle: '', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {}, address: '山口県下関市吉見町4-4', lat: 33.9495, lng: 130.9305, boardingTimeMinutes: null },
    { id: 5, name: 'こうき', furigana: 'こうき', groupClass: 'デイ', grade: 'デイ', careTags: [], pos: '', parentCar: '', fixedVehicle: '', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {}, address: '山口県下関市秋根町5-5', lat: 33.961, lng: 130.9625, boardingTimeMinutes: null },
    { id: 6, name: '大和', furigana: 'やまと', groupClass: 'デイ', grade: 'デイ', careTags: ['見守り'], pos: '', parentCar: 'リフト車', fixedVehicle: 'リフト車', fixedCar: '', motionSick: false, active: true, meetOnSite: false, companions: [], lastCar: '', rideHistory: {}, address: '山口県下関市富任町6-6', lat: 33.946, lng: 130.9485, boardingTimeMinutes: null }
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

function normalizeFurigana(child) {
  const reading = child && typeof child.furigana === 'string' ? child.furigana.trim().slice(0, 40) : '';
  if (reading) return reading;
  const name = child && typeof child.name === 'string' ? child.name.trim().slice(0, 40) : '';
  return name;
}

function normalizeChild(child) {
  const meetOnSite = !!child.meetOnSite;
  const companions = meetOnSite ? [] : normalizeChildCompanions(child);
  const parsedDays = coerceDayList(child.schedulePattern);
  return {
    ...child,
    furigana: normalizeFurigana(child),
    active: !!child.active,
    meetOnSite: meetOnSite,
    companions: companions,
    motionSick: !!child.motionSick,
    parentCar: typeof child.parentCar === 'string' ? child.parentCar : '',
    fixedCar: typeof child.fixedCar === 'string' ? child.fixedCar : '',
    lastCar: typeof child.lastCar === 'string' ? child.lastCar : '',
    rideHistory: child.rideHistory && typeof child.rideHistory === 'object' && !Array.isArray(child.rideHistory) ? child.rideHistory : {},
    schedulePattern: parsedDays == null ? ALL_DAY_KEYS.slice() : parsedDays,
    isActive: child.isActive === false ? false : true,
    address: typeof child.address === 'string' ? child.address.trim().slice(0, 120) : '',
    lat: normalizeCoord(child.lat, -90, 90),
    lng: normalizeCoord(child.lng, -180, 180),
    boardingTimeMinutes: normalizeBoardingMinutes(child.boardingTimeMinutes)
  };
}

function normalizeCoord(value, min, max) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 1e6) / 1e6;
}

function normalizeBoardingMinutes(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 180) return null;
  return Math.round(n);
}

function normalizeClock(value) {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

let facility = {
  name: DEFAULT_FACILITY.name,
  address: DEFAULT_FACILITY.address,
  systemName: DEFAULT_FACILITY.systemName,
  lat: DEFAULT_FACILITY.lat,
  lng: DEFAULT_FACILITY.lng,
  defaultDepartureTime: DEFAULT_FACILITY.defaultDepartureTime
};

function normalizeFacilityAddress(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function normalizeSystemName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 40) : '';
}

function loadFacility() {
  const raw = readJsonStorage(STORAGE_KEYS.FACILITY);
  const src = raw && typeof raw === 'object' ? raw : {};
  const hasName = Object.prototype.hasOwnProperty.call(src, 'name') && typeof src.name === 'string';
  const name = hasName ? src.name.trim().slice(0, 40) : DEFAULT_FACILITY.name;
  const lat = normalizeCoord(src.lat, -90, 90);
  const lng = normalizeCoord(src.lng, -180, 180);
  facility = {
    name,
    address: normalizeFacilityAddress(src.address),
    systemName: normalizeSystemName(src.systemName),
    lat: lat == null ? DEFAULT_FACILITY.lat : lat,
    lng: lng == null ? DEFAULT_FACILITY.lng : lng,
    defaultDepartureTime: normalizeClock(src.defaultDepartureTime) || DEFAULT_FACILITY.defaultDepartureTime
  };
}

function getFacility() {
  return {
    name: facility.name,
    address: facility.address || '',
    systemName: facility.systemName || '',
    lat: facility.lat,
    lng: facility.lng,
    defaultDepartureTime: facility.defaultDepartureTime
  };
}

function getFacilityBrandName() {
  return facility && typeof facility.name === 'string' ? facility.name.trim() : '';
}

function saveFacility(partial) {
  const src = partial && typeof partial === 'object' ? partial : {};
  const name = Object.prototype.hasOwnProperty.call(src, 'name')
    ? (typeof src.name === 'string' ? src.name.trim().slice(0, 40) : facility.name)
    : facility.name;
  const lat = Object.prototype.hasOwnProperty.call(src, 'lat') ? normalizeCoord(src.lat, -90, 90) : facility.lat;
  const lng = Object.prototype.hasOwnProperty.call(src, 'lng') ? normalizeCoord(src.lng, -180, 180) : facility.lng;
  const address = Object.prototype.hasOwnProperty.call(src, 'address')
    ? normalizeFacilityAddress(src.address)
    : (facility.address || '');
  const systemName = Object.prototype.hasOwnProperty.call(src, 'systemName')
    ? normalizeSystemName(src.systemName)
    : (facility.systemName || '');
  facility = {
    name,
    address,
    systemName,
    lat: lat == null ? facility.lat : lat,
    lng: lng == null ? facility.lng : lng,
    defaultDepartureTime: normalizeClock(src.defaultDepartureTime) || facility.defaultDepartureTime
  };
  writeJsonStorage(STORAGE_KEYS.FACILITY, facility);
  return getFacility();
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

/** 少年野球時代の車両名。名前に含まれていれば標準名へ寄せる。 */
function legacyVehicleTarget(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) return null;
  if (text.indexOf('田中号') !== -1) return { name: 'リフト車', special: true };
  if (text.indexOf('佐藤号') !== -1) return { name: '1号車', special: false };
  if (text.indexOf('鈴木号') !== -1) return { name: '2号車', special: false };
  return null;
}

function remapStoredVehicleName(name) {
  if (typeof name !== 'string' || !name) return name;
  const target = legacyVehicleTarget(name);
  return target ? target.name : name;
}

function rewriteLegacyVehicleText(text) {
  return String(text || '')
    .split('田中号(荷物車)').join('リフト車')
    .split('田中号（荷物車）').join('リフト車')
    .split('田中号').join('リフト車')
    .split('佐藤号').join('1号車')
    .split('鈴木号').join('2号車');
}

function remapChildVehicleNames(child) {
  if (!child || typeof child !== 'object') return false;
  let changed = false;
  ['parentCar', 'fixedVehicle', 'fixedCar', 'lastCar'].forEach((key) => {
    if (typeof child[key] !== 'string' || !child[key]) return;
    const next = remapStoredVehicleName(child[key]);
    if (next !== child[key]) {
      child[key] = next;
      changed = true;
    }
  });
  if (child.parentCar && !child.fixedVehicle) {
    child.fixedVehicle = child.parentCar;
    changed = true;
  }
  if (child.fixedVehicle && !child.parentCar) {
    child.parentCar = child.fixedVehicle;
    changed = true;
  }
  if (child.rideHistory && typeof child.rideHistory === 'object' && !Array.isArray(child.rideHistory)) {
    const next = {};
    let historyChanged = false;
    Object.keys(child.rideHistory).forEach((key) => {
      const mapped = remapStoredVehicleName(key);
      if (mapped !== key) historyChanged = true;
      next[mapped] = (next[mapped] || 0) + (Number(child.rideHistory[key]) || 0);
    });
    if (historyChanged) {
      child.rideHistory = next;
      changed = true;
    }
  }
  return changed;
}

function migrateLegacyVehicles() {
  let changed = false;
  cars.forEach((car) => {
    const target = legacyVehicleTarget(car.name);
    if (!target) return;
    if (car.name !== target.name) {
      const taken = cars.some((other) => other !== car && other.name === target.name);
      if (!taken) {
        car.name = target.name;
        changed = true;
      }
    }
    if (target.special) {
      if (!car.isSpecialVehicle || !car.isEquipmentCar) {
        car.isSpecialVehicle = true;
        car.isEquipmentCar = true;
        changed = true;
      }
      if (!Array.isArray(car.features) || car.features.length !== 1 || car.features[0] !== 'リフト') {
        car.features = ['リフト'];
        changed = true;
      }
    }
  });
  children.forEach((child) => {
    if (remapChildVehicleNames(child)) changed = true;
  });
  return changed;
}

function readStoredVehicleList() {
  const keys = ['cp_cars', 'shuttle_vehicles_v1'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const raw = localStorage.getItem(keys[i]);
      if (raw == null || raw === '') continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* 次のキーを見る */ }
  }
  return null;
}

function getVehicles() {
  const stored = readStoredVehicleList();
  const source = Array.isArray(stored) ? stored : createDefaultCars();
  return source.map(normalizeCar);
}

function loadData() {
  try {
    loadRoleMaster();
  } catch (e) {
    staffRoles = defaultRoles();
  }

  try {
    cars = getVehicles();
  } catch (e) {
    cars = createDefaultCars().map(normalizeCar);
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
  if (migrateLegacyVehicles()) changed = true;
  if (changed) saveData();

  try {
    loadCareTagMaster();
  } catch (e) {
    careTagMaster = defaultCareTags();
    careTagMasterReady = true;
  }

  try {
    loadDailyOverrides();
  } catch (e) {
    dailyOverrides = {};
  }

  try {
    loadFacility();
  } catch (e) {
    facility = {
      name: DEFAULT_FACILITY.name,
      address: DEFAULT_FACILITY.address,
      systemName: DEFAULT_FACILITY.systemName,
      lat: DEFAULT_FACILITY.lat,
      lng: DEFAULT_FACILITY.lng,
      defaultDepartureTime: DEFAULT_FACILITY.defaultDepartureTime
    };
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

/** 車両マスタだけを 1号車・2号車・リフト車へ戻す。利用者名簿は残す。 */
function resetVehiclesToDefault() {
  cars = createDefaultCars().map(normalizeCar);
  const valid = new Set(cars.map((car) => car.name));
  children.forEach((child) => {
    remapChildVehicleNames(child);
    ['parentCar', 'fixedVehicle', 'fixedCar'].forEach((key) => {
      if (typeof child[key] === 'string' && child[key] && !valid.has(child[key])) child[key] = '';
    });
    if (child.parentCar && !child.fixedVehicle) child.fixedVehicle = child.parentCar;
    if (child.fixedVehicle && !child.parentCar) child.parentCar = child.fixedVehicle;
  });
  saveData();
  return cars;
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
    c.isEquipmentCar = false;
    c.isSpecialVehicle = false;
    c.features = Array.isArray(c.features) ? c.features.filter((feature) => feature !== 'リフト') : [];
    c.assistantRole = '';
  });

  children.forEach(c => {
    // 既存の初期状態に合わせ、全員「乗車」に戻す（曜日契約は触らない）
    c.active = true;
    c.meetOnSite = false;
    c.companions = [];
    c.fixedCar = '';
  });

  if (typeof getSelectedServiceDate === 'function') {
    saveDailyOverride(getSelectedServiceDate(), emptyDailyOverride(getSelectedServiceDate()));
  }

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
    version: 4,
    exportedAt: new Date().toISOString(),
    cars: cars,
    children: children,
    roles: getRoles(),
    careTags: getCareTags(),
    dailyOverrides: dailyOverrides,
    facility: getFacility()
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
  if (Array.isArray(data.roles)) {
    const restoredRoles = sanitizeRoles(data.roles);
    if (restoredRoles.length) staffRoles = restoredRoles;
  }
  if (Array.isArray(data.careTags)) {
    careTagMaster = sanitizeCareTags(data.careTags);
  } else {
    careTagMaster = extraCareTagsFromChildren(careTagMasterReady && careTagMaster.length ? careTagMaster : defaultCareTags());
  }
  careTagMasterReady = true;
  writeJsonStorage(STORAGE_KEYS.ROLES, staffRoles);
  writeJsonStorage(STORAGE_KEYS.CARE_TAGS, careTagMaster);
  if (data.dailyOverrides && typeof data.dailyOverrides === 'object') {
    writeJsonStorage(STORAGE_KEYS.DAILY_OVERRIDE, data.dailyOverrides);
    try {
      loadDailyOverrides();
    } catch (e) {
      dailyOverrides = {};
    }
  }
  if (data.facility && typeof data.facility === 'object') saveFacility(data.facility);
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
    getVehicles,
    resetVehiclesToDefault,
    rewriteLegacyVehicleText,
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
    getRoles,
    saveRoles,
    getCareTags,
    saveCareTags,
    getDailyOverride,
    saveDailyOverride,
    getActiveEntitiesForDate,
    getDayOfWeekKey,
    dateForWeekday,
    getFacility,
    getFacilityBrandName,
    saveFacility,
    normalizeClock,
    WEEKDAY_KEYS,
    ALL_DAY_KEYS,
    STORAGE_KEYS,
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
  global.getVehicles = getVehicles;
  global.resetVehiclesToDefault = resetVehiclesToDefault;
  global.rewriteLegacyVehicleText = rewriteLegacyVehicleText;
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
  global.getRoles = getRoles;
  global.saveRoles = saveRoles;
  global.getCareTags = getCareTags;
  global.saveCareTags = saveCareTags;
  global.getDailyOverride = getDailyOverride;
  global.saveDailyOverride = saveDailyOverride;
  global.getActiveEntitiesForDate = getActiveEntitiesForDate;
  global.getDayOfWeekKey = getDayOfWeekKey;
  global.dateForWeekday = dateForWeekday;
  global.getFacility = getFacility;
  global.getFacilityBrandName = getFacilityBrandName;
  global.saveFacility = saveFacility;
  global.normalizeClock = normalizeClock;
  global.normalizeCoord = normalizeCoord;
  global.WEEKDAY_KEYS = WEEKDAY_KEYS;
  global.ALL_DAY_KEYS = ALL_DAY_KEYS;
  global.STORAGE_KEYS = STORAGE_KEYS;
  global.localDateString = localDateString;
  global.normalizeDispatchDate = normalizeDispatchDate;
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
