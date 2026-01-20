#!/usr/bin/env node
/**
 * gpx_pacing_full.js (Node 18+)
 *
 * FULL VERSION:
 * - Reads a GPX
 * - Resamples the track every N meters (default 250m)
 * - Computes slope% for each segment
 * - Calibrates Vflat (km/h) via binary search to hit a target moving time
 *   (target total time - total planned stop time)
 * - Splits into steps (stages) based on checkpoints (km positions)
 * - Outputs:
 *   - totals (distance, D+/D-, target time, stop time, moving target)
 *   - vFlat, flat pace
 *   - per-250m: slope%, speed, pace, time
 *   - per-km: average pace/time (+ split details)
 *   - steps: stage summary (distance, D+/D-, moving time, stops, total, avg pace)
 *   - optional elevation profile points (samples)
 *
 * USAGE:
 *   node gpx_pacing_full.js track.gpx \
 *     --target 20:30:00 \
 *     --profile trained \
 *     --step 250 \
 *     --smooth 9 \
 *     --prudence 0.5 \
 *     --cp 18,4 --cp 42,8 --cp 66,10 \
 *     --sleep 1,30 \
 *     --out out.json
 *
 * FLAGS:
 *   --target   HH:MM or HH:MM:SS (required)
 *   --profile  trained|standard (default trained)
 *   --prudence 0..1 (default 0.5) affects "range" segments (0=fast end, 1=slow end)
 *   --step     meters for resampling (default 250)
 *   --smooth   odd integer >=1 (default 9) moving average on elevation
 *   --cp       checkpoint definition: "<km>,<stopMinutes>" repeatable
 *              Example: --cp 18,4 --cp 42,8
 *   --sleep    "<count>,<minutesEach>" (optional) adds count * minutesEach to stop time
 *              Example: --sleep 1,30
 *   --vmin     min Vflat bound (km/h, default 3)
 *   --vmax     max Vflat bound (km/h, default 25)
 *   --iters    binary search iterations (default 40)
 *   --out      output file path (if omitted -> stdout)
 *
 * NOTES / V1 assumptions:
 * - Downhill range rules are capped only by their own ranges; you can add Vmax caps if desired.
 * - Elevation noise is smoothed (recommended).
 * - Segment slope uses (deltaElev / segmentLength)*100; segmentLength is along-track distance.
 */

import * as fs from "fs";
import * as path from "path";

// ------------------------ CLI args ------------------------
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith("-")) {
  console.error("Usage: node gpx_pacing_full.js <file.gpx> --target HH:MM[:SS] [options]");
  process.exit(1);
}

const gpxPath = argv[0];
const targetStr = getArg("--target", "");
if (!targetStr) {
  console.error("Error: --target is required (HH:MM or HH:MM:SS)");
  process.exit(1);
}

const profile = (getArg("--profile", "trained") || "trained").toLowerCase();
if (!["trained", "standard"].includes(profile)) {
  console.error("Error: --profile must be 'trained' or 'standard'");
  process.exit(1);
}

const stepM = Number(getArg("--step", "250"));
const smoothWindow = Number(getArg("--smooth", "9"));
const prudence = clamp01(Number(getArg("--prudence", "0.5")));

const vminBound = Number(getArg("--vmin", "3"));
const vmaxBound = Number(getArg("--vmax", "25"));
const iters = Number(getArg("--iters", "40"));

const sleepArg = getArg("--sleep", "");
const outPath = getArg("--out", "");

if (!Number.isFinite(stepM) || stepM <= 0) throw new Error("--step must be a positive number");
if (!Number.isFinite(smoothWindow) || smoothWindow < 1 || smoothWindow % 2 === 0) {
  throw new Error("--smooth must be an odd integer >= 1 (e.g. 1, 5, 9, 11)");
}
if (!Number.isFinite(vminBound) || !Number.isFinite(vmaxBound) || vminBound <= 0 || vmaxBound <= vminBound) {
  throw new Error("--vmin/--vmax bounds invalid");
}
if (!Number.isFinite(iters) || iters < 10) throw new Error("--iters must be >= 10");

const targetTotalSec = parseTimeToSeconds(targetStr);
if (targetTotalSec <= 0) throw new Error("--target must be > 0");

// Parse checkpoints: repeatable --cp "<km>,<stopMin>"
const checkpointArgs = getAllArgs("--cp");
const checkpoints = checkpointArgs
  .map((s) => parseCheckpoint(s))
  .filter(Boolean)
  .sort((a, b) => a.km - b.km);

// Parse sleep: "<count>,<minutesEach>"
let sleepCount = 0;
let sleepMinEach = 0;
if (sleepArg) {
  const parts = sleepArg.split(",").map((x) => x.trim());
  if (parts.length !== 2) throw new Error("--sleep must be '<count>,<minutesEach>'");
  sleepCount = Number(parts[0]);
  sleepMinEach = Number(parts[1]);
  if (!Number.isFinite(sleepCount) || !Number.isFinite(sleepMinEach) || sleepCount < 0 || sleepMinEach < 0) {
    throw new Error("--sleep values invalid");
  }
}

const sleepStopSec = Math.round(sleepCount * sleepMinEach * 60);
const checkpointsStopSec = checkpoints.reduce((s, c) => s + c.stopSec, 0);
const totalStopSec = sleepStopSec + checkpointsStopSec;

// ------------------------ GPX parsing (minimal, no deps) ------------------------
function parseGpxPoints(xml) {
  const points = [];
  const trkptRegex = /<trkpt\b[^>]*?lat="([^"]+)"[^>]*?lon="([^"]+)"[^>]*?>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = trkptRegex.exec(xml)) !== null) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const inner = m[3];
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? Number(eleMatch[1]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
    }
  }
  if (points.length < 2) throw new Error("Not enough <trkpt> points found in GPX.");
  return points;
}

// ------------------------ Geo helpers ------------------------
const R = 6371000; // meters
function toRad(deg) { return (deg * Math.PI) / 180; }
function haversineM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}
function lerp(a, b, t) { return a + (b - a) * t; }

// ------------------------ Smoothing ------------------------
function movingAverage(arr, windowSize) {
  if (windowSize === 1) return arr.slice();
  const half = Math.floor(windowSize / 2);
  const out = new Array(arr.length).fill(null);

  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length && arr[j] !== null && Number.isFinite(arr[j])) {
        sum += arr[j];
        count++;
      }
    }
    out[i] = count ? sum / count : null;
  }
  return out;
}
function fillMissing(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) last = out[i];
    else if (last !== null) out[i] = last;
  }
  let next = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (Number.isFinite(out[i])) next = out[i];
    else if (next !== null) out[i] = next;
  }
  return out.map(v => (Number.isFinite(v) ? v : 0));
}

// ------------------------ Resample ------------------------
function resampleByDistance(pts, cum, stepM) {
  const total = cum[cum.length - 1];
  const targets = [];
  for (let d = 0; d < total; d += stepM) targets.push(d);
  targets.push(total); // include end

  const out = [];
  let j = 1;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    while (j < cum.length && cum[j] < target) j++;
    if (j >= cum.length) j = cum.length - 1;

    const d0 = cum[j - 1];
    const d1 = cum[j];
    const t = d1 === d0 ? 0 : (target - d0) / (d1 - d0);

    const p0 = pts[j - 1];
    const p1 = pts[j];

    const lat = lerp(p0.lat, p1.lat, t);
    const lon = lerp(p0.lon, p1.lon, t);
    const ele = lerp(p0.ele, p1.ele, t);

    out.push({ index: i, distanceM: target, lat, lon, ele });
  }
  return out;
}

// ------------------------ Speed rules (your formulas) ------------------------
function clamp01(x) {
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

/**
 * For ranges (like 9:00-11:00 pace), we convert to km/h bounds then pick
 * based on prudence:
 *   prudence=0 => fast end (max speed)
 *   prudence=1 => slow end (min speed)
 */
function pickSpeedFromRangeKmh(minKmh, maxKmh, prudence) {
  // minKmh is slower, maxKmh is faster
  return maxKmh - prudence * (maxKmh - minKmh);
}

function speedForSlopeKmh(pctSlope, vFlatKmh, profile, prudence) {
  // pctSlope: + uphill, - downhill
  if (pctSlope >= -1 && pctSlope <= 1) return vFlatKmh;

  // Uphill
  if (pctSlope > 1 && pctSlope <= 12) {
    return vFlatKmh / (1 + 0.04 * pctSlope);
  }

  if (pctSlope > 12 && pctSlope <= 15) {
    if (profile === "trained") return pickSpeedFromRangeKmh(5.45, 6.0, prudence);
    return pickSpeedFromRangeKmh(4.62, 5.45, prudence);
  }

  if (pctSlope > 15 && pctSlope <= 20) {
    if (profile === "trained") return pickSpeedFromRangeKmh(4.80, 5.45, prudence);
    return pickSpeedFromRangeKmh(4.0, 4.62, prudence);
  }

  if (pctSlope > 20) {
    if (profile === "trained") return pickSpeedFromRangeKmh(4.0, 4.62, prudence);
    return pickSpeedFromRangeKmh(3.33, 4.0, prudence);
  }

  // Downhill
  const absP = Math.abs(pctSlope);

  if (pctSlope < -1 && pctSlope >= -3) {
    return vFlatKmh / (1 - 0.02 * absP);
  }

  if (pctSlope < -3 && pctSlope >= -4) {
    return vFlatKmh / ((1 - 0.02 * absP) * 1.05);
  }

  if (pctSlope < -4 && pctSlope >= -6) {
    return vFlatKmh / ((1 - 0.02 * absP) * 1.10);
  }

  if (pctSlope < -6 && pctSlope >= -8) {
    return pickSpeedFromRangeKmh(5.45, 6.67, prudence);
  }

  if (pctSlope < -8 && pctSlope >= -12) {
    return pickSpeedFromRangeKmh(4.62, 6.0, prudence);
  }

  // pctSlope < -12
  return pickSpeedFromRangeKmh(4.0, 5.45, prudence);
}

// ------------------------ Time / pace helpers ------------------------
function parseTimeToSeconds(s) {
  const parts = s.split(":").map(x => x.trim());
  if (parts.length < 2 || parts.length > 3) throw new Error("Time must be HH:MM or HH:MM:SS");
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = parts.length === 3 ? Number(parts[2]) : 0;
  if (![hh, mm, ss].every(Number.isFinite) || hh < 0 || mm < 0 || ss < 0) {
    throw new Error("Invalid time format");
  }
  return Math.round(hh * 3600 + mm * 60 + ss);
}
function formatHMS(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}
function formatPaceMinKm(vKmh) {
  if (!Number.isFinite(vKmh) || vKmh <= 0) return null;
  const paceMin = 60 / vKmh; // min/km
  const m = Math.floor(paceMin);
  let sec = Math.round((paceMin - m) * 60);
  let mm = m;
  if (sec === 60) { sec = 0; mm += 1; }
  return `${pad2(mm)}:${pad2(sec)}`;
}
function pad2(n) { return String(n).padStart(2, "0"); }

// ------------------------ Checkpoints parsing ------------------------
function parseCheckpoint(s) {
  const parts = String(s).split(",").map(x => x.trim());
  if (parts.length !== 2) throw new Error(`Invalid --cp "${s}" (expected "<km>,<stopMin>")`);
  const km = Number(parts[0]);
  const stopMin = Number(parts[1]);
  if (!Number.isFinite(km) || km <= 0) throw new Error(`Invalid checkpoint km in "${s}"`);
  if (!Number.isFinite(stopMin) || stopMin < 0) throw new Error(`Invalid checkpoint stopMin in "${s}"`);
  return { km, stopSec: Math.round(stopMin * 60) };
}

// collect repeatable args
function getAllArgs(flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) throw new Error(`${flag} requires a value`);
      out.push(val);
      i++;
    }
  }
  return out;
}
function getArg(flag, def) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return def;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return def;
  return val;
}

function round(x, n) {
  const p = Math.pow(10, n);
  return Math.round(x * p) / p;
}

// ------------------------ Main ------------------------
const xml = fs.readFileSync(gpxPath, "utf8");
const rawPts = parseGpxPoints(xml);

// elevation smoothing
const eleRaw = rawPts.map(p => (p.ele === null ? NaN : p.ele));
const eleFilled = fillMissing(eleRaw);
const eleSmoothed = movingAverage(eleFilled, smoothWindow);
const pts = rawPts.map((p, i) => ({ ...p, ele: eleSmoothed[i] }));

// cumulative distance
const cum = [0];
for (let i = 1; i < pts.length; i++) {
  cum[i] = cum[i - 1] + haversineM(pts[i - 1], pts[i]);
}
const totalDistanceM = cum[cum.length - 1];
const totalDistanceKm = totalDistanceM / 1000;

// total D+ D- (smoothed)
let dPlusM = 0;
let dMinusM = 0;
for (let i = 1; i < pts.length; i++) {
  const de = pts[i].ele - pts[i - 1].ele;
  if (de > 0) dPlusM += de;
  else dMinusM += -de;
}

// sanity: checkpoints within course
const validCheckpoints = checkpoints
  .filter(c => c.km > 0 && c.km < totalDistanceKm)
  .sort((a, b) => a.km - b.km);

// resample
const samples = resampleByDistance(pts, cum, stepM);

// segments 250m (or last shorter)
const baseSegments = [];
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1];
  const b = samples[i];
  const dist = b.distanceM - a.distanceM;
  const deltaElev = b.ele - a.ele;
  const slopePct = dist > 0 ? (deltaElev / dist) * 100 : 0;
  baseSegments.push({
    index: i - 1,
    fromM: a.distanceM,
    toM: b.distanceM,
    lengthM: dist,
    deltaElevM: deltaElev,
    slopePct
  });
}

// target moving time
const movingTargetSec = targetTotalSec - totalStopSec;
if (movingTargetSec <= 0) {
  throw new Error("Target moving time <= 0 (stops exceed target total time). Reduce stops or increase target.");
}

// time function for a given Vflat
function movingTimeForVflatSec(vFlatKmh) {
  let t = 0;
  for (const seg of baseSegments) {
    const distKm = seg.lengthM / 1000;
    const v = speedForSlopeKmh(seg.slopePct, vFlatKmh, profile, prudence);
    if (!Number.isFinite(v) || v <= 0) return Infinity;
    t += (distKm / v) * 3600;
  }
  return t;
}

// binary search to find Vflat
let lo = vminBound;
let hi = vmaxBound;

// check feasibility
const tLo = movingTimeForVflatSec(lo);
const tHi = movingTimeForVflatSec(hi);
if (tHi > movingTargetSec) {
  throw new Error(
    `Objective seems too fast: even at Vflat=${hi} km/h, moving time=${formatHMS(tHi)} > target moving=${formatHMS(movingTargetSec)}`
  );
}
if (tLo < movingTargetSec) {
  // This means even very slow flat speed is still faster than target moving time (rare but possible).
  // We'll still solve, but it will push to the low bound.
  // Keep going; result will be near lo.
}

for (let i = 0; i < iters; i++) {
  const mid = (lo + hi) / 2;
  const tMid = movingTimeForVflatSec(mid);
  if (tMid > movingTargetSec) {
    // too slow overall -> increase Vflat
    lo = mid;
  } else {
    hi = mid;
  }
}

const vFlatKmh = (lo + hi) / 2;
const flatPace = formatPaceMinKm(vFlatKmh);

// build detailed segments with speed/pace/time + D+/D- per segment
const segments = baseSegments.map(seg => {
  const v = speedForSlopeKmh(seg.slopePct, vFlatKmh, profile, prudence);
  const pace = formatPaceMinKm(v);
  const distKm = seg.lengthM / 1000;
  const timeSec = (distKm / v) * 3600;

  const dPlus = seg.deltaElevM > 0 ? seg.deltaElevM : 0;
  const dMinus = seg.deltaElevM < 0 ? -seg.deltaElevM : 0;

  return {
    index: seg.index,
    fromM: round(seg.fromM, 2),
    toM: round(seg.toM, 2),
    lengthM: round(seg.lengthM, 2),
    deltaElevM: round(seg.deltaElevM, 2),
    dPlusM: round(dPlus, 2),
    dMinusM: round(dMinus, 2),
    slopePct: round(seg.slopePct, 3),
    speedKmh: round(v, 3),
    pace: pace,
    timeSec: Math.round(timeSec),
    time: formatHMS(timeSec)
  };
});

// group per km: weighted by time (more correct than just avg of paces)
function groupPerKmDetailed(segments) {
  const bins = new Map();
  for (const seg of segments) {
    const mid = (seg.fromM + seg.toM) / 2;
    const kmIndex = Math.floor(mid / 1000) + 1; // 1-based
    if (!bins.has(kmIndex)) bins.set(kmIndex, []);
    bins.get(kmIndex).push(seg);
  }

  const out = [];
  for (const [km, segs] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    const lenM = segs.reduce((s, x) => s + x.lengthM, 0);
    const timeSec = segs.reduce((s, x) => s + x.timeSec, 0);
    const dPlus = segs.reduce((s, x) => s + x.dPlusM, 0);
    const dMinus = segs.reduce((s, x) => s + x.dMinusM, 0);

    const distKm = lenM / 1000;
    const avgSpeed = distKm > 0 ? (distKm / (timeSec / 3600)) : 0;
    out.push({
      km,
      segmentsCount: segs.length,
      lengthM: round(lenM, 2),
      timeSec: Math.round(timeSec),
      time: formatHMS(timeSec),
      avgSpeedKmh: round(avgSpeed, 3),
      avgPace: formatPaceMinKm(avgSpeed),
      dPlusM: round(dPlus, 1),
      dMinusM: round(dMinus, 1),
      slopePctList: segs.map(s => s.slopePct),
    });
  }
  return out;
}

const perKm = groupPerKmDetailed(segments);

// Steps (stages) based on checkpoints
function buildSteps(segments, totalDistanceKm, checkpoints) {
  // stage boundaries in meters
  const boundariesKm = [0, ...checkpoints.map(c => c.km), totalDistanceKm].sort((a, b) => a - b);
  const unique = [];
  for (const k of boundariesKm) {
    if (unique.length === 0 || Math.abs(unique[unique.length - 1] - k) > 1e-9) unique.push(k);
  }

  // map checkpoint stop sec to boundary end (km)
  const stopByKm = new Map();
  for (const cp of checkpoints) {
    stopByKm.set(cp.km, (stopByKm.get(cp.km) || 0) + cp.stopSec);
  }

  const steps = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const fromKm = unique[i];
    const toKm = unique[i + 1];
    const fromM = fromKm * 1000;
    const toM = toKm * 1000;

    // include segments whose midpoint is inside [fromM, toM)
    const segs = segments.filter(s => {
      const mid = (s.fromM + s.toM) / 2;
      return mid >= fromM && mid < toM;
    });

    const lenM = segs.reduce((s, x) => s + x.lengthM, 0);
    const movingSec = segs.reduce((s, x) => s + x.timeSec, 0);
    const dPlus = segs.reduce((s, x) => s + x.dPlusM, 0);
    const dMinus = segs.reduce((s, x) => s + x.dMinusM, 0);

    const stepStopSec = stopByKm.get(toKm) || 0; // stop at end checkpoint, if any
    const totalSec = movingSec + stepStopSec;

    const distKm = lenM / 1000;
    const avgSpeed = distKm > 0 ? (distKm / (movingSec / 3600)) : 0;

    steps.push({
      index: i + 1,
      fromKm: round(fromKm, 3),
      toKm: round(toKm, 3),
      distanceKm: round(distKm, 3),
      dPlusM: round(dPlus, 1),
      dMinusM: round(dMinus, 1),
      movingSec: Math.round(movingSec),
      moving: formatHMS(movingSec),
      stopsSec: stepStopSec,
      stops: formatHMS(stepStopSec),
      totalSec: Math.round(totalSec),
      total: formatHMS(totalSec),
      avgSpeedKmh: round(avgSpeed, 3),
      avgPace: formatPaceMinKm(avgSpeed),
    });
  }

  return steps;
}

const steps = buildSteps(segments, totalDistanceKm, validCheckpoints);

// sanity totals
const computedMovingSec = segments.reduce((s, x) => s + x.timeSec, 0);
const computedTotalSec = computedMovingSec + totalStopSec;

// output payload
const result = {
  input: {
    file: path.basename(gpxPath),
    target: targetStr,
    targetTotalSec,
    profile,
    prudence,
    stepM,
    smoothWindow,
    checkpoints: validCheckpoints.map(c => ({ km: c.km, stopSec: c.stopSec, stop: formatHMS(c.stopSec) })),
    sleep: sleepArg ? { count: sleepCount, minutesEach: sleepMinEach, stopSec: sleepStopSec, stop: formatHMS(sleepStopSec) } : null,
    bounds: { vmin: vminBound, vmax: vmaxBound, iters }
  },
  totals: {
    totalDistanceM: round(totalDistanceM, 2),
    totalDistanceKm: round(totalDistanceKm, 3),
    dPlusM: round(dPlusM, 1),
    dMinusM: round(dMinusM, 1),

    targetTotal: formatHMS(targetTotalSec),
    targetTotalSec,

    stopTime: formatHMS(totalStopSec),
    stopTimeSec: totalStopSec,

    movingTarget: formatHMS(movingTargetSec),
    movingTargetSec,

    computedMoving: formatHMS(computedMovingSec),
    computedMovingSec: Math.round(computedMovingSec),

    computedTotal: formatHMS(computedTotalSec),
    computedTotalSec: Math.round(computedTotalSec),
  },
  calibration: {
    vFlatKmh: round(vFlatKmh, 4),
    flatPace,
  },
  steps,
  perKm,
  per250m: segments,
  samples: samples.map(s => ({
    index: s.index,
    distanceM: round(s.distanceM, 2),
    eleM: round(s.ele, 2)
  }))
};

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
