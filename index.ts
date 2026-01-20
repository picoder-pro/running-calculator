import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";

// Constants
const EARTH_RADIUS_M = 6371000;
const METERS_TO_KM = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

// Types
type RawGpxPoint = {
  lat: number;
  lon: number;
  ele: number;
  time?: Date;
};

type GpxPoint = RawGpxPoint & {
  cumDistKm: number;
};

type SectionConfig = {
  label: string;
  startKm: number;
  endKm: number;
};

type SectionStats = {
  label: string;
  startKm: number;
  endKm: number;
  distKm: number;
  dPlus: number;
  dMinus: number;
};

type SectionPacing = SectionStats & {
  effortKm: number;
  targetTimeSec: number;
  targetPaceMinPerKm: number;
};

type GpxTrkpt = {
  lat?: string | number;
  lon?: string | number;
  ele?: string | number;
  time?: string;
};

type GpxTrkseg = {
  trkpt?: GpxTrkpt | GpxTrkpt[];
};

type GpxTrk = {
  trkseg?: GpxTrkseg | GpxTrkseg[];
};

type ParsedGpx = {
  gpx?: {
    trk?: GpxTrk | GpxTrk[];
  };
};

// Utility functions
function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function parseFloatSafe(
  value: string | number | undefined,
  defaultValue: number
): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed;
}

// GPX parsing
function parseGpx(filePath: string): RawGpxPoint[] {
  let xml: string;
  try {
    xml = readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(`Impossible de lire le fichier GPX: ${filePath}`);
  }

  if (!xml.trim()) {
    throw new Error("Le fichier GPX est vide");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
  });

  let gpx: ParsedGpx;
  try {
    gpx = parser.parse(xml) as ParsedGpx;
  } catch (error) {
    throw new Error("Erreur lors du parsing XML");
  }

  const trks = ensureArray(gpx.gpx?.trk);
  if (trks.length === 0) {
    throw new Error("Aucun <trk> trouvé dans le GPX");
  }

  const firstTrk: GpxTrk = trks[0]!;
  const segs = ensureArray(firstTrk.trkseg);
  if (segs.length === 0) {
    throw new Error("Aucun <trkseg> trouvé dans le GPX");
  }

  // Merge all segments into one continuous track
  const allTrkpts: GpxTrkpt[] = [];
  for (const seg of segs) {
    const trkpts = ensureArray(seg.trkpt);
    allTrkpts.push(...trkpts);
  }

  if (allTrkpts.length === 0) {
    throw new Error("Aucun point de trace trouvé dans le GPX");
  }

  const points: RawGpxPoint[] = allTrkpts.map((pt) => {
    const lat = parseFloatSafe(pt.lat, 0);
    const lon = parseFloatSafe(pt.lon, 0);
    const ele = parseFloatSafe(pt.ele, 0);

    if (lat === 0 && lon === 0) {
      throw new Error("Point GPX invalide: coordonnées manquantes");
    }

    const point: RawGpxPoint = {
      lat,
      lon,
      ele,
    };

    if (pt.time) {
      point.time = new Date(pt.time);
    }

    return point;
  });

  return points;
}

// Distance calculation
function haversineMeters(a: RawGpxPoint, b: RawGpxPoint): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dPhi = toRadians(b.lat - a.lat);
  const dLambda = toRadians(b.lon - a.lon);

  const sinDphi = Math.sin(dPhi / 2);
  const sinDlambda = Math.sin(dLambda / 2);

  const h =
    sinDphi * sinDphi +
    Math.cos(phi1) * Math.cos(phi2) * sinDlambda * sinDlambda;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Build cumulative distance
function buildCumulativePoints(rawPoints: RawGpxPoint[]): GpxPoint[] {
  if (rawPoints.length === 0) {
    throw new Error("Aucun point GPX à traiter");
  }

  const result: GpxPoint[] = [
    {
      ...rawPoints[0]!,
      cumDistKm: 0,
    },
  ];

  for (let i = 1; i < rawPoints.length; i++) {
    const prev = rawPoints[i - 1]!;
    const curr = rawPoints[i]!;
    const distanceM = haversineMeters(prev, curr);
    const distanceKm = distanceM / METERS_TO_KM;
    const prevCumDist = result[i - 1]!.cumDistKm;
    result.push({
      ...curr,
      cumDistKm: prevCumDist + distanceKm,
    });
  }

  return result;
}

// Section configuration
function buildSectionsFromBoundaries(boundariesKm: number[]): SectionConfig[] {
  if (boundariesKm.length < 2) {
    throw new Error(
      "Au moins 2 bornes sont nécessaires pour créer des sections"
    );
  }

  // Validate boundaries are in ascending order
  for (let i = 1; i < boundariesKm.length; i++) {
    if (boundariesKm[i]! <= boundariesKm[i - 1]!) {
      throw new Error("Les bornes doivent être en ordre croissant");
    }
  }

  const sections: SectionConfig[] = [];
  for (let i = 0; i < boundariesKm.length - 1; i++) {
    const start = boundariesKm[i]!;
    const end = boundariesKm[i + 1]!;
    sections.push({
      label: `Section ${i + 1}: ${start}-${end} km`,
      startKm: start,
      endKm: end,
    });
  }
  return sections;
}

// Optimized section stats computation (single pass)
function computeSectionsStats(
  points: GpxPoint[],
  sections: SectionConfig[]
): SectionStats[] {
  if (points.length < 2) {
    throw new Error(
      "Au moins 2 points sont nécessaires pour calculer les statistiques"
    );
  }

  // Initialize stats for each section
  const stats: SectionStats[] = sections.map((s) => ({
    label: s.label,
    startKm: s.startKm,
    endKm: s.endKm,
    distKm: 0,
    dPlus: 0,
    dMinus: 0,
  }));

  // Find points within each section in a single pass
  const sectionIndices: number[][] = sections.map(() => []);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    for (let j = 0; j < sections.length; j++) {
      if (
        point.cumDistKm >= sections[j]!.startKm &&
        point.cumDistKm <= sections[j]!.endKm
      ) {
        sectionIndices[j]!.push(i);
      }
    }
  }

  // Compute stats for each section
  for (let s = 0; s < sections.length; s++) {
    const indices = sectionIndices[s]!;
    if (indices.length < 2) {
      continue; // Already initialized with zeros
    }

    const firstIdx = indices[0]!;
    const lastIdx = indices[indices.length - 1]!;
    const firstPoint = points[firstIdx]!;
    const lastPoint = points[lastIdx]!;

    stats[s]!.distKm = lastPoint.cumDistKm - firstPoint.cumDistKm;

    // Calculate elevation changes
    for (let i = 1; i < indices.length; i++) {
      const currIdx = indices[i]!;
      const prevIdx = indices[i - 1]!;
      const curr = points[currIdx]!;
      const prev = points[prevIdx]!;
      const diff = curr.ele - prev.ele;

      if (diff > 0) {
        stats[s]!.dPlus += diff;
      } else if (diff < 0) {
        stats[s]!.dMinus += Math.abs(diff);
      }
    }
  }

  return stats;
}

// Pacing calculation
function computePacingFromVMA(
  sections: SectionStats[],
  vmaKmh: number,
  vmaPercent: number,
  hillFactor = 1,
  fatigueFactor = 0, // Réduction de vitesse par section (ex: 0.02 = 2% par section)
  descentPrudence = 0 // Réduction de vitesse dans les descentes (ex: 0.1 = 10% par 100m D-)
): { sections: SectionPacing[]; totalTimeSec: number } {
  if (vmaKmh <= 0) {
    throw new Error("La VMA doit être positive");
  }
  if (vmaPercent <= 0 || vmaPercent > 1) {
    throw new Error("Le pourcentage de VMA doit être entre 0 et 1");
  }
  if (hillFactor < 0) {
    throw new Error("Le facteur de dénivelé doit être positif");
  }
  if (fatigueFactor < 0 || fatigueFactor > 1) {
    throw new Error("Le facteur de fatigue doit être entre 0 et 1");
  }
  if (descentPrudence < 0 || descentPrudence > 1) {
    throw new Error(
      "Le facteur de prudence en descente doit être entre 0 et 1"
    );
  }

  const vBaseKmh = vmaKmh * vmaPercent;
  let totalTimeSec = 0;
  let cumulativeFatigue = 0; // Fatigue accumulée au fil des sections

  const pacedSections: SectionPacing[] = sections.map((s, index) => {
    if (s.distKm <= 0) {
      return {
        ...s,
        effortKm: 0,
        targetTimeSec: 0,
        targetPaceMinPerKm: 0,
      };
    }

    // Application de la fatigue progressive
    const fatigueReduction = 1 - cumulativeFatigue;
    cumulativeFatigue += fatigueFactor;

    // Application de la prudence dans les descentes
    const descentReduction =
      s.dMinus > 0 ? 1 - (s.dMinus / 100) * descentPrudence : 1;

    // Vitesse ajustée pour cette section
    const vSectionKmh = vBaseKmh * fatigueReduction * descentReduction;

    // Calcul de l'effort (distance + dénivelé positif)
    const effortKm = s.distKm + (s.dPlus / 100) * hillFactor;

    // Temps nécessaire avec la vitesse ajustée
    const timeSec = (effortKm / vSectionKmh) * SECONDS_PER_HOUR;
    const paceMinPerKm = timeSec / SECONDS_PER_MINUTE / s.distKm;

    totalTimeSec += timeSec;

    return {
      ...s,
      effortKm,
      targetTimeSec: timeSec,
      targetPaceMinPerKm: paceMinPerKm,
    };
  });

  return { sections: pacedSections, totalTimeSec };
}

// Formatting functions
function formatTime(sec: number): string {
  const h = Math.floor(sec / SECONDS_PER_HOUR);
  const m = Math.floor((sec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const s = Math.round(sec % SECONDS_PER_MINUTE);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

function formatPace(minPerKm: number): string {
  if (minPerKm === 0 || !isFinite(minPerKm)) {
    return "N/A";
  }
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * SECONDS_PER_MINUTE);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

// Main function
function main() {
  try {
    const filePath = "./file.gpx";

    // 1. Lecture & parsing GPX
    const rawPoints = parseGpx(filePath);
    const points = buildCumulativePoints(rawPoints);

    // 2. Config des portions
    const boundaries = [0, 30, 63, 90, 122]; // km
    const sectionsConfig = buildSectionsFromBoundaries(boundaries);

    // 3. Stats dist + D+ par portion
    const sectionsStats = computeSectionsStats(points, sectionsConfig);

    // 4. Pacing à partir de la VMA
    const vmaKmh = 16;
    const vmaPercent = 0.5; // 50%
    const hillFactor = 1; // 100 m D+ = 1 km d'effort
    const fatigueFactor = 0; // 1% de réduction de vitesse par section
    const descentPrudence = 0; // 5% de réduction par 100m de D-

    const { sections: pacing, totalTimeSec } = computePacingFromVMA(
      sectionsStats,
      vmaKmh,
      vmaPercent,
      hillFactor,
      fatigueFactor,
      descentPrudence
    );

    // Calcul des totaux
    const totalDPlus = pacing.reduce((sum, s) => sum + s.dPlus, 0);
    const totalDMinus = pacing.reduce((sum, s) => sum + s.dMinus, 0);

    console.log("═══════════════════════════════════════════════════");
    console.log(`Temps global estimé : ${formatTime(totalTimeSec)}`);
    console.log(
      `Distance totale : ${points[points.length - 1]!.cumDistKm.toFixed(2)} km`
    );
    console.log(`D+ total : ${Math.round(totalDPlus)} m`);
    console.log(`D- total : ${Math.round(totalDMinus)} m`);
    console.log(`VMA : ${vmaKmh} km/h`);
    console.log(`VMA % : ${vmaPercent}`);
    console.log(`Fatigue : ${(fatigueFactor * 100).toFixed(1)}% par section`);
    console.log(
      `Prudence descentes : ${(descentPrudence * 100).toFixed(1)}% par 100m D-`
    );
    console.log("═══════════════════════════════════════════════════\n");

    pacing.forEach((s) => {
      console.log(
        `${s.label}`,
        `\n  Distance: ${s.distKm.toFixed(2)} km`,
        `| D+: ${Math.round(s.dPlus)} m`,
        `| D-: ${Math.round(s.dMinus)} m`,
        `\n  Temps: ${formatTime(s.targetTimeSec)}`,
        `| Allure: ${formatPace(s.targetPaceMinPerKm)}`,
        `| Effort: ${s.effortKm.toFixed(2)} km\n`
      );
    });
  } catch (error) {
    console.error(
      "Erreur:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
