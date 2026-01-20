/**
 * Calculateur d'allure pour course à pied - Version navigateur
 * Adapté de script.js pour fonctionner dans le navigateur
 */

// ==================== FONCTIONS UTILITAIRES ====================

/**
 * Convertit un temps en format "HH:MM:SS" ou "HH:MM" en secondes
 */
function parseTimeToSeconds(timeStr) {
  const parts = timeStr.split(":").map(x => parseInt(x.trim(), 10));
  if (parts.length === 2) {
    return parts[0] * 3600 + parts[1] * 60;
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  throw new Error(`Format de temps invalide: ${timeStr}`);
}

/**
 * Convertit des secondes en format "HH:MM:SS"
 */
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Convertit une vitesse (km/h) en allure (min/km)
 * Format: "MM:SS/km"
 */
function speedToPace(kmh) {
  if (!isFinite(kmh) || kmh <= 0) return "N/A";
  
  const paceMin = 60 / kmh; // minutes par km
  return formatPaceFromMinutes(paceMin);
}

/**
 * Formate une allure à partir de minutes par km
 * Format: "MM:SS/km"
 */
function formatPaceFromMinutes(minPerKm) {
  if (!isFinite(minPerKm) || minPerKm <= 0) return "N/A";
  
  const minutes = Math.floor(minPerKm);
  const decimal = minPerKm - minutes;
  let seconds = Math.round(decimal * 60);
  
  // Gestion du cas où seconds = 60
  if (seconds === 60) {
    seconds = 0;
    return `${String(minutes + 1).padStart(2, '0')}:00`;
  }
  
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Retourne la classe CSS pour le pourcentage de pente selon les intervalles du script
 */
function getSlopeClass(slopePct) {
  if (!isFinite(slopePct)) return 'slope-plat';
  
  // Plat ou D+ jusqu'à 1% / D- jusqu'à -1%
  if (slopePct >= -1 && slopePct <= 1) {
    return 'slope-plat';
  }
  
  // MONTÉE
  // D+ entre 1% et 12%
  if (slopePct > 1 && slopePct <= 12) {
    return 'slope-montee-legere';
  }
  
  // D+ > 12% jusqu'à 15%
  if (slopePct > 12 && slopePct <= 15) {
    return 'slope-montee-moderee';
  }
  
  // D+ > 15% jusqu'à 20%
  if (slopePct > 15 && slopePct <= 20) {
    return 'slope-montee-forte';
  }
  
  // D+ > 20%
  if (slopePct > 20) {
    return 'slope-montee-tres-forte';
  }
  
  // DESCENTE
  // D- entre -1% et -3%
  if (slopePct < -1 && slopePct >= -3) {
    return 'slope-descente-legere';
  }
  
  // D- entre -3% et -4%
  if (slopePct < -3 && slopePct >= -4) {
    return 'slope-descente-moderee';
  }
  
  // D- entre -4% et -6%
  if (slopePct < -4 && slopePct >= -6) {
    return 'slope-descente-forte';
  }
  
  // D- > -6% jusqu'à -8%
  if (slopePct < -6 && slopePct >= -8) {
    return 'slope-descente-tres-forte';
  }
  
  // D- > -8% jusqu'à -12%
  if (slopePct < -8 && slopePct >= -12) {
    return 'slope-descente-extreme';
  }
  
  // D- > -12%
  if (slopePct < -12) {
    return 'slope-descente-maximale';
  }
  
  return 'slope-plat';
}

/**
 * Clamp une valeur entre 0 et 1
 */
function clamp01(x) {
  if (!isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

/**
 * Sélectionne une vitesse dans un intervalle selon le facteur de prudence
 */
function pickSpeedFromRange(minKmh, maxKmh, prudence) {
  return maxKmh - prudence * (maxKmh - minKmh);
}

// ==================== CALCUL DE VITESSE SELON DÉNIVELÉ ====================

function calculateSpeedForSlope(slopePct, vFlatKmh, profile, prudence) {
  if (slopePct >= -1 && slopePct <= 1) {
    return vFlatKmh;
  }

  // MONTÉE
  if (slopePct > 1 && slopePct <= 12) {
    return vFlatKmh / (1 + 0.04 * slopePct);
  }

  if (slopePct > 12 && slopePct <= 15) {
    if (profile === "trained") {
      return pickSpeedFromRange(5.45, 6.0, prudence);
    } else {
      return pickSpeedFromRange(4.62, 5.45, prudence);
    }
  }

  if (slopePct > 15 && slopePct <= 20) {
    if (profile === "trained") {
      return pickSpeedFromRange(4.80, 5.45, prudence);
    } else {
      return pickSpeedFromRange(4.0, 4.62, prudence);
    }
  }

  if (slopePct > 20) {
    if (profile === "trained") {
      return pickSpeedFromRange(4.0, 4.62, prudence);
    } else {
      return pickSpeedFromRange(3.33, 4.0, prudence);
    }
  }

  // DESCENTE
  const absSlope = Math.abs(slopePct);

  if (slopePct < -1 && slopePct >= -3) {
    return vFlatKmh / (1 - 0.02 * absSlope);
  }

  if (slopePct < -3 && slopePct >= -4) {
    return vFlatKmh / ((1 - 0.02 * absSlope) * 1.05);
  }

  if (slopePct < -4 && slopePct >= -6) {
    return vFlatKmh / ((1 - 0.02 * absSlope) * 1.10);
  }

  if (slopePct < -6 && slopePct >= -8) {
    return pickSpeedFromRange(5.45, 6.67, prudence);
  }

  if (slopePct < -8 && slopePct >= -12) {
    return pickSpeedFromRange(4.62, 6.0, prudence);
  }

  if (slopePct < -12) {
    return pickSpeedFromRange(4.0, 5.45, prudence);
  }

  return vFlatKmh;
}

// ==================== PARSING GPX ====================

function parseGpxFile(xmlContent) {
  const points = [];
  const trkptRegex = /<trkpt\b[^>]*?lat="([^"]+)"[^>]*?lon="([^"]+)"[^>]*?>([\s\S]*?)<\/trkpt>/g;
  let match;
  
  while ((match = trkptRegex.exec(xmlContent)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3];
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
    const eleValue = isFinite(ele) ? ele : 0;
    
    if (isFinite(lat) && isFinite(lon)) {
      points.push({ lat, lon, ele: eleValue });
    }
  }
  
  if (points.length < 2) {
    throw new Error("Pas assez de points trouvés dans le GPX");
  }
  
  return points;
}

function haversineDistance(a, b) {
  const R = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  
  return R * c;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function smoothElevation(elevations, windowSize) {
  if (windowSize === 1) return elevations.slice();
  
  const half = Math.floor(windowSize / 2);
  const smoothed = new Array(elevations.length).fill(null);
  
  for (let i = 0; i < elevations.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < elevations.length && elevations[j] !== null && isFinite(elevations[j])) {
        sum += elevations[j];
        count++;
      }
    }
    smoothed[i] = count > 0 ? sum / count : null;
  }
  
  return smoothed;
}

function fillMissingElevation(elevations) {
  const filled = elevations.slice();
  let last = null;
  
  for (let i = 0; i < filled.length; i++) {
    if (isFinite(filled[i])) last = filled[i];
    else if (last !== null) filled[i] = last;
  }
  
  let next = null;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (isFinite(filled[i])) next = filled[i];
    else if (next !== null) filled[i] = next;
  }
  
  return filled.map(v => (isFinite(v) ? v : 0));
}

function resamplePoints(points, cumulativeDistances, stepM) {
  const total = cumulativeDistances[cumulativeDistances.length - 1];
  const targets = [];
  for (let d = 0; d < total; d += stepM) {
    targets.push(d);
  }
  targets.push(total);
  
  const resampled = [];
  let j = 1;
  
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    while (j < cumulativeDistances.length && cumulativeDistances[j] < target) {
      j++;
    }
    if (j >= cumulativeDistances.length) j = cumulativeDistances.length - 1;
    
    const d0 = cumulativeDistances[j - 1];
    const d1 = cumulativeDistances[j];
    const t = d1 === d0 ? 0 : (target - d0) / (d1 - d0);
    
    const p0 = points[j - 1];
    const p1 = points[j];
    
    const lat = p0.lat + (p1.lat - p0.lat) * t;
    const lon = p0.lon + (p1.lon - p0.lon) * t;
    const ele = p0.ele + (p1.ele - p0.ele) * t;
    
    resampled.push({ 
      index: i, 
      distanceM: target, 
      lat, 
      lon, 
      ele 
    });
  }
  
  return resampled;
}

// ==================== CALCUL PRINCIPAL ====================

function calculateMovingTimeForVflat(segments, vFlatKmh, profile, prudence) {
  let totalTime = 0;
  
  for (const seg of segments) {
    const distKm = seg.lengthM / 1000;
    const speed = calculateSpeedForSlope(seg.slopePct, vFlatKmh, profile, prudence);
    
    if (!isFinite(speed) || speed <= 0) {
      return Infinity;
    }
    
    totalTime += (distKm / speed) * 3600;
  }
  
  return totalTime;
}

function findVflatForTargetTime(segments, targetMovingTimeSec, profile, prudence, vMin = 3, vMax = 25, iterations = 40) {
  let lo = vMin;
  let hi = vMax;
  
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const timeMid = calculateMovingTimeForVflat(segments, mid, profile, prudence);
    
    if (timeMid > targetMovingTimeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  
  return (lo + hi) / 2;
}

function calculatePacing(xmlContent, targetTime, profile, prudence, checkpoints, restPeriods, segmentLengthM = 250, smoothingWindow = 9) {
  // 1. Parsing des points GPX
  const rawPoints = parseGpxFile(xmlContent);
  
  // 2. Calcul du D+ et D- total sur les points BRUTS
  let dPlusTotal = 0;
  let dMinusTotal = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    const de = rawPoints[i].ele - rawPoints[i - 1].ele;
    if (de > 0) dPlusTotal += de;
    else if (de < 0) dMinusTotal += -de;
  }
  
  // 3. Préparation de l'élévation pour le lissage
  const eleRaw = rawPoints.map(p => p.ele);
  const eleFilled = fillMissingElevation(eleRaw);
  
  // 4. Lissage de l'élévation
  const eleSmoothed = smoothElevation(eleFilled, smoothingWindow);
  const points = rawPoints.map((p, i) => ({ ...p, ele: eleSmoothed[i] }));
  
  // 5. Calcul des distances cumulatives
  const cumulativeDistances = [0];
  for (let i = 1; i < points.length; i++) {
    const dist = haversineDistance(points[i - 1], points[i]);
    cumulativeDistances.push(cumulativeDistances[i - 1] + dist);
  }
  
  const totalDistanceM = cumulativeDistances[cumulativeDistances.length - 1];
  const totalDistanceKm = totalDistanceM / 1000;
  
  // 6. Rééchantillonnage
  const resampledPoints = resamplePoints(points, cumulativeDistances, segmentLengthM);
  
  // 7. Création des segments
  const segments = [];
  for (let i = 1; i < resampledPoints.length; i++) {
    const a = resampledPoints[i - 1];
    const b = resampledPoints[i];
    const distM = b.distanceM - a.distanceM;
    const deltaElev = b.ele - a.ele;
    const slopePct = distM > 0 ? (deltaElev / distM) * 100 : 0;
    
    segments.push({
      index: i - 1,
      fromM: a.distanceM,
      toM: b.distanceM,
      lengthM: distM,
      deltaElevM: deltaElev,
      slopePct: slopePct
    });
  }
  
  // 8. Calcul du temps d'arrêt total
  const checkpointStopSec = checkpoints.reduce((sum, cp) => sum + (cp[1] || 0) * 60, 0);
  const restStopSec = (restPeriods[0] || 0) * (restPeriods[1] || 0) * 60;
  const totalStopSec = checkpointStopSec + restStopSec;
  
  // 9. Calcul du temps de course cible
  const targetTotalSec = parseTimeToSeconds(targetTime);
  const targetMovingSec = targetTotalSec - totalStopSec;
  
  if (targetMovingSec <= 0) {
    throw new Error("Le temps d'arrêt total dépasse le temps cible.");
  }
  
  // 10. Recherche de la vitesse sur plat nécessaire
  const vFlatKmh = findVflatForTargetTime(segments, targetMovingSec, profile, prudence);
  const flatPace = speedToPace(vFlatKmh);
  
  // 11. Calcul détaillé pour chaque segment
  const detailedSegments = segments.map(seg => {
    const speed = calculateSpeedForSlope(seg.slopePct, vFlatKmh, profile, prudence);
    const pace = speedToPace(speed);
    const distKm = seg.lengthM / 1000;
    const timeSec = (distKm / speed) * 3600;
    
    return {
      ...seg,
      speedKmh: speed,
      pace: pace,
      timeSec: Math.round(timeSec)
    };
  });
  
  // 12. Regroupement par kilomètre
  const perKm = {};
  for (const seg of detailedSegments) {
    const kmIndex = Math.floor((seg.fromM + seg.toM) / 2 / 1000);
    if (!perKm[kmIndex]) {
      perKm[kmIndex] = {
        km: kmIndex + 1,
        segments: [],
        totalLengthM: 0,
        totalTimeSec: 0,
        dPlusM: 0,
        dMinusM: 0
      };
    }
    
    perKm[kmIndex].segments.push(seg);
    perKm[kmIndex].totalLengthM += seg.lengthM;
    perKm[kmIndex].totalTimeSec += seg.timeSec;
    if (seg.deltaElevM > 0) {
      perKm[kmIndex].dPlusM += seg.deltaElevM;
    } else {
      perKm[kmIndex].dMinusM += -seg.deltaElevM;
    }
  }
  
  const perKmArray = Object.values(perKm).map(km => {
    const distKm = km.totalLengthM / 1000;
    const avgSpeed = distKm > 0 ? (distKm / (km.totalTimeSec / 3600)) : 0;
    // Calculer le pourcentage de pente moyen pondéré par la distance
    const avgSlopePct = distKm > 0 ? km.segments.reduce((sum, seg) => {
      const segDistKm = seg.lengthM / 1000;
      return sum + (seg.slopePct * segDistKm);
    }, 0) / distKm : 0;
    return {
      km: km.km,
      distanceKm: distKm,
      timeSec: Math.round(km.totalTimeSec),
      time: formatTime(km.totalTimeSec),
      avgSpeedKmh: avgSpeed,
      avgPace: speedToPace(avgSpeed),
      avgSlopePct: avgSlopePct,
      dPlusM: Math.round(km.dPlusM),
      dMinusM: Math.round(km.dMinusM)
    };
  });
  
  // 13. Calcul des distances cumulatives pour les points bruts
  const cumulativeDistancesRaw = [0];
  for (let i = 1; i < rawPoints.length; i++) {
    const dist = haversineDistance(rawPoints[i - 1], rawPoints[i]);
    cumulativeDistancesRaw.push(cumulativeDistancesRaw[i - 1] + dist);
  }
  
  // 14. Création des étapes
  const boundariesKm = [0, ...checkpoints.map(cp => cp[0]), totalDistanceKm].sort((a, b) => a - b);
  const uniqueBoundaries = [];
  for (const b of boundariesKm) {
    if (uniqueBoundaries.length === 0 || Math.abs(uniqueBoundaries[uniqueBoundaries.length - 1] - b) > 0.001) {
      uniqueBoundaries.push(b);
    }
  }
  
  const steps = [];
  for (let i = 0; i < uniqueBoundaries.length - 1; i++) {
    const fromKm = uniqueBoundaries[i];
    const toKm = uniqueBoundaries[i + 1];
    const fromM = fromKm * 1000;
    const toM = toKm * 1000;
    
    // Trouver les points bruts dans cette étape
    const stepPointIndices = [];
    for (let j = 0; j < rawPoints.length; j++) {
      const cumDistKm = cumulativeDistancesRaw[j] / 1000;
      if (cumDistKm >= fromKm && cumDistKm <= toKm) {
        stepPointIndices.push(j);
      }
    }
    
    // Calculer le D+ et D- sur les points bruts
    let stepDPlus = 0;
    let stepDMinus = 0;
    if (stepPointIndices.length >= 2) {
      for (let j = 1; j < stepPointIndices.length; j++) {
        const prevIdx = stepPointIndices[j - 1];
        const currIdx = stepPointIndices[j];
        const de = rawPoints[currIdx].ele - rawPoints[prevIdx].ele;
        if (de > 0) stepDPlus += de;
        else if (de < 0) stepDMinus += -de;
      }
    }
    
    // Trouver les segments rééchantillonnés
    const stepSegments = detailedSegments.filter(s => {
      const mid = (s.fromM + s.toM) / 2;
      return mid >= fromM && mid < toM;
    });
    
    const stepLengthM = stepSegments.reduce((sum, s) => sum + s.lengthM, 0);
    const stepMovingSec = stepSegments.reduce((sum, s) => sum + s.timeSec, 0);
    
    const checkpoint = checkpoints.find(cp => Math.abs(cp[0] - toKm) < 0.1);
    const stopSec = checkpoint ? (checkpoint[1] || 0) * 60 : 0;
    
    const stepDistKm = stepLengthM / 1000;
    const stepAvgSpeed = stepDistKm > 0 ? (stepDistKm / (stepMovingSec / 3600)) : 0;
    
    steps.push({
      index: i + 1,
      fromKm: fromKm,
      toKm: toKm,
      distanceKm: stepDistKm,
      dPlusM: Math.round(stepDPlus),
      dMinusM: Math.round(stepDMinus),
      movingSec: Math.round(stepMovingSec),
      moving: formatTime(stepMovingSec),
      stopSec: stopSec,
      stop: formatTime(stopSec),
      totalSec: Math.round(stepMovingSec + stopSec),
      total: formatTime(stepMovingSec + stopSec),
      avgSpeedKmh: stepAvgSpeed,
      avgPace: speedToPace(stepAvgSpeed)
    });
  }
  
  // 15. Résultats finaux
  const computedMovingSec = detailedSegments.reduce((sum, s) => sum + s.timeSec, 0);
  const computedTotalSec = computedMovingSec + totalStopSec;
  
  const dPlusTotalFromSteps = steps.reduce((sum, s) => sum + s.dPlusM, 0);
  const dMinusTotalFromSteps = steps.reduce((sum, s) => sum + s.dMinusM, 0);
  
  // 16. Calcul de l'allure moyenne (basée sur le temps total et la distance)
  // Allure moyenne = temps total / distance totale
  const avgPaceMinPerKm = totalDistanceKm > 0 ? (targetTotalSec / 60) / totalDistanceKm : 0;
  const avgPace = formatPaceFromMinutes(avgPaceMinPerKm);
  
  // 17. Calcul de l'allure moyenne d'effort (prend en compte le dénivelé)
  // Formule : distance d'effort = distance + (D+ / 100) en km
  // 100m de D+ = 1km d'effort supplémentaire
  const effortDistanceKm = totalDistanceKm + (dPlusTotalFromSteps / 100);
  const avgEffortPaceMinPerKm = effortDistanceKm > 0 ? (targetTotalSec / 60) / effortDistanceKm : 0;
  const avgEffortPace = formatPaceFromMinutes(avgEffortPaceMinPerKm);
  
  return {
    input: {
      targetTime: targetTime,
      targetTotalSec: targetTotalSec,
      profile: profile,
      prudence: prudence,
      checkpoints: checkpoints.map(cp => ({ km: cp[0], stopMinutes: cp[1] })),
      restPeriods: { count: restPeriods[0], minutesEach: restPeriods[1] }
    },
    totals: {
      totalDistanceKm: totalDistanceKm,
      dPlusM: Math.round(dPlusTotalFromSteps),
      dMinusM: Math.round(dMinusTotalFromSteps),
      dPlusMAllPoints: Math.round(dPlusTotal),
      dMinusMAllPoints: Math.round(dMinusTotal),
      targetTotal: formatTime(targetTotalSec),
      stopTime: formatTime(totalStopSec),
      movingTarget: formatTime(targetMovingSec),
      computedMoving: formatTime(computedMovingSec),
      computedTotal: formatTime(computedTotalSec),
      avgPace: avgPace,
      avgEffortPace: avgEffortPace,
      effortDistanceKm: effortDistanceKm
    },
    calibration: {
      vFlatKmh: vFlatKmh,
      flatPace: flatPace
    },
    steps: steps,
    perKm: perKmArray,
    per250m: detailedSegments.map(seg => ({
      fromM: seg.fromM,
      toM: seg.toM,
      fromKm: seg.fromM / 1000,
      toKm: seg.toM / 1000,
      lengthM: seg.lengthM,
      lengthKm: seg.lengthM / 1000,
      deltaElevM: seg.deltaElevM,
      slopePct: seg.slopePct,
      speedKmh: seg.speedKmh,
      pace: seg.pace,
      timeSec: seg.timeSec,
      time: formatTime(seg.timeSec)
    }))
  };
}

// ==================== GESTION DES CONFIGURATIONS SAUVEGARDÉES ====================

const STORAGE_KEY = 'runningCalculatorConfigs';

function saveConfiguration(name, config) {
  if (!name || name.trim() === '') {
    throw new Error('Veuillez entrer un nom pour la configuration');
  }
  
  const configs = getSavedConfigurations();
  const configData = {
    id: Date.now().toString(),
    name: name.trim(),
    date: new Date().toISOString(),
    config: config
  };
  
  configs.push(configData);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  return configData;
}

function getSavedConfigurations() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function deleteConfiguration(id) {
  const configs = getSavedConfigurations();
  const filtered = configs.filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

function loadConfiguration(id) {
  const configs = getSavedConfigurations();
  const config = configs.find(c => c.id === id);
  return config ? config.config : null;
}

function getCurrentFormData() {
  const checkpoints = [];
  const checkpointItems = document.querySelectorAll('.checkpoint-item');
  checkpointItems.forEach(item => {
    const km = parseFloat(item.querySelector('.checkpoint-km').value);
    const stop = parseFloat(item.querySelector('.checkpoint-stop').value);
    if (!isNaN(km) && km > 0) {
      checkpoints.push([km, stop || 0]);
    }
  });
  
  return {
    targetTime: document.getElementById('targetTime').value,
    profile: document.getElementById('profile').value,
    prudence: parseFloat(document.getElementById('prudence').value),
    checkpoints: checkpoints,
    restCount: parseInt(document.getElementById('restCount').value) || 0,
    restMinutes: parseInt(document.getElementById('restMinutes').value) || 0
  };
}

function loadFormData(config) {
  document.getElementById('targetTime').value = config.targetTime || '18:00:00';
  document.getElementById('profile').value = config.profile || 'trained';
  document.getElementById('prudence').value = config.prudence || 0.5;
  document.getElementById('restCount').value = config.restCount || 0;
  document.getElementById('restMinutes').value = config.restMinutes || 0;
  
  // Charger les checkpoints
  const container = document.getElementById('checkpointsContainer');
  container.innerHTML = '';
  
  if (config.checkpoints && config.checkpoints.length > 0) {
    config.checkpoints.forEach(cp => {
      addCheckpointItem(container, cp[0], cp[1]);
    });
  } else {
    addCheckpointItem(container);
  }
}

function addCheckpointItem(container, km = '', stop = '') {
  const checkpointItem = document.createElement('div');
  checkpointItem.className = 'checkpoint-item';
  checkpointItem.innerHTML = `
    <input type="number" class="checkpoint-km" placeholder="Kilomètre" step="0.1" min="0" value="${km}">
    <input type="number" class="checkpoint-stop" placeholder="Arrêt (minutes)" step="1" min="0" value="${stop}">
    <button type="button" class="btn btn-secondary remove-checkpoint">Supprimer</button>
  `;
  container.appendChild(checkpointItem);
  
  checkpointItem.querySelector('.remove-checkpoint').addEventListener('click', () => {
    checkpointItem.remove();
  });
}

function renderSavedConfigurations() {
  const configsList = document.getElementById('configsList');
  const configs = getSavedConfigurations();
  
  if (configs.length === 0) {
    configsList.innerHTML = '<p style="color: #666; grid-column: 1 / -1;">Aucune configuration sauvegardée</p>';
    return;
  }
  
  configsList.innerHTML = configs.map(config => {
    const date = new Date(config.date);
    const dateStr = date.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const checkpointsCount = config.config.checkpoints ? config.config.checkpoints.length : 0;
    
    return `
      <div class="config-card">
        <h3>${config.name}</h3>
        <div class="config-info">
          <div>Temps: ${config.config.targetTime}</div>
          <div>Profil: ${config.config.profile === 'trained' ? 'Entraîné' : 'Standard'}</div>
          <div>Points de passage: ${checkpointsCount}</div>
          <div style="font-size: 0.85em; color: #999; margin-top: 5px;">${dateStr}</div>
        </div>
        <div class="config-actions-buttons">
          <button type="button" class="btn btn-success load-config" data-id="${config.id}">Charger</button>
          <button type="button" class="btn btn-danger delete-config" data-id="${config.id}">Supprimer</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Ajouter les event listeners
  configsList.querySelectorAll('.load-config').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const config = loadConfiguration(id);
      if (config) {
        loadFormData(config);
        // Scroll vers le formulaire
        document.getElementById('calculatorForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
  
  configsList.querySelectorAll('.delete-config').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Êtes-vous sûr de vouloir supprimer cette configuration ?')) {
        const id = btn.dataset.id;
        deleteConfiguration(id);
        renderSavedConfigurations();
      }
    });
  });
}

// ==================== INTERFACE UTILISATEUR ====================

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('calculatorForm');
  const gpxFileInput = document.getElementById('gpxFile');
  const addCheckpointBtn = document.getElementById('addCheckpoint');
  const checkpointsContainer = document.getElementById('checkpointsContainer');
  const resultsDiv = document.getElementById('results');
  const errorDiv = document.getElementById('errorMessage');
  const loadingDiv = document.getElementById('loading');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const configNameInput = document.getElementById('configName');
  
  // Charger et afficher les configurations sauvegardées
  renderSavedConfigurations();

  // Sauvegarder la configuration actuelle
  saveConfigBtn.addEventListener('click', () => {
    try {
      const name = configNameInput.value.trim();
      if (!name) {
        alert('Veuillez entrer un nom pour la configuration');
        return;
      }
      
      const formData = getCurrentFormData();
      saveConfiguration(name, formData);
      configNameInput.value = '';
      renderSavedConfigurations();
      
      // Afficher un message de succès
      const successMsg = document.createElement('div');
      successMsg.className = 'error';
      successMsg.style.background = '#d4edda';
      successMsg.style.color = '#155724';
      successMsg.style.borderColor = '#c3e6cb';
      successMsg.textContent = `Configuration "${name}" sauvegardée avec succès !`;
      successMsg.style.display = 'block';
      successMsg.style.marginTop = '10px';
      
      const configsSection = document.querySelector('.saved-configs');
      configsSection.appendChild(successMsg);
      
      setTimeout(() => {
        successMsg.remove();
      }, 3000);
      
    } catch (error) {
      alert(`Erreur lors de la sauvegarde: ${error.message}`);
    }
  });
  
  // Ajouter un point de passage
  addCheckpointBtn.addEventListener('click', () => {
    addCheckpointItem(checkpointsContainer);
  });

  // Supprimer les points de passage existants
  checkpointsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-checkpoint')) {
      const item = e.target.closest('.checkpoint-item');
      if (checkpointsContainer.querySelectorAll('.checkpoint-item').length > 1) {
        item.remove();
      } else {
        alert('Vous devez avoir au moins un point de passage (même vide)');
      }
    }
  });

  // Soumission du formulaire
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Masquer les résultats et erreurs précédents
    resultsDiv.classList.remove('show');
    errorDiv.style.display = 'none';
    loadingDiv.style.display = 'block';
    
    try {
      // Lire le fichier GPX
      const file = gpxFileInput.files[0];
      if (!file) {
        throw new Error('Veuillez sélectionner un fichier GPX');
      }
      
      const xmlContent = await readFileAsText(file);
      
      // Récupérer les paramètres
      const targetTime = document.getElementById('targetTime').value.trim();
      const profile = document.getElementById('profile').value;
      const prudence = parseFloat(document.getElementById('prudence').value);
      
      // Récupérer les checkpoints
      const checkpointItems = checkpointsContainer.querySelectorAll('.checkpoint-item');
      const checkpoints = [];
      checkpointItems.forEach(item => {
        const km = parseFloat(item.querySelector('.checkpoint-km').value);
        const stop = parseFloat(item.querySelector('.checkpoint-stop').value);
        if (!isNaN(km) && km > 0) {
          checkpoints.push([km, stop || 0]);
        }
      });
      checkpoints.sort((a, b) => a[0] - b[0]);
      
      // Récupérer les repos
      const restCount = parseInt(document.getElementById('restCount').value) || 0;
      const restMinutes = parseInt(document.getElementById('restMinutes').value) || 0;
      const restPeriods = [restCount, restMinutes];
      
      // Calculer
      const results = calculatePacing(xmlContent, targetTime, profile, prudence, checkpoints, restPeriods);
      
      // Afficher les résultats
      displayResults(results);
      loadingDiv.style.display = 'none';
      resultsDiv.classList.add('show');
      
    } catch (error) {
      loadingDiv.style.display = 'none';
      errorDiv.textContent = `Erreur: ${error.message}`;
      errorDiv.style.display = 'block';
    }
  });
});

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Erreur lors de la lecture du fichier'));
    reader.readAsText(file);
  });
}

function displayResults(results) {
  const totalsSection = document.getElementById('totalsSection');
  const stepsSection = document.getElementById('stepsSection');
  const perKmSection = document.getElementById('perKmSection');
  
  // Créer une section pour les segments de 250m si elle n'existe pas
  let per250mSection = document.getElementById('per250mSection');
  if (!per250mSection) {
    per250mSection = document.createElement('div');
    per250mSection.id = 'per250mSection';
    document.getElementById('results').querySelector('.results-content').appendChild(per250mSection);
  }
  
  // Totaux
  totalsSection.innerHTML = `
    <div class="totals">
      <h3>📊 Données principales</h3>
      <div class="totals-grid">
        <div class="total-item">
          <strong>Distance totale</strong>
          <span>${results.totals.totalDistanceKm.toFixed(2)} km</span>
        </div>
        <div class="total-item">
          <strong>D+ total</strong>
          <span>${results.totals.dPlusM || 0} m</span>
        </div>
        <div class="total-item">
          <strong>D- total</strong>
          <span>${results.totals.dMinusM || 0} m</span>
        </div>
        <div class="total-item">
          <strong>Objectif temps total</strong>
          <span>${results.totals.targetTotal}</span>
        </div>
        <div class="total-item">
          <strong>Temps d'arrêt total</strong>
          <span>${results.totals.stopTime}</span>
        </div>
        <div class="total-item">
          <strong>Temps de course cible</strong>
          <span>${results.totals.movingTarget}</span>
        </div>
        <div class="total-item">
          <strong>Temps calculé</strong>
          <span>${results.totals.computedMoving}</span>
        </div>
        <div class="total-item">
          <strong>Temps total calculé</strong>
          <span>${results.totals.computedTotal}</span>
        </div>
        <div class="total-item">
          <strong>Profil</strong>
          <span>${results.input.profile === 'trained' ? 'Entraîné' : 'Standard'}</span>
        </div>
        <div class="total-item">
          <strong>Vitesse sur plat</strong>
          <span>${results.calibration.vFlatKmh.toFixed(2)} km/h</span>
        </div>
        <div class="total-item">
          <strong>Allure sur plat</strong>
          <span>${results.calibration.flatPace}/km</span>
        </div>
        <div class="total-item">
          <strong>Allure moyenne</strong>
          <span>${results.totals.avgPace}/km</span>
        </div>
        <div class="total-item">
          <strong>Allure moyenne d'effort</strong>
          <span>${results.totals.avgEffortPace}/km</span>
        </div>
      </div>
    </div>
  `;
  
  // Étapes
  stepsSection.innerHTML = `
    <div class="steps">
      <h3 style="color: #667eea; margin-bottom: 20px; font-size: 1.3em;">🏃 Étapes de la course</h3>
      ${results.steps.map(step => `
        <div class="step">
          <div class="step-header">Étape ${step.index} : ${step.fromKm.toFixed(1)} km → ${step.toKm.toFixed(1)} km</div>
          <div class="step-grid">
            <div class="total-item">
              <strong>Distance</strong>
              <span>${step.distanceKm.toFixed(2)} km</span>
            </div>
            <div class="total-item">
              <strong>D+</strong>
              <span>${step.dPlusM || 0} m</span>
            </div>
            <div class="total-item">
              <strong>D-</strong>
              <span>${step.dMinusM || 0} m</span>
            </div>
            <div class="total-item">
              <strong>Temps de course</strong>
              <span>${step.moving}</span>
            </div>
            <div class="total-item">
              <strong>Temps d'arrêt</strong>
              <span>${step.stop}</span>
            </div>
            <div class="total-item">
              <strong>Temps total</strong>
              <span>${step.total}</span>
            </div>
            <div class="total-item">
              <strong>Vitesse moyenne</strong>
              <span>${step.avgSpeedKmh.toFixed(2)} km/h</span>
            </div>
            <div class="total-item">
              <strong>Allure moyenne</strong>
              <span>${step.avgPace}/km</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  // Par kilomètre
  perKmSection.innerHTML = `
    <div class="per-km">
      <h3>📏 Résultats par kilomètre</h3>
      <table class="km-table">
        <thead>
          <tr>
            <th>Km</th>
            <th>Distance</th>
            <th>Temps</th>
            <th>Allure</th>
            <th>Vitesse</th>
            <th>Pente</th>
            <th>D+</th>
            <th>D-</th>
          </tr>
        </thead>
        <tbody>
          ${results.perKm.map(km => `
            <tr>
              <td><strong>${km.km}</strong></td>
              <td>${km.distanceKm.toFixed(3)} km</td>
              <td>${km.time}</td>
              <td>${km.avgPace}/km</td>
              <td>${km.avgSpeedKmh.toFixed(2)} km/h</td>
              <td><span class="${getSlopeClass(km.avgSlopePct)}">${km.avgSlopePct >= 0 ? '+' : ''}${km.avgSlopePct.toFixed(2)}%</span></td>
              <td>${km.dPlusM || 0} m</td>
              <td>${km.dMinusM || 0} m</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  // Par segment de 250m
  per250mSection.innerHTML = `
    <div class="per-km">
      <h3>📐 Segments de 250m</h3>
      <table class="km-table">
        <thead>
          <tr>
            <th>De (km)</th>
            <th>À (km)</th>
            <th>Distance</th>
            <th>Temps</th>
            <th>Allure</th>
            <th>Vitesse</th>
            <th>Pente</th>
            <th>D+</th>
            <th>D-</th>
          </tr>
        </thead>
        <tbody>
          ${results.per250m.map(seg => `
            <tr>
              <td>${seg.fromKm.toFixed(3)}</td>
              <td>${seg.toKm.toFixed(3)}</td>
              <td>${seg.lengthKm.toFixed(3)} km</td>
              <td>${seg.time}</td>
              <td>${seg.pace}/km</td>
              <td>${seg.speedKmh.toFixed(2)} km/h</td>
              <td><span class="${getSlopeClass(seg.slopePct)}">${seg.slopePct >= 0 ? '+' : ''}${seg.slopePct.toFixed(2)}%</span></td>
              <td>${seg.deltaElevM > 0 ? seg.deltaElevM.toFixed(1) : '0'} m</td>
              <td>${seg.deltaElevM < 0 ? (-seg.deltaElevM).toFixed(1) : '0'} m</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

