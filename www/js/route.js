(function (global) {
const DETOUR_FACTOR = 1.35;
const SPEED_KMH = 20;
const FALLBACK_DRIVE_MINUTES = 5;
const DEFAULT_DEPARTURE = '14:30';

function hasPoint(point) {
  if (!point || point.lat == null || point.lng == null || point.lat === '' || point.lng === '') return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function pointOf(value) {
  if (!hasPoint(value)) return null;
  return { lat: Number(value.lat), lng: Number(value.lng) };
}

/** 2点間の直線距離（km）。座標が無ければ null。 */
function haversineKm(from, to) {
  const a = pointOf(from);
  const b = pointOf(to);
  if (!a || !b) return null;
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ドライバーの現在地からその地点までの経路案内。
 * 座標があればそのピン、無ければ住所。どちらも無ければ空文字。
 * APIキーは不要で、スマホでは Google マップアプリが開く。
 */
function mapsNavigationUrl(point) {
  if (!point) return '';
  let destination = '';
  if (hasPoint(point)) {
    destination = `${Number(point.lat)},${Number(point.lng)}`;
  } else {
    destination = String(point.address || '').trim();
  }
  if (!destination) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/** 市街地の推定走行分。座標が無い区間は目安の固定分。 */
function calculateTravelTime(from, to) {
  const km = haversineKm(from, to);
  if (km == null) return FALLBACK_DRIVE_MINUTES;
  if (km === 0) return 0;
  const minutes = (km * DETOUR_FACTOR / SPEED_KMH) * 60;
  return Math.max(1, Math.round(minutes));
}

function tagNamesOf(passenger) {
  if (!passenger) return [];
  const source = Array.isArray(passenger.careTags)
    ? passenger.careTags
    : (Array.isArray(passenger.positions) ? passenger.positions : []);
  return source.map((tag) => String(tag || '').trim()).filter(Boolean);
}

/** 個別の乗降分があればそれを優先。無ければタグから 2 / 5 / 8 分。 */
function getDwellTime(passenger) {
  if (passenger && passenger.boardingTimeMinutes != null && passenger.boardingTimeMinutes !== '') {
    const custom = Number(passenger.boardingTimeMinutes);
    if (Number.isFinite(custom) && custom >= 0) return Math.round(custom);
  }
  const names = tagNamesOf(passenger);
  const hit = (needle) => names.some((name) => name.indexOf(needle) !== -1);
  if (hit('車椅子')) return 8;
  if (hit('単独乗車NG') || hit('見守り')) return 5;
  return 2;
}

function parseTimeToMinutes(value) {
  const match = typeof value === 'string' ? value.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!match) return parseTimeToMinutes(DEFAULT_DEPARTURE);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return 14 * 60 + 30;
  return hours * 60 + minutes;
}

function formatMinutesToTime(total) {
  const day = 24 * 60;
  const rounded = Math.round(Number(total) || 0);
  const minutes = ((rounded % day) + day) % day;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function pathCost(order, matrix) {
  let cost = matrix[0][order[0]];
  for (let i = 0; i < order.length - 1; i += 1) cost += matrix[order[i]][order[i + 1]];
  cost += matrix[order[order.length - 1]][0];
  return cost;
}

function nearestNeighbor(matrix, count) {
  const used = new Array(count + 1).fill(false);
  const order = [];
  let current = 0;
  for (let step = 0; step < count; step += 1) {
    let best = -1;
    let bestCost = Infinity;
    for (let next = 1; next <= count; next += 1) {
      if (used[next]) continue;
      if (matrix[current][next] < bestCost) {
        bestCost = matrix[current][next];
        best = next;
      }
    }
    if (best < 0) break;
    used[best] = true;
    order.push(best);
    current = best;
  }
  return order;
}

function twoOpt(order, matrix) {
  let best = order.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard < 24) {
    improved = false;
    guard += 1;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = best.slice();
        const reversed = candidate.slice(i, k + 1).reverse();
        candidate.splice(i, reversed.length, ...reversed);
        if (pathCost(candidate, matrix) < pathCost(best, matrix)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** 施設固定の巡回。座標が揃わないときは入力順を保つ。 */
function solveTSP(facility, passengers) {
  const list = Array.isArray(passengers) ? passengers.filter(Boolean) : [];
  if (list.length <= 1) return list.slice();
  if (!hasPoint(facility) || list.some((passenger) => !hasPoint(passenger))) return list.slice();

  const points = [facility].concat(list);
  const count = list.length;
  const matrix = Array.from({ length: count + 1 }, () => new Array(count + 1).fill(0));
  for (let i = 0; i <= count; i += 1) {
    for (let j = i + 1; j <= count; j += 1) {
      const minutes = calculateTravelTime(points[i], points[j]);
      matrix[i][j] = minutes;
      matrix[j][i] = minutes;
    }
  }
  const order = twoOpt(nearestNeighbor(matrix, count), matrix);
  return order.map((index) => list[index - 1]);
}

function optimizeRouteSchedule(options) {
  const source = options || {};
  const vehicle = source.vehicle || null;
  const passengers = Array.isArray(source.passengers) ? source.passengers.filter(Boolean) : [];
  const facility = source.facility || { name: '施設', lat: null, lng: null };
  const departureTime = source.departureTime || facility.defaultDepartureTime || DEFAULT_DEPARTURE;
  if (!passengers.length) return { vehicle, route: [], timeline: [], totalMinutes: 0, approximated: false };

  const approximated = !hasPoint(facility) || passengers.some((passenger) => !hasPoint(passenger));
  const sortedPassengers = solveTSP(facility, passengers);
  let currentTime = parseTimeToMinutes(departureTime);
  const startMinutes = currentTime;
  const timeline = [{
    type: 'depot_start',
    name: facility.name || '施設',
    departureTime: formatMinutesToTime(currentTime)
  }];
  let previousPoint = facility;

  sortedPassengers.forEach((passenger) => {
    const driveMinutes = calculateTravelTime(previousPoint, passenger);
    currentTime += driveMinutes;
    const arrivalTime = formatMinutesToTime(currentTime);
    const dwellMinutes = getDwellTime(passenger);
    currentTime += dwellMinutes;
    timeline.push({
      type: 'passenger',
      id: passenger.id,
      name: passenger.name || '',
      address: passenger.address || '',
      lat: hasPoint(passenger) ? Number(passenger.lat) : null,
      lng: hasPoint(passenger) ? Number(passenger.lng) : null,
      mapsUrl: mapsNavigationUrl(passenger),
      arrivalTime,
      departureTime: formatMinutesToTime(currentTime),
      dwellMinutes,
      driveMinutes,
      careTags: tagNamesOf(passenger)
    });
    previousPoint = hasPoint(passenger) ? passenger : { lat: null, lng: null };
  });

  const returnDrive = calculateTravelTime(previousPoint, facility);
  currentTime += returnDrive;
  timeline.push({
    type: 'depot_end',
    name: facility.name || '施設',
    arrivalTime: formatMinutesToTime(currentTime),
    driveMinutes: returnDrive
  });

  return {
    vehicle,
    route: sortedPassengers,
    timeline,
    totalMinutes: currentTime - startMinutes,
    approximated
  };
}

function formatOneRouteText(schedule) {
  if (!schedule || !Array.isArray(schedule.timeline) || !schedule.timeline.length) return '';
  const vehicleName = schedule.vehicle && schedule.vehicle.name ? schedule.vehicle.name : '車両';
  let text = `■ ${vehicleName}\n`;
  schedule.timeline.forEach((stop) => {
    if (stop.type === 'depot_start') {
      text += `[${stop.departureTime}] 出発: ${stop.name}\n`;
      return;
    }
    if (stop.type === 'passenger') {
      text += `  ↓ (車 ${stop.driveMinutes}分)\n`;
      const tags = stop.careTags && stop.careTags.length ? ` [${stop.careTags.join('、')}]` : '';
      text += `[${stop.arrivalTime}着 - ${stop.departureTime}発] ${stop.name}${tags} (乗降${stop.dwellMinutes}分)\n`;
      if (stop.address) text += `  住所: ${stop.address}\n`;
      return;
    }
    if (stop.type === 'depot_end') {
      text += `  ↓ (車 ${stop.driveMinutes}分)\n`;
      text += `[${stop.arrivalTime}] 到着: ${stop.name} (総所要時間: ${schedule.totalMinutes}分)\n`;
    }
  });
  if (schedule.approximated) text += '  ※座標未登録の区間は登録順・目安5分で積算\n';
  return text;
}

function formatRouteScheduleText(schedules) {
  const blocks = (Array.isArray(schedules) ? schedules : []).map(formatOneRouteText).filter(Boolean);
  if (!blocks.length) return '';
  return `【巡回時刻】\n${blocks.join('\n')}`;
}

  const HaishaRoute = {
    haversineKm,
    mapsNavigationUrl,
    calculateTravelTime,
    getDwellTime,
    solveTSP,
    optimizeRouteSchedule,
    formatRouteScheduleText,
    parseTimeToMinutes,
    formatMinutesToTime,
    FALLBACK_DRIVE_MINUTES
  };
  global.HaishaRoute = HaishaRoute;
  global.haversineKm = haversineKm;
  global.mapsNavigationUrl = mapsNavigationUrl;
  global.calculateTravelTime = calculateTravelTime;
  global.getDwellTime = getDwellTime;
  global.solveTSP = solveTSP;
  global.optimizeRouteSchedule = optimizeRouteSchedule;
  global.formatRouteScheduleText = formatRouteScheduleText;
  global.parseTimeToMinutes = parseTimeToMinutes;
  global.formatMinutesToTime = formatMinutesToTime;
})(typeof window !== 'undefined' ? window : globalThis);
