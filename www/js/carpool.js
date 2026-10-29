(function (global) {
let lastGeneratedPlan = "";
let currentAssignments = null;
let lastAssignmentWarnings = [];

/** 同セッション内の直前 LINE 確定分 { [childId]: carName }（二重加算防止用） */
const LAST_SESSION_COMMIT_KEY = 'cp_lastSessionCommit';
let lastSessionCommit = null;

function readLastSessionCommit() {
  if (lastSessionCommit && typeof lastSessionCommit === 'object') return lastSessionCommit;
  try {
    const raw = sessionStorage.getItem(LAST_SESSION_COMMIT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    lastSessionCommit = parsed;
    return lastSessionCommit;
  } catch (e) {
    return null;
  }
}

function writeLastSessionCommit(map) {
  lastSessionCommit = map && typeof map === 'object' ? map : null;
  try {
    if (lastSessionCommit) {
      sessionStorage.setItem(LAST_SESSION_COMMIT_KEY, JSON.stringify(lastSessionCommit));
    } else {
      sessionStorage.removeItem(LAST_SESSION_COMMIT_KEY);
    }
  } catch (e) { /* ignore */ }
}

function clearLastSessionCommit() {
  writeLastSessionCommit(null);
  writeLastDispatchCommit(null);
}

const LAST_DISPATCH_COMMIT_KEY = 'cp_lastDispatchCommit';
let lastDispatchCommit = null;

function readLastDispatchCommit() {
  if (lastDispatchCommit && typeof lastDispatchCommit === 'object') return lastDispatchCommit;
  try {
    const raw = sessionStorage.getItem(LAST_DISPATCH_COMMIT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.carIds)) return null;
    lastDispatchCommit = parsed;
    return lastDispatchCommit;
  } catch (e) {
    return null;
  }
}

function writeLastDispatchCommit(entry) {
  lastDispatchCommit = entry && typeof entry === 'object' ? entry : null;
  try {
    if (lastDispatchCommit) {
      sessionStorage.setItem(LAST_DISPATCH_COMMIT_KEY, JSON.stringify(lastDispatchCommit));
    } else {
      sessionStorage.removeItem(LAST_DISPATCH_COMMIT_KEY);
    }
  } catch (e) { /* ignore */ }
}

function rollbackLastDispatchCommit() {
  const prev = readLastDispatchCommit();
  if (!prev || typeof prev.date !== 'string') return;
  (prev.carIds || []).forEach((id) => {
    const car = cars.find((c) => String(c.id) === String(id));
    if (!car || !Array.isArray(car.dispatchHistory)) return;
    for (let i = car.dispatchHistory.length - 1; i >= 0; i--) {
      if (car.dispatchHistory[i] === prev.date) {
        car.dispatchHistory.splice(i, 1);
        break;
      }
    }
  });
}

function recordConfirmedDispatches(assignments) {
  const date = localDateString();
  const carIds = [];
  Object.keys(assignments || {}).forEach((carName) => {
    const car = cars.find((c) => c.name === carName);
    if (!car) return;
    if (!Array.isArray(car.dispatchHistory)) car.dispatchHistory = [];
    car.dispatchHistory.push(date);
    carIds.push(car.id);
  });
  writeLastDispatchCommit({ date, carIds });
}

/** 直前セッション確定分の rideHistory を -1（0以下のキーは削除） */
function rollbackLastSessionCommit() {
  const prev = readLastSessionCommit();
  if (!prev) return;

  Object.keys(prev).forEach((childId) => {
    const carName = prev[childId];
    if (!carName) return;
    const child = children.find((c) => String(c.id) === String(childId));
    if (!child) return;
    if (!child.rideHistory || typeof child.rideHistory !== 'object') {
      child.rideHistory = {};
      return;
    }
    const next = (parseInt(child.rideHistory[carName], 10) || 0) - 1;
    if (next <= 0) {
      delete child.rideHistory[carName];
    } else {
      child.rideHistory[carName] = next;
    }
  });
}

function applyAssignmentHistoryCommit(assignments) {
  const commitMap = {};
  if (!assignments) return commitMap;

  Object.keys(assignments).forEach((carName) => {
    (assignments[carName] || []).forEach((k) => {
      const orig = children.find((x) => x.id === k.id);
      if (!orig) return;
      if (!orig.rideHistory || typeof orig.rideHistory !== 'object') orig.rideHistory = {};
      orig.rideHistory[carName] = (parseInt(orig.rideHistory[carName], 10) || 0) + 1;
      orig.lastCar = carName;
      commitMap[String(orig.id)] = carName;
    });
  });
  return commitMap;
}

function occupiedSeats(list) {
  return (list || []).reduce((sum, k) => sum + seatCost(k), 0);
}

function carPeopleCount(car, riders) {
  return occupiedSeats(riders) + familySeatsOf(car);
}

function remainingSeats(car, assignments) {
  const cap = parseInt(car.capacity, 10) || 0;
  return cap - familySeatsOf(car) - occupiedSeats(assignments[car.name] || []);
}

function placeKid(kid, carName, assignments, currentCaps) {
  assignments[carName].push(kid);
  const cost = seatCost(kid);
  if (currentCaps[carName] > 0) {
    currentCaps[carName] = Math.max(0, currentCaps[carName] - cost);
  }
}

function clearCarpoolDiagnosis() {
  const el = document.getElementById('carpoolDiagnosis');
  if (!el) return;
  el.hidden = true;
  el.classList.remove('is-visible', 'is-warning');
  el.innerHTML = '';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 配車失敗時の診断: 過不足・固定同乗・1席余り・車酔いなどを分析し
 * 優先度付きの解決サジェストを返す。
 */
function diagnoseCarpoolFailure(options) {
  const ridingKids = children.filter(isRiding);
  const activeCars = cars.filter(c => c.active);
  const inactiveCars = cars.filter(c => !c.active);
  const leftoverKids = options && Array.isArray(options.leftoverKids) ? options.leftoverKids : [];

  const kidSeatDemand = ridingKids.reduce((sum, c) => sum + seatCost(c), 0);
  const carCompanionSeats = activeCars.reduce((sum, c) => sum + companionSeatsOf(c), 0);
  const totalCap = activeCars.reduce((sum, c) => sum + (parseInt(c.capacity, 10) || 0), 0);
  const openSeats = Math.max(0, totalCap - carCompanionSeats);
  const shortage = Math.max(0, kidSeatDemand - openSeats);
  const totalNeed = kidSeatDemand + carCompanionSeats;

  const suggestions = [];
  const notes = [];

  if (leftoverKids.length > 0) {
    notes.push(`未割り当て: ${leftoverKids.map(k => k.name).join('、')}`);
  }

  if (carCompanionSeats > 0) {
    notes.push(`車両側の事前同乗で ${carCompanionSeats}席 が確保済み`);
  }

  // A. 同乗枠の解放（車両側）
  activeCars.forEach(car => {
    companionsOf(car).forEach(cmp => {
      suggestions.push({
        priority: 10,
        tag: 'A',
        text: `「${car.name}」の同乗者『${cmp.label}』を解除すると 1席 空きます`
      });
    });
  });

  // A'. 選手側の同乗が多い場合も提案（不足時）
  if (shortage > 0) {
    ridingKids
      .filter(k => childCompanionSeatsOf(k) > 0)
      .sort((a, b) => childCompanionSeatsOf(b) - childCompanionSeatsOf(a))
      .slice(0, 4)
      .forEach(k => {
        const n = childCompanionSeatsOf(k);
        const labels = childCompanionsOf(k).map(c => c.label).join('、');
        suggestions.push({
          priority: 15,
          tag: 'A',
          text: `選手「${k.name}」の同乗者（${labels}）を減らすと最大 ${n}席 空きます`
        });
      });
  }

  // B. 休止車両の活用
  inactiveCars
    .slice()
    .sort((a, b) => (parseInt(b.capacity, 10) || 0) - (parseInt(a.capacity, 10) || 0))
    .forEach(car => {
      const seats = parseInt(car.capacity, 10) || 0;
      if (seats <= 0) return;
      suggestions.push({
        priority: 20,
        tag: 'B',
        text: `現在休止中の『${car.name}』を出勤にすると ${seats}席 確保できます`
      });
    });

  // C. 現地集合の提案
  if (shortage > 0 && ridingKids.length > 0) {
    let need = shortage;
    let count = 0;
    const sorted = [...ridingKids].sort((a, b) => seatCost(b) - seatCost(a));
    for (let i = 0; i < sorted.length && need > 0; i++) {
      need -= seatCost(sorted[i]);
      count += 1;
    }
    suggestions.push({
      priority: 30,
      tag: 'C',
      text: `あと ${count}名を『現地集合』に変更すると成立します`
    });
  }

  // D. 最低2人ルール / 1席のみ余り
  activeCars.forEach(car => {
    const cap = parseInt(car.capacity, 10) || 0;
    const rem = cap - companionSeatsOf(car);
    if (rem === 1) {
      suggestions.push({
        priority: 25,
        tag: 'D',
        text: `「${car.name}」が1席のみ余っているため、同乗者を調整して2席以上の空きを作ってください`
      });
    }
  });

  // 車酔い配慮
  const sickKids = ridingKids.filter(k => k.motionSick);
  if (sickKids.length > 0) {
    const carsWithRoom = activeCars.filter(c => {
      const rem = (parseInt(c.capacity, 10) || 0) - companionSeatsOf(c);
      return rem >= 1;
    });
    if (carsWithRoom.length === 0) {
      suggestions.push({
        priority: 22,
        tag: 'E',
        text: `🤢酔いの選手（${sickKids.map(k => k.name).join('、')}）を乗せる空き車両がありません。出勤を増やすか同乗を減らしてください`
      });
    } else if (sickKids.length > carsWithRoom.length * 2) {
      notes.push(`🤢酔い配慮: ${sickKids.map(k => k.name).join('、')}（空き車が少ない可能性）`);
    }
  }

  if (activeCars.length === 0) {
    suggestions.unshift({
      priority: 5,
      tag: 'B',
      text: '出勤中の車がありません。車両の出勤チェックを入れてください'
    });
  }

  suggestions.sort((a, b) => a.priority - b.priority || a.tag.localeCompare(b.tag));

  // 重複テキスト除去
  const seen = new Set();
  const unique = [];
  suggestions.forEach(s => {
    if (seen.has(s.text)) return;
    seen.add(s.text);
    unique.push(s);
  });

  return {
    kidSeatDemand,
    carCompanionSeats,
    totalCap,
    openSeats,
    totalNeed,
    shortage,
    notes,
    suggestions: unique.slice(0, 10),
    severity: shortage > 0 || leftoverKids.length > 0 || activeCars.length === 0 ? 'error' : 'warning'
  };
}

function showCarpoolDiagnosis(diagnosis) {
  const el = document.getElementById('carpoolDiagnosis');
  if (!el || !diagnosis) return;

  const shortageLine = diagnosis.shortage > 0
    ? `必要座席数: ${diagnosis.totalNeed}席（選手・同乗 ${diagnosis.kidSeatDemand} ＋ 車両同乗 ${diagnosis.carCompanionSeats}）に対し、空き枠が ${diagnosis.shortage}席 不足しています（定員合計 ${diagnosis.totalCap}席）`
    : diagnosis.leftoverKids && diagnosis.leftoverKids.length
      ? `全体の席数は足りていますが、固定枠や1席余りの制約で一部の選手を割り当てられませんでした`
      : `配車条件が競合しています。下記の調整をお試しください`;

  const notesHtml = (diagnosis.notes || []).length
    ? `<ul class="diagnosis-list">${diagnosis.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '';

  const actionsHtml = (diagnosis.suggestions || []).length
    ? `<ul class="diagnosis-list">${diagnosis.suggestions.map(s =>
        `<li><span class="tag">${escapeHtml(s.tag)}</span>${escapeHtml(s.text)}</li>`
      ).join('')}</ul>`
    : `<p class="diagnosis-section-label">具体的な解放候補が見つかりませんでした。定員の追加や現地集合への変更をご検討ください。</p>`;

  el.classList.toggle('is-warning', diagnosis.severity === 'warning');
  el.innerHTML = `
    <h3 class="diagnosis-title">⚠️ 配車が成立しませんでした</h3>
    <div class="diagnosis-shortage"><strong>【不足状況】</strong><br>${escapeHtml(shortageLine)}</div>
    ${notesHtml ? `<p class="diagnosis-section-label">【診断メモ】</p>${notesHtml}` : ''}
    <p class="diagnosis-section-label">【解決アクションのサジェスト】（優先度順）</p>
    ${actionsHtml}
  `;
  el.hidden = false;
  el.classList.add('is-visible');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderAssignmentWarnings(warnings) {
  lastAssignmentWarnings = Array.isArray(warnings) ? warnings.slice() : [];
  const el = document.getElementById('resultWarnings');
  if (!el) return;
  if (!lastAssignmentWarnings.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = lastAssignmentWarnings.map((text) =>
    `<p class="result-warning-badge">${escapeHtml(text)}</p>`
  ).join('');
}

function presentCarpoolFailure(extra) {
  currentAssignments = null;
  lastGeneratedPlan = '';
  renderAssignmentWarnings([]);
  const resultCard = document.getElementById('resultCard');
  if (resultCard) resultCard.style.display = 'none';
  const resultText = document.getElementById('resultText');
  if (resultText) resultText.textContent = '';

  const diagnosis = diagnoseCarpoolFailure(extra || {});
  if (extra && extra.leftoverKids) diagnosis.leftoverKids = extra.leftoverKids;
  showCarpoolDiagnosis(diagnosis);
}

const MAX_SWAP_TRIALS = 280;

function isPitcher(kid) {
  const pos = String(kid && kid.pos || '').trim();
  return pos === '投手' || pos === 'P' || pos === 'ピッチャー';
}

function isCatcher(kid) {
  const pos = String(kid && kid.pos || '').trim();
  return pos === '捕手' || pos === 'C' || pos === 'キャッチャー';
}

function assignmentCars(assignments) {
  return Object.keys(assignments || {})
    .map((name) => cars.find((car) => car.name === name))
    .filter(Boolean);
}

function isSwappable(kid, activeCars) {
  if (!kid) return false;
  if (kid.fixedCar && activeCars.some((car) => car.name === kid.fixedCar)) return false;
  if (kid.parentCar && activeCars.some((car) => car.name === kid.parentCar)) return false;
  return true;
}

function medianCapacity(activeCars) {
  const caps = activeCars.map((car) => parseInt(car.capacity, 10) || 0).sort((a, b) => a - b);
  if (!caps.length) return 0;
  const mid = Math.floor(caps.length / 2);
  if (caps.length % 2) return caps[mid];
  return (caps[mid - 1] + caps[mid]) / 2;
}

/** 減点方式。高いほど良い。座席不足のハード失敗はここでは扱わない。 */
function evaluateAssignmentScore(assignments) {
  const activeCars = assignmentCars(assignments);
  let score = 0;
  let totalRiders = 0;
  activeCars.forEach((car) => {
    totalRiders += (assignments[car.name] || []).length;
  });
  const penalizeSolo = activeCars.length > 0 && totalRiders >= activeCars.length * 2;
  const median = medianCapacity(activeCars);
  const averages = [];

  activeCars.forEach((car) => {
    const riders = assignments[car.name] || [];
    if (penalizeSolo && riders.length === 1) score -= 1000;

    const pitchers = riders.filter(isPitcher).length;
    if (pitchers >= 2) score -= 150 * pitchers;
    const catchers = riders.filter(isCatcher).length;
    if (catchers >= 2) score -= 150 * catchers;

    const cap = parseInt(car.capacity, 10) || 0;
    if (cap < median) {
      riders.forEach((kid) => {
        if (kid.motionSick) score -= 200;
      });
    }

    if (riders.length > 0) {
      const sum = riders.reduce((total, kid) => total + (Number(kid.grade) || 0), 0);
      averages.push(sum / riders.length);
    }
  });

  if (averages.length >= 2) {
    const mean = averages.reduce((total, value) => total + value, 0) / averages.length;
    const variance = averages.reduce((total, value) => total + (value - mean) * (value - mean), 0) / averages.length;
    score -= variance * 30;
  }
  return score;
}

function canSwapSeats(carA, kidA, carB, kidB, assignments) {
  const delta = seatCost(kidB) - seatCost(kidA);
  const capA = parseInt(carA.capacity, 10) || 0;
  const capB = parseInt(carB.capacity, 10) || 0;
  const usedA = companionSeatsOf(carA) + occupiedSeats(assignments[carA.name]);
  const usedB = companionSeatsOf(carB) + occupiedSeats(assignments[carB.name]);
  return usedA + delta <= capA && usedB - delta <= capB;
}

function optimizeBySwaps(assignments, activeCars) {
  let trials = 0;
  let improved = true;
  while (improved && trials < MAX_SWAP_TRIALS) {
    improved = false;
    for (let a = 0; a < activeCars.length && trials < MAX_SWAP_TRIALS; a++) {
      for (let b = a + 1; b < activeCars.length && trials < MAX_SWAP_TRIALS; b++) {
        const carA = activeCars[a];
        const carB = activeCars[b];
        const listA = assignments[carA.name];
        const listB = assignments[carB.name];
        for (let i = 0; i < listA.length && trials < MAX_SWAP_TRIALS; i++) {
          const kidA = listA[i];
          if (!isSwappable(kidA, activeCars)) continue;
          for (let j = 0; j < listB.length && trials < MAX_SWAP_TRIALS; j++) {
            const kidB = listB[j];
            if (!isSwappable(kidB, activeCars)) continue;
            if (!canSwapSeats(carA, kidA, carB, kidB, assignments)) continue;
            trials += 1;
            const before = evaluateAssignmentScore(assignments);
            listA[i] = kidB;
            listB[j] = kidA;
            const after = evaluateAssignmentScore(assignments);
            if (after > before + 1e-6) {
              improved = true;
              a = activeCars.length;
              b = activeCars.length;
              i = listA.length;
              j = listB.length;
            } else {
              listA[i] = kidA;
              listB[j] = kidB;
            }
          }
        }
      }
    }
  }
}

function preferCar(list, kid, assignments) {
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    const car = list[i];
    const bestCount = assignments[best.name].length;
    const carCount = assignments[car.name].length;
    if (carCount !== bestCount) {
      if (carCount < bestCount) best = car;
      continue;
    }
    const bestCap = parseInt(best.capacity, 10) || 0;
    const carCap = parseInt(car.capacity, 10) || 0;
    if (kid.motionSick) {
      if (carCap > bestCap) best = car;
    } else if (carCap < bestCap) {
      best = car;
    }
  }
  return best;
}

function chooseCarForFreeKid(kid, assignments, activeCars, carsToUse) {
  const fitting = activeCars.filter((car) => remainingSeats(car, assignments) >= seatCost(kid));
  if (!fitting.length) return null;
  const singles = fitting.filter((car) => assignments[car.name].length === 1);
  if (singles.length) return preferCar(singles, kid, assignments);

  const nonEmpty = activeCars.reduce((count, car) => (
    count + ((assignments[car.name] || []).length > 0 ? 1 : 0)
  ), 0);
  const empties = fitting.filter((car) => assignments[car.name].length === 0);
  if (nonEmpty < carsToUse && empties.length) return preferCar(empties, kid, assignments);

  const used = fitting.filter((car) => assignments[car.name].length > 0);
  if (used.length) return preferCar(used, kid, assignments);
  return preferCar(fitting, kid, assignments);
}

function repairLeftovers(leftover, assignments, activeCars) {
  const still = [];
  leftover.forEach((kid) => {
    let placed = false;
    for (let a = 0; a < activeCars.length && !placed; a++) {
      const from = activeCars[a];
      const list = assignments[from.name];
      for (let i = 0; i < list.length && !placed; i++) {
        const mover = list[i];
        if (!isSwappable(mover, activeCars)) continue;
        list.splice(i, 1);
        const dest = remainingSeats(from, assignments) >= seatCost(kid)
          ? activeCars.find((car) => car !== from && remainingSeats(car, assignments) >= seatCost(mover))
          : null;
        if (!dest) {
          list.splice(i, 0, mover);
          continue;
        }
        assignments[dest.name].push(mover);
        assignments[from.name].push(kid);
        placed = true;
      }
    }
    if (!placed) still.push(kid);
  });
  return still;
}

function collectSoftWarnings(assignments, activeCars) {
  const warnings = [];
  const median = medianCapacity(activeCars);
  activeCars.forEach((car) => {
    const riders = assignments[car.name] || [];
    if (riders.length === 1) warnings.push(`※${car.name}は選手1名のみの乗車です`);
    if (riders.filter(isPitcher).length >= 2) warnings.push(`※${car.name}に投手が重複しています`);
    if (riders.filter(isCatcher).length >= 2) warnings.push(`※${car.name}に捕手が重複しています`);
    const cap = parseInt(car.capacity, 10) || 0;
    if (cap < median) {
      riders.forEach((kid) => {
        if (kid.motionSick) warnings.push(`※${kid.name}は車酔い配慮の車両に乗れていません`);
      });
    }
  });
  return warnings;
}

function attachAssignmentWarnings(assignments, warnings) {
  const list = warnings.slice();
  Object.defineProperty(assignments, 'warnings', {
    value: list,
    enumerable: false,
    configurable: true,
    writable: true
  });
  lastAssignmentWarnings = list;
  return list;
}

/**
 * フェーズ1で固定ピン・親車・最低2名の骨格を作り、フェーズ2でソフト制約をスワップする。
 * 席が物理的に足りないときだけ leftover を返す。
 */
function buildTwoPhaseAssignment(activeCars, ridingKids) {
  const assignments = {};
  activeCars.forEach((car) => { assignments[car.name] = []; });

  const overflowedCars = [];
  const afterPins = [];
  ridingKids.forEach((kid) => {
    if (!kid.fixedCar) {
      afterPins.push(kid);
      return;
    }
    const car = activeCars.find((item) => item.name === kid.fixedCar);
    if (car && remainingSeats(car, assignments) >= seatCost(kid)) {
      assignments[car.name].push(kid);
      return;
    }
    if (car && !overflowedCars.includes(car.name)) overflowedCars.push(car.name);
    afterPins.push(kid);
  });

  const free = [];
  afterPins.forEach((kid) => {
    const pinnedElsewhere = kid.fixedCar && activeCars.some((car) => car.name === kid.fixedCar);
    if (!pinnedElsewhere && kid.parentCar) {
      const car = activeCars.find((item) => item.name === kid.parentCar);
      if (car && remainingSeats(car, assignments) >= seatCost(kid)) {
        assignments[car.name].push(kid);
        return;
      }
    }
    free.push(kid);
  });

  free.sort((a, b) => {
    const sick = (b.motionSick ? 1 : 0) - (a.motionSick ? 1 : 0);
    if (sick) return sick;
    const cost = seatCost(b) - seatCost(a);
    if (cost) return cost;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
  });

  const carsToUse = Math.min(
    activeCars.length,
    Math.max(1, Math.floor(ridingKids.length / 2))
  );
  let leftover = [];
  free.forEach((kid) => {
    const car = chooseCarForFreeKid(kid, assignments, activeCars, carsToUse);
    if (!car) leftover.push(kid);
    else assignments[car.name].push(kid);
  });

  if (leftover.length) leftover = repairLeftovers(leftover, assignments, activeCars);
  if (!leftover.length) optimizeBySwaps(assignments, activeCars);
  return { assignments, overflowedCars, leftover };
}

// 骨格確定のあと、入れ替えでソフト制約を上げる
function generateCarpool() {
  clearCarpoolDiagnosis();
  renderAssignmentWarnings([]);

  const activeCars = cars.filter(c => c.active);
  const ridingKids = children.filter(isRiding);
  const onSiteKids = children.filter(isOnSite);

  if (ridingKids.length === 0 && onSiteKids.length === 0) {
    alert("参加する子供（乗車または現地集合）を選んでください。");
    return;
  }

  let assignments = {};
  const warnings = [];

  if (ridingKids.length > 0) {
    if (activeCars.length === 0) {
      presentCarpoolFailure();
      return;
    }

    const totalCap = activeCars.reduce((sum, c) => sum + (parseInt(c.capacity, 10) || 0), 0);
    const familyDemand = activeCars.reduce((sum, c) => sum + familySeatsOf(c), 0);
    const seatDemand = ridingKids.reduce((sum, c) => sum + seatCost(c), 0) + familyDemand;
    if (totalCap < seatDemand) {
      alert(`座席が${seatDemand - totalCap}席不足しています`);
      presentCarpoolFailure();
      return;
    }

    if (activeCars.length * 2 > ridingKids.length) {
      warnings.push('車両数が多いため、1名乗車の車両が発生します');
    }

    const built = buildTwoPhaseAssignment(activeCars, ridingKids);
    if (built.overflowedCars.length > 0) {
      alert(`${built.overflowedCars.map(n => `「${n}」`).join('、')}の定員を超えて指定されています。\nあふれた分は自動配車に回します。`);
    }
    if (built.leftover.length > 0) {
      presentCarpoolFailure({ leftoverKids: built.leftover });
      return;
    }
    assignments = built.assignments;
    collectSoftWarnings(assignments, activeCars).forEach((text) => warnings.push(text));
  }

  clearCarpoolDiagnosis();
  attachAssignmentWarnings(assignments, warnings);
  currentAssignments = assignments;

  function carHasAnyone(car, riders) {
    return (riders && riders.length > 0) || companionSeatsOf(car) > 0;
  }

  /** LINE用: 選手・選手同乗・車両同乗の名前を順にフラット化（注記なし） */
  function buildLineNameList(car, riders) {
    const names = [];
    (riders || []).forEach(k => {
      names.push(k.name);
      childCompanionsOf(k).forEach(c => {
        names.push(c.label);
      });
    });
    companionsOf(car).forEach(c => {
      names.push(c.label);
    });
    return names;
  }

  // 画面用テキスト（📌あり／同乗は名前列挙）
  function buildScreenPlanText() {
    let hasMotionSick = ridingKids.some(k => k.motionSick);
    let hasPinned = ridingKids.some(k => k.fixedCar && activeCars.some(c => c.name === k.fixedCar));
    let text = `【連絡】本日の配車です🚗\n---------------------\n`;

    if (ridingKids.length > 0 || activeCars.some(c => companionSeatsOf(c) > 0)) {
      activeCars.forEach(c => {
        const riders = assignments[c.name] || [];
        const riderNames = riders.map(k => formatRiderLabel(k, c.name, { showPin: true }));
        const companionNames = companionsOf(c).map(x => x.label);
        const names = [...riderNames, ...companionNames].join('、');
        const equipTag = c.isEquipmentCar ? ' 【道具車📦】' : '';
        text += `■ ${c.name}${formatCarCompanionHeader(c)}${equipTag}\n  乗車: ${names || 'なし'}\n\n`;
      });
    } else {
      text += "本日の乗車配車はありません。\n\n";
    }

    if (onSiteKids.length > 0) {
      text += `【現地集合】${onSiteKids.map(k => k.name).join('、')}\n\n`;
    }

    if (hasPinned) {
      text += "※「📌」は事前指定で固定した乗車です。\n";
    }
    if (hasMotionSick) {
      text += "※「🤢」マークの選手は助手席または前寄りの座席をお願いします。\n";
    }
    text += "---------------------\nよろしくお願いいたします！";
    return text;
  }

  // LINE用テキスト（1台1行の横並び・注記なし。車両見出しのみ【道具車】可）
  function buildLinePlanText() {
    let text = `【連絡】本日の配車です🚗\n---------------------\n`;

    if (ridingKids.length > 0 || activeCars.some(c => companionSeatsOf(c) > 0)) {
      activeCars.forEach(c => {
        const riders = assignments[c.name] || [];
        const names = buildLineNameList(c, riders);
        const equipTag = c.isEquipmentCar ? ' 【道具車】' : '';
        text += `■ ${c.name}${formatCarCompanionHeader(c)}${equipTag}\n`;
        text += `${names.length > 0 ? names.join('、') : 'なし'}\n\n`;
      });
    } else {
      text += "本日の乗車配車はありません。\n\n";
    }

    if (onSiteKids.length > 0) {
      text += `【現地集合】\n${onSiteKids.map(k => k.name).join('、')}\n\n`;
    }

    text += "---------------------\nよろしくお願いいたします！";
    return text;
  }

  const screenText = buildScreenPlanText();
  lastGeneratedPlan = buildLinePlanText();
  renderAssignmentWarnings(lastAssignmentWarnings);
  document.getElementById('resultText').innerText = screenText;
  document.getElementById('resultCard').style.display = 'block';
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function copyResult() {
  if (!currentAssignments && !lastGeneratedPlan) return;

  if (currentAssignments) {
    // 同セッション内の再コピー: 直前確定分を差し戻してから今回分を加算
    rollbackLastSessionCommit();
    rollbackLastDispatchCommit();
    const commitMap = applyAssignmentHistoryCommit(currentAssignments);
    recordConfirmedDispatches(currentAssignments);
    writeLastSessionCommit(commitMap);
    saveData();
    renderChildren();
    renderCars();
    updateStatusBar();
  }

  // 履歴確定後にクリップボード＋iOS共有シート（Capacitor Share）
  shareDispatchText(lastGeneratedPlan || '').catch((err) => {
    console.error('shareDispatchText failed:', err);
  });
}


  const HaishaCarpool = {
    generate: generateCarpool,
    diagnose: diagnoseCarpoolFailure,
    copyResult,
    clearDiagnosis: clearCarpoolDiagnosis,
    clearLastSessionCommit,
    clearCarpoolDiagnosis,
    diagnoseCarpoolFailure,
    generateCarpool,
    presentCarpoolFailure,
    showCarpoolDiagnosis,
    buildLinePlanText: function buildLinePlanText() { return lastGeneratedPlan || ''; },
    get lastGeneratedPlan() { return lastGeneratedPlan; },
    set lastGeneratedPlan(v) { lastGeneratedPlan = v; },
    get currentAssignments() { return currentAssignments; },
    set currentAssignments(v) { currentAssignments = v; },
    get assignmentWarnings() { return lastAssignmentWarnings.slice(); },
    evaluateAssignmentScore,
    get lastSessionCommit() { return lastSessionCommit; }
  };
  global.HaishaCarpool = HaishaCarpool;

  Object.defineProperty(global, 'currentAssignments', {
    get() { return currentAssignments; },
    set(v) { currentAssignments = v; },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(global, 'lastGeneratedPlan', {
    get() { return lastGeneratedPlan; },
    set(v) { lastGeneratedPlan = v; },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(global, 'lastSessionCommit', {
    get() { return lastSessionCommit; },
    set(v) { lastSessionCommit = v; },
    configurable: true,
    enumerable: true
  });

  global.generateCarpool = generateCarpool;
  global.generate = generateCarpool;
  global.copyResult = copyResult;
  global.clearCarpoolDiagnosis = clearCarpoolDiagnosis;
  global.clearLastSessionCommit = clearLastSessionCommit;
  global.diagnoseCarpoolFailure = diagnoseCarpoolFailure;
  global.presentCarpoolFailure = presentCarpoolFailure;
  global.showCarpoolDiagnosis = showCarpoolDiagnosis;
  global.readLastSessionCommit = readLastSessionCommit;
  global.writeLastSessionCommit = writeLastSessionCommit;
  global.rollbackLastSessionCommit = rollbackLastSessionCommit;
  global.applyAssignmentHistoryCommit = applyAssignmentHistoryCommit;
  global.occupiedSeats = occupiedSeats;
  global.carPeopleCount = carPeopleCount;
  global.remainingSeats = remainingSeats;
  global.placeKid = placeKid;
  global.escapeHtml = escapeHtml;

})(typeof window !== 'undefined' ? window : globalThis);
