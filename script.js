/**
 * Calculateur d'allure pour course à pied
 * Variables globales configurables en haut du fichier
 */

import { readFileSync } from 'fs';

// ==================== VARIABLES GLOBALES ====================

// Fichier GPX à analyser
const GPX_FILE_PATH = './file.gpx';

// Objectif de temps total (format: "HH:MM:SS" ou "HH:MM")
const TARGET_TIME = "18:00:00";

// Profil du coureur: "trained" ou "standard"
const RUNNER_PROFILE = "trained"; // "trained" ou "standard"

// Facteur de prudence pour les intervalles d'allure (0 = rapide, 1 = prudent)
// Utilisé pour les dénivelés avec intervalle d'allure (ex: 9:00-11:00/km)
const PRUDENCE_FACTOR = 0.5; // Entre 0 et 1

// Points de passage (ravitaillements) : [kilomètre, durée_arrêt_minutes]
const CHECKPOINTS = [
  [20, 5],   // Ravitaillement au km 20, arrêt de 5 minutes
  [41, 5],   // Ravitaillement au km 41, arrêt de 5 minutes
  [64, 10],  // Ravitaillement au km 64, arrêt de 10 minutes
  [85, 5],   // Ravitaillement au km 85, arrêt de 5 minutes
  [108, 5]   // Ravitaillement au km 108, arrêt de 5 minutes
];

// Repos (sieste) : [nombre_de_repos, durée_chaque_repos_minutes]
const REST_PERIODS = [1, 30]; // 1 repos de 30 minutes

// Paramètres de calcul
const SEGMENT_LENGTH_M = 250; // Longueur des segments en mètres (250m par défaut)
const SMOOTHING_WINDOW = 9; // Fenêtre de lissage pour l'élévation (doit être impair)

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
  const minutes = Math.floor(paceMin);
  const decimal = paceMin - minutes;
  let seconds = Math.round(decimal * 60);
  
  // Gestion du cas où seconds = 60
  if (seconds === 60) {
    seconds = 0;
    return `${String(minutes + 1).padStart(2, '0')}:00`;
  }
  
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Convertit une allure (min/km) en vitesse (km/h)
 */
function paceToSpeed(minPerKm) {
  if (!isFinite(minPerKm) || minPerKm <= 0) return 0;
  return 60 / minPerKm;
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
 * prudence = 0 → vitesse rapide (max)
 * prudence = 1 → vitesse prudente (min)
 */
function pickSpeedFromRange(minKmh, maxKmh, prudence) {
  return maxKmh - prudence * (maxKmh - minKmh);
}

// ==================== CALCUL DE VITESSE SELON DÉNIVELÉ ====================

/**
 * Calcule la vitesse (km/h) en fonction du pourcentage de dénivelé
 * @param {number} slopePct - Pourcentage de dénivelé (+ montée, - descente)
 * @param {number} vFlatKmh - Vitesse sur plat (km/h)
 * @param {string} profile - "trained" ou "standard"
 * @param {number} prudence - Facteur de prudence (0-1)
 * @returns {number} Vitesse en km/h
 */
function calculateSpeedForSlope(slopePct, vFlatKmh, profile, prudence) {
  // Plat ou D+ jusqu'à 1% / D- jusqu'à -1% = allure classique
  if (slopePct >= -1 && slopePct <= 1) {
    return vFlatKmh;
  }

  // ========== MONTÉE (D+) ==========
  
  // D+ entre 1% et 12%
  if (slopePct > 1 && slopePct <= 12) {
    return vFlatKmh / (1 + 0.04 * slopePct);
  }

  // D+ > 12% jusqu'à 15%
  if (slopePct > 12 && slopePct <= 15) {
    if (profile === "trained") {
      return pickSpeedFromRange(5.45, 6.0, prudence); // 10-11:00/km
    } else {
      return pickSpeedFromRange(4.62, 5.45, prudence); // 11-13:00/km
    }
  }

  // D+ > 15% jusqu'à 20%
  if (slopePct > 15 && slopePct <= 20) {
    if (profile === "trained") {
      return pickSpeedFromRange(4.80, 5.45, prudence); // 11-12:30/km
    } else {
      return pickSpeedFromRange(4.0, 4.62, prudence); // 13-15:00/km
    }
  }

  // D+ > 20%
  if (slopePct > 20) {
    if (profile === "trained") {
      return pickSpeedFromRange(4.0, 4.62, prudence); // 13-15:00/km
    } else {
      return pickSpeedFromRange(3.33, 4.0, prudence); // 15-18:00/km
    }
  }

  // ========== DESCENTE (D-) ==========
  const absSlope = Math.abs(slopePct);

  // D- entre -1% et -3%
  if (slopePct < -1 && slopePct >= -3) {
    return vFlatKmh / (1 - 0.02 * absSlope);
  }

  // D- entre -3% et -4%
  if (slopePct < -3 && slopePct >= -4) {
    return vFlatKmh / ((1 - 0.02 * absSlope) * 1.05);
  }

  // D- entre -4% et -6%
  if (slopePct < -4 && slopePct >= -6) {
    return vFlatKmh / ((1 - 0.02 * absSlope) * 1.10);
  }

  // D- > -6% jusqu'à -8%
  if (slopePct < -6 && slopePct >= -8) {
    return pickSpeedFromRange(5.45, 6.67, prudence); // 9:00-11:00/km
  }

  // D- > -8% jusqu'à -12%
  if (slopePct < -8 && slopePct >= -12) {
    return pickSpeedFromRange(4.62, 6.0, prudence); // 10-13:00/km
  }

  // D- > -12%
  if (slopePct < -12) {
    return pickSpeedFromRange(4.0, 5.45, prudence); // 11:00-15:00/km
  }

  return vFlatKmh; // Par défaut
}

// ==================== PARSING GPX ====================

/**
 * Parse un fichier GPX et extrait les points (lat, lon, ele)
 */
function parseGpxFile(xmlContent) {
  const points = [];
  const trkptRegex = /<trkpt\b[^>]*?lat="([^"]+)"[^>]*?lon="([^"]+)"[^>]*?>([\s\S]*?)<\/trkpt>/g;
  let match;
  
  while ((match = trkptRegex.exec(xmlContent)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3];
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
    // Utiliser 0 comme valeur par défaut (comme dans index.js avec parseFloatSafe)
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

/**
 * Calcule la distance entre deux points (formule de Haversine)
 */
function haversineDistance(a, b) {
  const R = 6371000; // Rayon de la Terre en mètres
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

/**
 * Lisse les valeurs d'élévation avec une moyenne mobile
 */
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

/**
 * Remplit les valeurs manquantes d'élévation
 */
function fillMissingElevation(elevations) {
  const filled = elevations.slice();
  let last = null;
  
  // Remplir depuis le début
  for (let i = 0; i < filled.length; i++) {
    if (isFinite(filled[i])) last = filled[i];
    else if (last !== null) filled[i] = last;
  }
  
  // Remplir depuis la fin
  let next = null;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (isFinite(filled[i])) next = filled[i];
    else if (next !== null) filled[i] = next;
  }
  
  return filled.map(v => (isFinite(v) ? v : 0));
}

/**
 * Rééchantillonne les points tous les N mètres
 */
function resamplePoints(points, cumulativeDistances, stepM) {
  const total = cumulativeDistances[cumulativeDistances.length - 1];
  const targets = [];
  for (let d = 0; d < total; d += stepM) {
    targets.push(d);
  }
  targets.push(total); // Inclure la fin
  
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

/**
 * Calcule le temps de parcours pour une vitesse sur plat donnée
 */
function calculateMovingTimeForVflat(segments, vFlatKmh, profile, prudence) {
  let totalTime = 0;
  
  for (const seg of segments) {
    const distKm = seg.lengthM / 1000;
    const speed = calculateSpeedForSlope(seg.slopePct, vFlatKmh, profile, prudence);
    
    if (!isFinite(speed) || speed <= 0) {
      return Infinity;
    }
    
    totalTime += (distKm / speed) * 3600; // Temps en secondes
  }
  
  return totalTime;
}

/**
 * Recherche binaire pour trouver la vitesse sur plat nécessaire
 */
function findVflatForTargetTime(segments, targetMovingTimeSec, profile, prudence, vMin = 3, vMax = 25, iterations = 40) {
  let lo = vMin;
  let hi = vMax;
  
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const timeMid = calculateMovingTimeForVflat(segments, mid, profile, prudence);
    
    if (timeMid > targetMovingTimeSec) {
      // Trop lent → augmenter la vitesse
      lo = mid;
    } else {
      hi = mid;
    }
  }
  
  return (lo + hi) / 2;
}

/**
 * Fonction principale de calcul
 */
function calculatePacing() {
  // 1. Lecture du fichier GPX
  const xmlContent = readFileSync(GPX_FILE_PATH, 'utf8');
  
  // 2. Parsing des points GPX (les valeurs manquantes sont remplacées par 0)
  const rawPoints = parseGpxFile(xmlContent);
  
  // 3. Calcul du D+ et D- total sur les points BRUTS (comme dans index.js)
  // Les points sont déjà parsés avec 0 pour les valeurs manquantes
  let dPlusTotal = 0;
  let dMinusTotal = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    const de = rawPoints[i].ele - rawPoints[i - 1].ele;
    if (de > 0) dPlusTotal += de;
    else if (de < 0) dMinusTotal += -de;
  }
  
  // 4. Préparation de l'élévation pour le lissage (remplissage des valeurs manquantes)
  const eleRaw = rawPoints.map(p => p.ele);
  const eleFilled = fillMissingElevation(eleRaw);
  
  // 5. Lissage de l'élévation (pour les calculs de vitesse/allure uniquement)
  const eleSmoothed = smoothElevation(eleFilled, SMOOTHING_WINDOW);
  const points = rawPoints.map((p, i) => ({ ...p, ele: eleSmoothed[i] }));
  
  // 6. Calcul des distances cumulatives
  const cumulativeDistances = [0];
  for (let i = 1; i < points.length; i++) {
    const dist = haversineDistance(points[i - 1], points[i]);
    cumulativeDistances.push(cumulativeDistances[i - 1] + dist);
  }
  
  const totalDistanceM = cumulativeDistances[cumulativeDistances.length - 1];
  const totalDistanceKm = totalDistanceM / 1000;
  
  // 7. Rééchantillonnage tous les 250m
  const resampledPoints = resamplePoints(points, cumulativeDistances, SEGMENT_LENGTH_M);
  
  // 8. Création des segments de 250m avec calcul du pourcentage de dénivelé
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
  
  // 9. Calcul du temps d'arrêt total
  const checkpointStopSec = CHECKPOINTS.reduce((sum, cp) => sum + cp[1] * 60, 0);
  const restStopSec = REST_PERIODS[0] * REST_PERIODS[1] * 60;
  const totalStopSec = checkpointStopSec + restStopSec;
  
  // 10. Calcul du temps de course cible (temps total - arrêts)
  const targetTotalSec = parseTimeToSeconds(TARGET_TIME);
  const targetMovingSec = targetTotalSec - totalStopSec;
  
  if (targetMovingSec <= 0) {
    throw new Error("Le temps d'arrêt total dépasse le temps cible. Réduisez les arrêts ou augmentez le temps cible.");
  }
  
  // 11. Recherche de la vitesse sur plat nécessaire
  const vFlatKmh = findVflatForTargetTime(segments, targetMovingSec, RUNNER_PROFILE, PRUDENCE_FACTOR);
  const flatPace = speedToPace(vFlatKmh);
  
  // 12. Calcul détaillé pour chaque segment
  const detailedSegments = segments.map(seg => {
    const speed = calculateSpeedForSlope(seg.slopePct, vFlatKmh, RUNNER_PROFILE, PRUDENCE_FACTOR);
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
  
  // 13. Regroupement par kilomètre
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
  
  // Calcul de l'allure moyenne par km
  const perKmArray = Object.values(perKm).map(km => {
    const distKm = km.totalLengthM / 1000;
    const avgSpeed = distKm > 0 ? (distKm / (km.totalTimeSec / 3600)) : 0;
    return {
      km: km.km,
      distanceKm: distKm,
      timeSec: Math.round(km.totalTimeSec),
      time: formatTime(km.totalTimeSec),
      avgSpeedKmh: avgSpeed,
      avgPace: speedToPace(avgSpeed),
      dPlusM: Math.round(km.dPlusM),
      dMinusM: Math.round(km.dMinusM)
    };
  });
  
  // 14. Calcul des distances cumulatives pour les points bruts (pour trouver les points dans chaque section)
  const cumulativeDistancesRaw = [0];
  for (let i = 1; i < rawPoints.length; i++) {
    const dist = haversineDistance(rawPoints[i - 1], rawPoints[i]);
    cumulativeDistancesRaw.push(cumulativeDistancesRaw[i - 1] + dist);
  }
  
  // 15. Création des étapes (steps) basées sur les points de passage
  const boundariesKm = [0, ...CHECKPOINTS.map(cp => cp[0]), totalDistanceKm].sort((a, b) => a - b);
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
    
    // Trouver les points bruts dans cette étape (comme dans index.js)
    const stepPointIndices = [];
    for (let j = 0; j < rawPoints.length; j++) {
      const cumDistKm = cumulativeDistancesRaw[j] / 1000;
      if (cumDistKm >= fromKm && cumDistKm <= toKm) {
        stepPointIndices.push(j);
      }
    }
    
    // Calculer le D+ et D- sur les points bruts de cette étape (comme dans index.js)
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
    
    // Trouver les segments rééchantillonnés dans cette étape (pour le temps et la distance)
    const stepSegments = detailedSegments.filter(s => {
      const mid = (s.fromM + s.toM) / 2;
      return mid >= fromM && mid < toM;
    });
    
    const stepLengthM = stepSegments.reduce((sum, s) => sum + s.lengthM, 0);
    const stepMovingSec = stepSegments.reduce((sum, s) => sum + s.timeSec, 0);
    
    // Trouver le temps d'arrêt à ce checkpoint
    const checkpoint = CHECKPOINTS.find(cp => Math.abs(cp[0] - toKm) < 0.1);
    const stopSec = checkpoint ? checkpoint[1] * 60 : 0;
    
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
  
  // 16. Résultats finaux
  const computedMovingSec = detailedSegments.reduce((sum, s) => sum + s.timeSec, 0);
  const computedTotalSec = computedMovingSec + totalStopSec;
  
  // Calcul du D+ total comme somme des D+ des étapes (comme dans index.js)
  // Cela correspond mieux à la méthode utilisée dans index.js où le D+ est calculé par section
  const dPlusTotalFromSteps = steps.reduce((sum, s) => sum + s.dPlusM, 0);
  const dMinusTotalFromSteps = steps.reduce((sum, s) => sum + s.dMinusM, 0);
  
  return {
    input: {
      gpxFile: GPX_FILE_PATH,
      targetTime: TARGET_TIME,
      targetTotalSec: targetTotalSec,
      profile: RUNNER_PROFILE,
      prudence: PRUDENCE_FACTOR,
      checkpoints: CHECKPOINTS.map(cp => ({ km: cp[0], stopMinutes: cp[1] })),
      restPeriods: { count: REST_PERIODS[0], minutesEach: REST_PERIODS[1] }
    },
    totals: {
      totalDistanceKm: totalDistanceKm,
      dPlusM: Math.round(dPlusTotalFromSteps), // Utiliser la somme des étapes pour correspondre à index.js
      dMinusM: Math.round(dMinusTotalFromSteps), // Utiliser la somme des étapes pour correspondre à index.js
      dPlusMAllPoints: Math.round(dPlusTotal), // D+ sur tous les points (pour référence)
      dMinusMAllPoints: Math.round(dMinusTotal), // D- sur tous les points (pour référence)
      targetTotal: formatTime(targetTotalSec),
      stopTime: formatTime(totalStopSec),
      movingTarget: formatTime(targetMovingSec),
      computedMoving: formatTime(computedMovingSec),
      computedTotal: formatTime(computedTotalSec)
    },
    calibration: {
      vFlatKmh: vFlatKmh,
      flatPace: flatPace
    },
    steps: steps,
    perKm: perKmArray,
    per250m: detailedSegments.map(s => ({
      fromM: s.fromM,
      toM: s.toM,
      lengthM: s.lengthM,
      slopePct: s.slopePct,
      speedKmh: s.speedKmh,
      pace: s.pace,
      timeSec: s.timeSec
    }))
  };
}

// ==================== AFFICHAGE FORMATÉ ====================

/**
 * Affiche les résultats de manière formatée dans la console
 */
function displayResults(results) {
  console.log("\n" + "=".repeat(60));
  console.log("  CALCULATEUR D'ALLURE - RÉSULTATS");
  console.log("=".repeat(60) + "\n");
  
  // Données principales
  console.log("📊 DONNÉES PRINCIPALES");
  console.log("-".repeat(60));
  console.log(`Distance totale        : ${results.totals.totalDistanceKm.toFixed(2)} km`);
  console.log(`D+ total               : ${results.totals.dPlusM} m`);
  console.log(`D- total               : ${results.totals.dMinusM} m`);
  console.log(`Objectif temps total   : ${results.totals.targetTotal}`);
  console.log(`Temps d'arrêt total    : ${results.totals.stopTime}`);
  console.log(`Temps de course cible  : ${results.totals.movingTarget}`);
  console.log(`Temps calculé          : ${results.totals.computedMoving}`);
  console.log(`Temps total calculé    : ${results.totals.computedTotal}`);
  console.log(`\nProfil                 : ${results.input.profile}`);
  console.log(`Vitesse sur plat       : ${results.calibration.vFlatKmh.toFixed(2)} km/h`);
  console.log(`Allure sur plat        : ${results.calibration.flatPace}/km`);
  console.log("\n");
  
  // Étapes (steps)
  console.log("🏃 ÉTAPES DE LA COURSE");
  console.log("=".repeat(60));
  
  results.steps.forEach((step, index) => {
    console.log(`\nÉtape ${step.index} : ${step.fromKm.toFixed(1)} km → ${step.toKm.toFixed(1)} km`);
    console.log("-".repeat(60));
    console.log(`  Distance             : ${step.distanceKm.toFixed(2)} km`);
    console.log(`  D+                   : ${step.dPlusM} m`);
    console.log(`  D-                   : ${step.dMinusM} m`);
    console.log(`  Temps de course      : ${step.moving}`);
    console.log(`  Temps d'arrêt        : ${step.stop}`);
    console.log(`  Temps total          : ${step.total}`);
    console.log(`  Vitesse moyenne      : ${step.avgSpeedKmh.toFixed(2)} km/h`);
    console.log(`  Allure moyenne       : ${step.avgPace}/km`);
  });
  
  console.log("\n" + "=".repeat(60));
  console.log("  FIN DES RÉSULTATS");
  console.log("=".repeat(60) + "\n");
}

// ==================== EXÉCUTION ====================

// Exécuter si le script est lancé directement
try {
  const results = calculatePacing();
  
  displayResults(results);
} catch (error) {
  console.error("Erreur:", error.message);
  process.exit(1);
}

// Export pour utilisation comme module
export { calculatePacing, calculateSpeedForSlope, speedToPace, parseTimeToSeconds };

