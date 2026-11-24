const path = require('path');
const { getAiSettings, getAiProfileById, queryAll } = require('../db/database');

function getWorkshopMachinesContext() {
  try {
    const rows = queryAll('SELECT nom, type, enPanne FROM machines ORDER BY nom ASC') || [];
    if (!rows.length) return '';
    const list = rows
      .map(m => `${m.nom} (${m.type || 'Machine'}${m.enPanne ? ', EN PANNE' : ''})`)
      .join(', ');
    return `Parc machines réel de l'atelier : ${list}.`;
  } catch {
    return '';
  }
}

const MATERIALS_REGEX = [
  /CuZn\d+[A-Za-z0-9]*/i,
  /42CrMo4/i, /XC48|C45/i, /35NCD16/i, /S235|S355/i,
  /Bronze\s*(?:au\s+mangan[èe]se|CuSn12|UE12)?/i,
  /Laiton\s*(?:sp[ée]cial|CuZn\d+)?/i,
  /Acier\s+[A-Z0-9-]+/i,
  /Alu(?:minium)?\s*(?:7075|6061|2017|AU4G|AG3)?/i,
  /Inox\s*(?:304L?|316L?|310)?/i,
  /POM|Delrin|PTFE|Teflon|Nylon/i
];

function buildDefaultCadSpec(extracted) {
  const partType = extracted.partType || 'arbre';
  const od = Math.max(6, Number(extracted.outerDiameter) || 50);
  const id = Math.max(0, Math.min(od - 2, Number(extracted.innerDiameter) || 0));
  const len = Math.max(4, Number(extracted.length) || 100);
  const w = Math.max(6, Number(extracted.width) || 80);
  const thk = Math.max(2, Number(extracted.thickness) || 20);
  const holeCount = Math.max(0, Math.min(24, parseInt(extracted.holeCount, 10) || 0));
  const holeD = Math.max(1, Number(extracted.holeDiameter) || 10);
  const pcd = Math.max(id + holeD + 2, Math.min(od - holeD - 2, Number(extracted.pcd) || Math.round(od * 0.72)));

  const features = [];
  if (partType === 'plaque') {
    features.push({ id: 'f1', label: `Bloc ${len}×${w}×${thk}`, op: 'add_box', lx: len, ly: w, lz: thk, x: 0, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f2', label: `Alésage Ø${id}`, op: 'cut_bore', axis: 'z', diameter: id, length: thk + 4, x: 0, y: 0, z: 0 });
    if (holeCount > 0) {
      features.push({ id: 'f3', label: `${holeCount}× Perçages Ø${holeD}`, op: 'cut_hole_pattern', axis: 'z', count: holeCount, holeDiameter: holeD, pcd: Math.min(len, w) * 0.7, depth: thk + 4, startAngleDeg: 45, x: 0, y: 0, z: 0 });
    }
  } else if (partType === 'bride') {
    features.push({ id: 'f1', label: `Disque Ø${od} ép.${thk}`, op: 'add_cylinder', axis: 'z', diameter: od, length: thk, x: 0, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f2', label: `Alésage central Ø${id}`, op: 'cut_bore', axis: 'z', diameter: id, length: thk + 4, x: 0, y: 0, z: 0 });
    if (holeCount > 0) {
      features.push({ id: 'f3', label: `${holeCount}× Trous Ø${holeD} sur PCD Ø${pcd}`, op: 'cut_hole_pattern', axis: 'z', count: holeCount, holeDiameter: holeD, pcd, depth: thk + 4, startAngleDeg: 0, x: 0, y: 0, z: 0 });
    }
  } else if (partType === 'bague') {
    features.push({ id: 'f1', label: `Cylindre ext. Ø${od} L${len}`, op: 'add_cylinder', axis: 'x', diameter: od, length: len, x: 0, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f2', label: `Alésage Ø${id}`, op: 'cut_bore', axis: 'x', diameter: id, length: len + 4, x: 0, y: 0, z: 0 });
  } else if (partType === 'ecrou_complexe') {
    // Rich multi-feature mechanical nut / sleeve template (collar + flats + bore + radial holes + central groove)
    const bodyLen = Math.round(len * 0.82);
    const collarOd = Math.round(od * 0.79);
    features.push({ id: 'f1', label: `Corps principal Ø${od} L${bodyLen}`, op: 'add_cylinder', axis: 'x', diameter: od, length: bodyLen, x: 0, y: 0, z: 0 });
    features.push({ id: 'f2', label: `Manchons extrémités Ø${collarOd} L${len}`, op: 'add_cylinder', axis: 'x', diameter: collarOd, length: len, x: 0, y: 0, z: 0 });
    features.push({ id: 'f3', label: `Méplat supérieur (${Math.round(od * 0.95)} mm)`, op: 'cut_flat', side: '+y', distanceFromCenter: Math.round(od * 0.45), span: len + 10 });
    features.push({ id: 'f4', label: `Alésage central Ø${id || Math.round(od * 0.5)}`, op: 'cut_bore', axis: 'x', diameter: id || Math.round(od * 0.5), length: len + 10, x: 0, y: 0, z: 0 });
    features.push({ id: 'f5', label: `${holeCount || 6}× Perçages Ø${holeD} sur PCD Ø${pcd}`, op: 'cut_hole_pattern', axis: 'x', count: holeCount || 6, holeDiameter: holeD, pcd, depth: len + 10, startAngleDeg: 30, x: 0, y: 0, z: 0 });
    features.push({ id: 'f6', label: 'Rainure centrale L25', op: 'cut_slot', lx: 25, ly: od + 10, lz: 10, x: 0, y: 0, z: Math.round(od * 0.48) });
  } else {
    // Arbre étagé
    features.push({ id: 'f1', label: `Arbre Ø${od} L${len}`, op: 'add_cylinder', axis: 'x', diameter: od, length: len, x: 0, y: 0, z: 0 });
    const s2d = Math.max(6, Math.round(od * 0.72));
    const s2l = Math.max(10, Math.round(len * 0.3));
    features.push({ id: 'f2', label: `Épaulement Ø${s2d} L${s2l}`, op: 'add_cylinder', axis: 'x', diameter: s2d, length: s2l, x: (len + s2l) / 2, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f3', label: `Alésage axial Ø${id}`, op: 'cut_bore', axis: 'x', diameter: id, length: len + s2l + 10, x: s2l / 2, y: 0, z: 0 });
  }

  return {
    unit: 'mm',
    name: extracted.partName || `Piece_${partType}`,
    features
  };
}

function extractLocalDimensions(text = '', filename = '') {
  const src = `${filename} ${text}`.replace(/\s+/g, ' ');
  const holesMatch = src.match(/(\d+)\s*[x×]\s*(?:Ø|ø|M)\s*(\d+(?:[.,]\d+)?)/i);
  const srcWithoutHoles = holesMatch ? src.replace(holesMatch[0], ' ') : src;

  const diameters = [...srcWithoutHoles.matchAll(/(?:Ø|ø|\bdiam(?:ètre|etre)?|\bD)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi)]
    .map(m => parseFloat(m[1].replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 2000);

  const lengthMatch = src.match(/\b(?:L|Long(?:ueur)?|Ht)\s*[:=]?\s*(\d+(?:[.,]\d+)?)|\bH\s*[:=]\s*(\d+(?:[.,]\d+)?)/i);
  const lengthRaw = lengthMatch ? (lengthMatch[1] || lengthMatch[2]) : null;
  const widthMatch = src.match(/\b(?:Larg(?:eur)?|W)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const thickMatch = src.match(/\b(?:ep|ép(?:aisseur)?|thk)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const pcdMatch = src.match(/\b(?:PCD|entraxe|Ø\s*per[çc]age)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const threadMatch = src.match(/\b(Tr\s*\d+\s*[x×]\s*\d+(?:\s*P\(\d+\))?(?:\s*\d+-START)?|M\d+(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?)/i);
  const tolerances = [...src.matchAll(/(?:±\s*\d+(?:[.,]\d+)?|\+\d+[.,]\d+\/\d+|\b(?:H|h|g|f|k|m|n|p|js|JS|G|F|K|N|P)\d{1,2}\b|Ra\s*\d+(?:[.,]\d+)?)/g)]
    .map(m => m[0])
    .slice(0, 8);

  let material = '';
  for (const re of MATERIALS_REGEX) {
    const m = src.match(re);
    if (m) {
      material = m[0].trim();
      break;
    }
  }

  let partType = 'arbre';
  const low = src.toLowerCase();
  if (/ecrou|écrou|screw|vis femelle|tr\s*\d|manchon/.test(low)) partType = 'ecrou_complexe';
  else if (/bride|flange|plateau|disque/.test(low)) partType = 'bride';
  else if (/bague|douille|entretoise|palier/.test(low)) partType = 'bague';
  else if (/plaque|bloc|support|cale|plat|semelle/.test(low)) partType = 'plaque';

  const uniqueDiams = [...new Set(diameters)].sort((a, b) => b - a);
  const outerDiameter = uniqueDiams[0] || (partType === 'ecrou_complexe' ? 120 : partType === 'bride' ? 120 : partType === 'bague' ? 50 : 45);
  const innerDiameter = uniqueDiams.length > 1
    ? uniqueDiams[1]
    : (partType === 'bague' || partType === 'ecrou_complexe' ? Math.round(outerDiameter * 0.5) : partType === 'bride' ? Math.round(outerDiameter * 0.35) : 0);

  const length = lengthRaw ? parseFloat(lengthRaw.replace(',', '.')) : (partType === 'ecrou_complexe' ? 230 : partType === 'bride' ? 20 : partType === 'bague' ? 40 : 120);
  const width = widthMatch ? parseFloat(widthMatch[1].replace(',', '.')) : 80;
  const thickness = thickMatch ? parseFloat(thickMatch[1].replace(',', '.')) : 20;
  const holeCount = holesMatch ? parseInt(holesMatch[1], 10) : (partType === 'bride' || partType === 'ecrou_complexe' ? 6 : partType === 'plaque' ? 4 : 0);
  const holeDiameter = holesMatch ? parseFloat(holesMatch[2].replace(',', '.')) : 10;
  const pcd = pcdMatch ? parseFloat(pcdMatch[1].replace(',', '.')) : Math.round(outerDiameter * 0.72);

  const rawStock = partType === 'plaque'
    ? `Plat / Bloc ${Math.ceil(length + 6)}×${Math.ceil(width + 6)}×${Math.ceil(thickness + 4)} mm`
    : `Rond Ø${Math.ceil(outerDiameter + 5)} × L${Math.ceil(length + 10)} mm`;

  const suggestedOperations = [];
  if (partType === 'plaque') {
    suggestedOperations.push({ libelle: 'Fraisage CNC (surfaçage + contour + perçages)', typeMachine: 'Fraisage CNC', tempsReglageMin: 30, tempsUnitaireMin: 15 });
  } else {
    suggestedOperations.push({ libelle: `Tournage CNC (ébauche + finition Ø${outerDiameter}${threadMatch ? ` + ${threadMatch[1]}` : ''})`, typeMachine: 'Tournage CNC', tempsReglageMin: 30, tempsUnitaireMin: 18 });
    if (holeCount > 0 || partType === 'ecrou_complexe') {
      suggestedOperations.push({ libelle: `Fraisage CNC (méplats / rainures / ${holeCount}×Ø${holeDFormat(holeDiameter)})`, typeMachine: 'Fraisage CNC', tempsReglageMin: 25, tempsUnitaireMin: 12 });
    }
  }
  suggestedOperations.push({ libelle: 'Ébavurage & Contrôle dimensionnel', typeMachine: 'Contrôle', tempsReglageMin: 10, tempsUnitaireMin: 5 });

  return {
    partType,
    partName: path.parse(filename || 'Piece').name,
    client: '',
    reference: '',
    revision: '',
    outerDiameter,
    innerDiameter,
    length,
    width,
    thickness,
    holeCount,
    holeDiameter,
    pcd,
    material: material || '',
    rawStock,
    tolerances,
    specialNotes: threadMatch ? [`Filetage détecté : ${threadMatch[1]}`] : [],
    suggestedOperations,
    detectedRaw: {
      diameters: uniqueDiams,
      hasText: text.trim().length > 0
    }
  };
}

function holeDFormat(v) {
  return Number.isFinite(Number(v)) ? v : 10;
}

function extractReadableTextFromPdfBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return '';
  const raw = buf.toString('latin1');
  const matches = [...raw.matchAll(/\(([^()\\]{2,120})\)/g)].map(m => m[1]);
  return matches.join(' ').replace(/[^\x20-\x7EÀ-ÿØø±×]/g, ' ').slice(0, 6000);
}

const ASSEMBLY_BLUEPRINT_DOC = `MOTEUR CAO B-REP PAR FICHE GÉOMÉTRIQUE & ASSEMBLEUR DE BRIQUES (MODE RECOMMANDÉ PAR DÉFAUT — 0 BUG DE CODE, < 1 SECONDE) :
Au lieu d'écrire du code JS libre, remplis \`cadSpec.engine = "assembly"\` + \`cadSpec.params\` (toutes les cotes importantes au 0.001 mm) + \`cadSpec.blueprint = { body, features }\`.
Chaque valeur numérique dans \`blueprint\` peut être soit un nombre, soit le nom d'une clé de \`params\` (ex: \`"longueur"\`, \`"diametre_ext"\`, \`"longueur / 2"\`) pour que modifier un paramètre mette à jour le 3D instantanément !

1. CORPS PRINCIPAL (\`blueprint.body\`, centré sur [0,0,0], \`axis: "x"\` pour pièces tournées, \`"z"\` pour plaques/brides) :
   - \`{ "type": "d_profile", "radius": "rayon_corps", "flatWidth": "largeur_meplat", "length": "longueur_corps", "axis": "x", "color": "#b8894a" }\` (corps cylindrique R avec méplat latéral à cote totale flatWidth)
   - \`{ "type": "cylinder", "diameter": "diametre_ext", "length": "longueur", "axis": "x", "color": "#94a3b8" }\`
   - \`{ "type": "revolve", "axis": "x", "profile": [[r0, x0], [r1, x1], ...], "color": "#94a3b8" }\` (arbre étagé, manchon, cône, bague profilée)
   - \`{ "type": "box", "lx": "longueur", "ly": "largeur", "lz": "epaisseur", "cornerRadius": 0, "axis": "z", "color": "#94a3b8" }\` (plaque, bloc, équerre)
   - \`{ "type": "flange", "flangeDiameter": "d_bride", "flangeThickness": "ep_bride", "hubDiameter": "d_moyeu", "hubLength": "l_moyeu", "axis": "z" }\` (bride, moyeu)
   - \`{ "type": "polygon", "sides": 6, "acrossFlats": "surplats", "length": "longueur", "axis": "x" }\` (6 pans, octogone)

2. BRIQUES D'USINAGE & ASSEMBLAGE (\`blueprint.features[]\`, exécutées dans l'ordre) :
   - \`{ "id": "tenons", "type": "boss", "label": "Tenons d'extrémité", "shape": "box"|"cylinder", "lx": "l_tenon", "ly": "larg_tenon", "lz": "haut_tenon", "bothEnds": true, "endOffset": "(longueur_corps + l_tenon) / 2 - 2", "axis": "x" }\` (ajout de tenons, ergots, manchons ou bossages aux deux bouts ou à un \`center: [x,y,z]\`)
   - \`{ "id": "gorge", "type": "groove_ext", "label": "Gorge centrale ext.", "grooveDiameter": "d_gorge", "outerDiameter": "d_ext", "width": "l_gorge", "axis": "x", "center": [0,0,0] }\` (gorge tournée extérieure — NE COUPE PAS la pièce !)
   - \`{ "id": "gorge_int", "type": "groove_int", "label": "Gorge intérieure", "grooveDiameter": "d_gorge_int", "width": "l_gorge", "axis": "x", "center": [0,0,0] }\`
   - \`{ "id": "alesage", "type": "bore", "label": "Alésage central", "diameter": "d_alesage", "through": true, "axis": "x", "center": [0,0,0] }\`
   - \`{ "id": "filet", "type": "thread", "label": "Filetage Tr65x8", "nominalDiameter": "d_filet", "pitch": "pas_filet", "length": "longueur_filet", "internal": true, "profile": "trapezoidal"|"metric", "axis": "x", "center": [0,0,0] }\` (1 seule brique rapide < 0.5 s)
   - \`{ "id": "trous", "type": "hole_pattern", "label": "Perçages PCD", "count": 8, "diameter": "d_trou", "pcd": "pcd", "through": true, "startAngleDeg": 0, "angles"?: [0,38,...], "axis": "x", "center": [0,0,0] }\`
   - \`{ "id": "trou_1", "type": "hole", "label": "Perçage radial", "diameter": 10, "depth": 30, "axis": "y", "positions": [[0, 0, 0]] }\`
   - \`{ "id": "rainure", "type": "slot", "label": "Rainure / Méplat", "lx": 20, "ly": 10, "lz": 8, "center": [0,0,0] }\`
   - \`{ "id": "inserts", "type": "pins", "label": "Inserts Téflon", "name": "Inserts PTFE", "color": "#f1f5f9", "count": 8, "diameter": "d_insert", "pcd": "pcd", "length": "longueur_corps", "cutHostHole": true, "axis": "x", "startAngleDeg": 0 }\` (crée les trous dans le corps + les inserts blancs en solide séparé !)
   - \`{ "id": "chanfrein", "type": "chamfer", "label": "Chanfreins", "size": 1.5 }\` / \`{ "id": "conge", "type": "fillet", "label": "Congés", "radius": 2 }\`

COULEURS MATIÈRES : Acier \`#94a3b8\`, Inox \`#b4becb\`, Alu \`#cbd5e1\`, Bronze \`#b8894a\`, Laiton \`#d4af37\`, Fonte \`#64748b\`, Téflon/PTFE \`#f1f5f9\`.
Note : Utilise \`engine: "assembly"\` + \`blueprint\` pour 95 % des pièces mécaniques. N'utilise \`engine: "replicad"\` + \`code\` QUE si une géométrie organique/libre est impossible avec ces briques.`;

const REPLICAD_API_DOC = `${ASSEMBLY_BLUEPRINT_DOC}`;

const VISION_PROMPT = (filename, extraPrompt = '') => {
  const machinesCtx = getWorkshopMachinesContext();
  return `Tu es un Ingénieur Bureau d'Études & Méthodes CNC senior, expert en lecture de plans ISO 2D, DFM (fabricabilité atelier) et CAO B-Rep OpenCASCADE (Replicad).
Analyse ce plan technique 2D (${filename}) — vues, coupes, cartouche, annotations manuscrites, tolérances géométriques et matière — EN UNE SEULE PASSE COMPLÈTE.
${machinesCtx ? `${machinesCtx}\n` : ''}${extraPrompt}

MÉTHODE DE RÉFLEXION RIGOUREUSE (remplis "thinking" EN PREMIER avant d'écrire le code 3D) :
1. LECTURE CROISÉE DES VUES (ANTI-INVERSION) : Recoupe la vue de face, la vue de côté et les coupes AVANT toute modélisation. Vérifie précisément quels volumes sont EN SAILLIE (corps principal, bossages, manchons) et quels usinages sont EN CREUX (gorges centrales, rainures, méplats, alésages) — NE JAMAIS inverser un gros corps avec une gorge centrale !
2. MODÉLISATION COMPLÈTE OBLIGATOIRE (INTERDICTION D'ESQUIVER) : Si une vue montre un méplat, un profil en D, des ergots, des manchons, une gorge extérieure, des perçages ou des inserts, TU DOIS TOUS LES MODÉLISER dans \`main(P)\`. Il est STRICTEMENT INTERDIT d'ignorer une forme visible en écrivant "non modélisé, à confirmer".
3. CONTRÔLE DE COHÉRENCE DES COTES : Relis attentivement chaque chiffre et vérifie les sommes de longueurs (ex: longueur totale = somme des tronçons) et les rayons/diamètres (un rayon R60 = Ø120 ; vérifie les entraxes PCD par rapport aux diamètres intérieur et extérieur).
4. DIAGNOSTIC DFM CONCRET adapté aux machines de l'atelier (rapport L/D, bridage, tolérances serrées, ordre d'usinage, cotes illisibles à vérifier).
5. TRADUCTION IMMÉDIATE en modèle CAO Replicad B-Rep paramétrique complet dans "cadSpec" dès ce premier appel.

Retourne STRICTEMENT un JSON valide (aucun texte hors JSON) respectant ce schéma exact :
{
  "thinking": {
    "vues_et_fonction": string,
    "cotes_cles": string[],
    "alertes_dfm": string[],
    "points_a_verifier": string[]
  },
  "ficheTechnique": {
    "client": string,
    "reference": string,
    "revision": string,
    "partName": string,
    "material": string,
    "rawStock": string,
    "criticalTolerances": string[],
    "specialNotes": string[],
    "suggestedOperations": [
      { "libelle": string, "typeMachine": "Tournage CNC"|"Fraisage CNC"|"Tournage Manuel"|"Contrôle", "tempsReglageMin": number, "tempsUnitaireMin": number }
    ],
    "summary": string
  },
  "cadSpec": {
    "engine": "assembly",
    "unit": "mm",
    "name": string,
    "material": string,
    "params": [
      { "key": string, "label": string, "value": number, "unit": "mm"|"°"|"u", "tolerance"?: string, "confidence": "high"|"check", "sourceView"?: string }
    ],
    "blueprint": {
      "body": { "type": "d_profile"|"cylinder"|"revolve"|"box"|"flange"|"polygon", "axis": "x"|"y"|"z", ... },
      "features": [ { "id": string, "type": "boss"|"bore"|"groove_ext"|"groove_int"|"thread"|"hole_pattern"|"hole"|"slot"|"pins"|"chamfer"|"fillet", "label": string, ... } ]
    }
  }
}

${REPLICAD_API_DOC}`;
};

function extractJsonFromText(txt) {
  if (!txt) return null;
  let trimmed = String(txt).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  try {
    return JSON.parse(trimmed);
  } catch {}
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  return null;
}

function defaultModelForProvider(provider) {
  if (provider === 'qwen' || provider === 'qwen_us' || provider === 'qwen_cn') return 'qwen3.8-flash';
  if (provider === 'gemini') return 'gemini-3.8-flash';
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'anthropic') return 'claude-sonnet-4-20250514';
  if (provider === 'openrouter') return 'qwen/qwen3.8-27b:free';
  if (provider === 'groq') return 'meta-llama/llama-4-scout-17b-16e-instruct';
  return 'gpt-4o-mini';
}

function resolveRuntimeAiConfig(override = null) {
  const saved = override?.profileId ? (getAiProfileById(override.profileId) || getAiSettings()) : getAiSettings();
  if (!override) return saved;
  const provider = override.provider !== undefined ? String(override.provider).trim() : saved.provider;
  const apiKey = override.apiKey !== undefined && String(override.apiKey).trim() !== ''
    ? String(override.apiKey).trim()
    : saved.apiKey;
  const model = override.model !== undefined ? String(override.model).trim() : saved.model;
  const baseUrl = override.baseUrl !== undefined ? String(override.baseUrl).trim() : saved.baseUrl;

  let resolvedProvider = provider || 'auto';
  if (resolvedProvider === 'auto') {
    if (!apiKey) resolvedProvider = 'offline';
    else if (apiKey.startsWith('AIza')) resolvedProvider = 'gemini';
    else if (apiKey.startsWith('sk-ant-')) resolvedProvider = 'anthropic';
    else if (apiKey.startsWith('sk-or-')) resolvedProvider = 'openrouter';
    else if (apiKey.startsWith('gsk_')) resolvedProvider = 'groq';
    else resolvedProvider = 'openai';
  }
  return { provider, resolvedProvider, apiKey, model, baseUrl, source: 'override' };
}

async function callConfiguredAiRaw({ promptText, buffer = null, mimeType = 'image/jpeg', images = [], overrideConfig = null, expectJson = true, deepThinking = false }) {
  const cfg = resolveRuntimeAiConfig(overrideConfig);
  const provider = cfg.resolvedProvider;
  if (!provider || provider === 'offline') return null;
  if (!cfg.apiKey && provider !== 'custom') return null;

  const model = cfg.model || defaultModelForProvider(provider);

  // Normalize all vision attachments into [{ mimeType, base64 }]
  const mediaList = [];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (!img?.base64) continue;
      const cleanB64 = String(img.base64).includes(',') ? String(img.base64).split(',')[1] : String(img.base64);
      if (cleanB64) mediaList.push({ mimeType: img.mimeType || 'image/png', base64: cleanB64 });
    }
  }
  if (mediaList.length === 0 && buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
    mediaList.push({ mimeType, base64: buffer.toString('base64') });
  }

  if (provider === 'gemini') {
    const parts = [{ text: promptText }];
    for (const m of mediaList) {
      parts.push({ inline_data: { mime_type: m.mimeType, data: m.base64 } });
    }

    const callOnce = async (mdl) => {
      const cleanMdl = String(mdl || '').replace(/^models\//, '');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanMdl)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json, model: cleanMdl };
    };

    let attempt = await callOnce(model);
    if (!attempt.ok) {
      const errMsg = attempt.json?.error?.message || `Gemini HTTP ${attempt.status}`;
      if (attempt.status === 404 || /no longer available|not found/i.test(errMsg)) {
        const candidates = [];
        const suggested = errMsg.match(/use\s+(?:models\/)?([a-z0-9._-]+)/i);
        if (suggested?.[1]) candidates.push(suggested[1]);
        for (const fb of ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']) {
          if (fb !== attempt.model && !candidates.includes(fb)) candidates.push(fb);
        }
        try {
          const live = await listAvailableModels(overrideConfig);
          for (const m of (live.models || []).slice(0, 4)) {
            if (!candidates.includes(m)) candidates.push(m);
          }
        } catch {}
        for (const cand of candidates) {
          const retry = await callOnce(cand);
          if (retry.ok) {
            attempt = retry;
            break;
          }
        }
      }
      if (!attempt.ok) {
        throw new Error(attempt.json?.error?.message || `Gemini HTTP ${attempt.status}`);
      }
    }
    const txt = attempt.json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { provider, model: attempt.model, text: txt, data: expectJson ? extractJsonFromText(txt) : null };
  }

  if (provider === 'anthropic') {
    const content = [];
    for (const m of mediaList) {
      if (m.mimeType === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: m.base64 }
        });
      } else {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: m.mimeType, data: m.base64 }
        });
      }
    }
    content.push({ type: 'text', text: promptText });

    const callAnthropic = async (useThinking) => {
      const body = {
        model,
        max_tokens: useThinking ? 8192 : 6144,
        messages: [{ role: 'user', content }]
      };
      if (useThinking) body.thinking = { type: 'enabled', budget_tokens: 1600 };
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    };

    let attempt = await callAnthropic(deepThinking);
    if (!attempt.ok && deepThinking && (attempt.status === 400 || attempt.status === 422)) {
      attempt = await callAnthropic(false);
    }
    if (!attempt.ok) throw new Error(attempt.json?.error?.message || `Anthropic HTTP ${attempt.status}`);
    const txt = (attempt.json?.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
    return { provider, model, text: txt, data: expectJson ? extractJsonFromText(txt) : null };
  }

  // OpenAI / Alibaba Qwen (DashScope) / OpenRouter / Groq / Custom OpenAI-compatible
  let endpoint = 'https://api.openai.com/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (provider === 'qwen') {
    endpoint = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
  } else if (provider === 'qwen_us') {
    endpoint = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions';
  } else if (provider === 'qwen_cn') {
    endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  } else if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers['HTTP-Referer'] = 'https://atelier-manager.local';
    headers['X-Title'] = 'Atelier Manager Pro';
  } else if (provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  } else if (provider === 'custom') {
    if (!cfg.baseUrl) throw new Error('URL de base requise pour un endpoint personnalisé');
    const clean = cfg.baseUrl.replace(/\/+$/, '');
    endpoint = clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
  }

  // ALWAYS send detail: "high" so Vision models read fine CAD dimensions without downscaling to 512px!
  const contentParts = [{ type: 'text', text: promptText }];
  for (const m of mediaList) {
    if (m.mimeType !== 'application/pdf') {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${m.mimeType};base64,${m.base64}`,
          detail: 'high'
        }
      });
    }
  }

  const callOpenAiStyle = async (useThinking) => {
    const payload = {
      model,
      messages: [{ role: 'user', content: contentParts }]
    };
    if (expectJson && provider === 'openai') {
      payload.response_format = { type: 'json_object' };
    }
    if (useThinking) {
      if (provider === 'qwen' || provider === 'qwen_us' || provider === 'qwen_cn') {
        payload.enable_thinking = true;
        payload.thinking_budget = 1600;
      } else if (provider === 'openrouter') {
        payload.reasoning = { effort: 'low' };
      }
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  };

  const canThink = deepThinking && (provider === 'qwen' || provider === 'qwen_us' || provider === 'qwen_cn' || provider === 'openrouter');
  let attempt = await callOpenAiStyle(canThink);
  // Auto-fallback cleanly if a specific model does not support enable_thinking / reasoning
  if (!attempt.ok && canThink && (attempt.status === 400 || attempt.status === 422)) {
    attempt = await callOpenAiStyle(false);
  }
  if (!attempt.ok) throw new Error(attempt.json?.error?.message || `${provider} HTTP ${attempt.status}`);
  const msgObj = attempt.json?.choices?.[0]?.message || {};
  const txt = msgObj.content || '';
  return { provider, model, text: txt, reasoning: msgObj.reasoning_content || '', data: expectJson ? extractJsonFromText(txt) : null };
}

async function listAvailableModels(overrideConfig = null) {
  const cfg = resolveRuntimeAiConfig(overrideConfig);
  const provider = cfg.resolvedProvider;
  if (!provider || provider === 'offline' || (!cfg.apiKey && provider !== 'custom')) {
    return { ok: false, models: [], error: 'Aucune clé API configurée.' };
  }
  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Gemini HTTP ${res.status}`);
    const models = (json.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(name => /gemini/i.test(name) && !/embedding|tts|imagen|veo|aqa/i.test(name))
      .sort((a, b) => {
        const aFlash = /flash/i.test(a) ? 0 : 1;
        const bFlash = /flash/i.test(b) ? 0 : 1;
        if (aFlash !== bFlash) return aFlash - bFlash;
        return b.localeCompare(a);
      });
    return { ok: true, provider, models: models.slice(0, 25) };
  }
  if (provider === 'qwen' || provider === 'qwen_us' || provider === 'qwen_cn') {
    const base =
      provider === 'qwen_us' ? 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' :
      provider === 'qwen_cn' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' :
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    try {
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.data) && json.data.length > 0) {
        const live = json.data.map(m => m.id).filter(Boolean);
        return { ok: true, provider, models: live.slice(0, 40) };
      }
    } catch {}
    return {
      ok: true,
      provider,
      models: ['qwen3.8-flash', 'qwen3.8-max', 'qwen3.8-omni-flash', 'qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct']
    };
  }
  if (provider === 'anthropic') {
    return {
      ok: true,
      provider,
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest']
    };
  }
  let endpoint = 'https://api.openai.com/v1/models';
  const headers = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (provider === 'openrouter') endpoint = 'https://openrouter.ai/api/v1/models';
  else if (provider === 'groq') endpoint = 'https://api.groq.com/openai/v1/models';
  else if (provider === 'custom') {
    if (!cfg.baseUrl) throw new Error('URL de base requise');
    endpoint = `${cfg.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`;
  }
  const res = await fetch(endpoint, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `${provider} HTTP ${res.status}`);
  const models = (json.data || []).map(m => m.id).filter(Boolean).slice(0, 40);
  return { ok: true, provider, models };
}

async function testAiConnection(overrideConfig = null) {
  const started = Date.now();
  const cfg = resolveRuntimeAiConfig(overrideConfig);
  if (!cfg.resolvedProvider || cfg.resolvedProvider === 'offline' || (!cfg.apiKey && cfg.resolvedProvider !== 'custom')) {
    return { ok: false, error: 'Aucune clé API configurée (mode hors-ligne actif).' };
  }
  const resp = await callConfiguredAiRaw({
    promptText: 'Réponds uniquement en JSON valide : {"status":"ok","message":"Connexion IA opérationnelle"}',
    overrideConfig,
    expectJson: false
  });
  return {
    ok: true,
    provider: resp.provider,
    model: resp.model,
    latencyMs: Date.now() - started,
    reply: String(resp.text || '').slice(0, 140)
  };
}

function sanitizeParamsList(rawParams) {
  if (!Array.isArray(rawParams)) return [];
  const seen = new Set();
  const out = [];
  for (const p of rawParams) {
    if (!p || !p.key) continue;
    const key = String(p.key).trim().replace(/[^a-zA-Z0-9_]/g, '_');
    if (!key || seen.has(key)) continue;
    const val = Number(p.value);
    if (!Number.isFinite(val)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(p.label || key),
      value: Number(val.toFixed(3)),
      unit: String(p.unit || 'mm'),
      tolerance: p.tolerance ? String(p.tolerance) : '',
      confidence: ['high', 'check', 'locked'].includes(p.confidence) ? p.confidence : 'high',
      sourceView: p.sourceView ? String(p.sourceView).slice(0, 60) : ''
    });
  }
  return out;
}

function sanitizeBlueprint(raw) {
  if (!raw || typeof raw !== 'object' || !raw.body || typeof raw.body !== 'object') return null;
  const ALLOWED_BODY = new Set(['d_profile', 'cylinder', 'revolve', 'box', 'flange', 'polygon']);
  const ALLOWED_FEAT = new Set(['boss', 'tenon', 'lug', 'collar', 'bore', 'groove_ext', 'groove_int', 'thread', 'hole_pattern', 'hole', 'slot', 'pocket', 'flat', 'keyway', 'pins', 'inserts', 'chamfer', 'fillet']);
  const bodyType = ALLOWED_BODY.has(raw.body.type) ? raw.body.type : 'cylinder';
  const features = Array.isArray(raw.features)
    ? raw.features
      .filter(f => f && typeof f === 'object' && ALLOWED_FEAT.has(f.type))
      .map((f, idx) => ({
        ...f,
        id: f.id || `b${idx + 1}`,
        label: String(f.label || f.type),
        enabled: f.enabled !== false
      }))
    : [];
  return {
    body: { ...raw.body, type: bodyType, axis: ['x', 'y', 'z'].includes(String(raw.body.axis || 'x').toLowerCase()) ? String(raw.body.axis || 'x').toLowerCase() : 'x' },
    features
  };
}

function sanitizeCadSpec(spec, fallbackName = 'Piece_CNC') {
  const cleanBp = sanitizeBlueprint(spec?.blueprint);
  if (spec && (spec.engine === 'assembly' || cleanBp)) {
    return {
      engine: 'assembly',
      unit: 'mm',
      name: String(spec.name || fallbackName),
      material: String(spec.material || ''),
      params: sanitizeParamsList(spec.params),
      blueprint: cleanBp || { body: { type: 'cylinder', diameter: 60, length: 100, axis: 'x' }, features: [] },
      code: spec.code ? String(spec.code).trim() : '',
      features: Array.isArray(spec.features) ? spec.features : []
    };
  }
  if (spec && (spec.engine === 'replicad' || (typeof spec.code === 'string' && spec.code.trim().length > 10))) {
    return {
      engine: 'replicad',
      unit: 'mm',
      name: String(spec.name || fallbackName),
      material: String(spec.material || ''),
      params: sanitizeParamsList(spec.params),
      code: String(spec.code || '').trim(),
      features: Array.isArray(spec.features) ? spec.features : []
    };
  }
  const ALLOWED_OPS = new Set([
    'add_cylinder', 'add_box', 'add_cone', 'add_revolve', 'add_extrude',
    'cut_bore', 'cut_cone', 'cut_revolve', 'cut_extrude',
    'cut_flat', 'cut_slot', 'cut_hole_pattern', 'cut_groove', 'cut_thread'
  ]);
  const features = Array.isArray(spec?.features)
    ? spec.features
      .filter(f => f && ALLOWED_OPS.has(f.op))
      .map((f, idx) => ({
        ...f,
        id: f.id || `f${idx + 1}`,
        label: String(f.label || f.op),
        tolerance: f.tolerance ? String(f.tolerance) : '',
        hidden: Boolean(f.hidden)
      }))
    : [];
  return {
    engine: 'csg',
    unit: 'mm',
    name: String(spec?.name || fallbackName),
    material: String(spec?.material || ''),
    features
  };
}

async function analyzePlanDocument({ buffer, filename = 'plan', notes = '', attachments = [] }) {
  const ext = path.extname(filename).toLowerCase();
  const mimeType =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    'image/jpeg';

  const aiCfg = getAiSettings();
  let aiData = null;
  let mode = 'local_parser';
  let aiWarning = '';

  const hasMedia = (Array.isArray(attachments) && attachments.length > 0) || (buffer && Buffer.isBuffer(buffer) && buffer.length > 0);
  if (hasMedia && aiCfg.resolvedProvider !== 'offline') {
    const promptText = VISION_PROMPT(filename, notes ? `Contexte OF : ${notes}` : '');
    try {
      const resp = await callConfiguredAiRaw({ promptText, buffer, mimeType, images: attachments, expectJson: true, deepThinking: true });
      if (resp?.data) {
        aiData = resp.data;
        mode = `${resp.provider}_vision_ai`;
      }
    } catch (err) {
      aiWarning = err.message;
    }
  }

  const pdfText = ext === '.pdf' ? extractReadableTextFromPdfBuffer(buffer) : '';
  const local = extractLocalDimensions(`${pdfText} ${notes}`, filename);
  const fallbackSpec = buildDefaultCadSpec(local);

  const ficheTechnique = aiData?.ficheTechnique ? {
    client: aiData.ficheTechnique.client || local.client || '',
    reference: aiData.ficheTechnique.reference || local.reference || '',
    revision: aiData.ficheTechnique.revision || local.revision || '',
    partName: aiData.ficheTechnique.partName || local.partName,
    material: aiData.ficheTechnique.material || local.material || '',
    rawStock: aiData.ficheTechnique.rawStock || local.rawStock,
    criticalTolerances: Array.isArray(aiData.ficheTechnique.criticalTolerances) ? aiData.ficheTechnique.criticalTolerances : local.tolerances,
    specialNotes: Array.isArray(aiData.ficheTechnique.specialNotes) ? aiData.ficheTechnique.specialNotes : local.specialNotes,
    suggestedOperations: Array.isArray(aiData.ficheTechnique.suggestedOperations) && aiData.ficheTechnique.suggestedOperations.length > 0
      ? aiData.ficheTechnique.suggestedOperations
      : local.suggestedOperations,
    summary: aiData.ficheTechnique.summary || 'Fiche technique et géométrie 3D extraites par Vision IA.'
  } : {
    client: local.client,
    reference: local.reference,
    revision: local.revision,
    partName: local.partName,
    material: local.material,
    rawStock: local.rawStock,
    criticalTolerances: local.tolerances,
    specialNotes: local.specialNotes,
    suggestedOperations: local.suggestedOperations,
    summary: aiWarning
      ? `Repli local (erreur provider IA : ${aiWarning}). Vérifiez la configuration dans Administration → Configuration IA.`
      : (local.detectedRaw.diameters.length > 0 || local.material
        ? `Pré-analyse locale : ${local.detectedRaw.diameters.length} diamètre(s) détecté(s)${local.material ? `, matière ${local.material}` : ''}. Le Directeur peut activer un provider Vision IA dans Administration → Configuration IA.`
        : 'Modèle de départ généré localement. Le Directeur peut activer un provider Vision IA dans Administration → Configuration IA, ou affinez directement via le prompt ingénieur.')
  };

  const hasReplicad = aiData?.cadSpec && typeof aiData.cadSpec.code === 'string' && aiData.cadSpec.code.trim().length > 10;
  const hasCsg = aiData?.cadSpec && Array.isArray(aiData.cadSpec.features) && aiData.cadSpec.features.length > 0;
  const cadSpec = (hasReplicad || hasCsg)
    ? sanitizeCadSpec({ ...aiData.cadSpec, material: aiData.cadSpec.material || ficheTechnique.material || '' }, ficheTechnique.partName)
    : fallbackSpec;

  const thinking = aiData?.thinking && typeof aiData.thinking === 'object' ? {
    vues_et_fonction: String(aiData.thinking.vues_et_fonction || ''),
    cotes_cles: Array.isArray(aiData.thinking.cotes_cles) ? aiData.thinking.cotes_cles : [],
    alertes_dfm: Array.isArray(aiData.thinking.alertes_dfm) ? aiData.thinking.alertes_dfm : [],
    points_a_verifier: Array.isArray(aiData.thinking.points_a_verifier) ? aiData.thinking.points_a_verifier : []
  } : null;

  return {
    mode,
    visionConfigured: aiCfg.resolvedProvider !== 'offline',
    aiProvider: aiCfg.resolvedProvider,
    thinking,
    ficheTechnique,
    cadSpec,
    extracted: local,
    disclaimer: 'Validation ingénieur BE obligatoire : inspectez le 3D B-Rep, ajustez les cotes au 0.001 mm si besoin, puis publiez vers l’atelier.'
  };
}

// Local deterministic French CAD prompt interpreter (works even without API key!)
function applyLocalCadPrompt(cadSpec, prompt = '') {
  const next = {
    unit: 'mm',
    name: cadSpec?.name || 'Piece_CNC',
    features: Array.isArray(cadSpec?.features) ? cadSpec.features.map(f => ({ ...f })) : []
  };
  const changes = [];
  const p = String(prompt || '').trim();
  const low = p.toLowerCase();
  const newId = () => `f_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // 1. Delete / remove last feature
  if (/supprim|retire|enl[èe]ve/.test(low)) {
    if (/trou|per[çc]age/.test(low)) {
      const before = next.features.length;
      next.features = next.features.filter(f => f.op !== 'cut_hole_pattern');
      if (next.features.length < before) changes.push('Motif de perçages supprimé');
    } else if (/m[ée]plat/.test(low)) {
      next.features = next.features.filter(f => f.op !== 'cut_flat');
      changes.push('Méplat(s) supprimé(s)');
    } else if (/rainure|encoche/.test(low)) {
      next.features = next.features.filter(f => f.op !== 'cut_slot');
      changes.push('Rainure(s) supprimée(s)');
    } else if (next.features.length > 1) {
      const popped = next.features.pop();
      changes.push(`Fonction supprimée : ${popped.label}`);
    }
  }

  // 2. Add circular hole pattern (e.g. "6 trous Ø10 sur PCD 70 à 38°")
  const holePatternMatch = p.match(/(\d+)\s*(?:trous?|per[çc]ages?|[x×])\s*(?:de\s*)?(?:Ø|ø|D|diam[èe]tre\s*)?(\d+(?:[.,]\d+)?)/i);
  if (holePatternMatch && !/supprim|retire/.test(low)) {
    const count = Math.max(1, Math.min(24, parseInt(holePatternMatch[1], 10)));
    const holeDiameter = parseFloat(holePatternMatch[2].replace(',', '.'));
    const pcdM = p.match(/(?:pcd|entraxe|cercle)\s*(?:de\s*)?(?:Ø|ø|D)?\s*(\d+(?:[.,]\d+)?)/i);
    const angleM = p.match(/(\d+(?:[.,]\d+)?)\s*(?:°|deg)/i);
    const pcd = pcdM ? parseFloat(pcdM[1].replace(',', '.')) : 70;
    const startAngleDeg = angleM ? parseFloat(angleM[1].replace(',', '.')) : 0;
    const axis = next.features[0]?.axis || 'x';
    const depth = (next.features[0]?.length || next.features[0]?.lz || 100) + 12;
    next.features.push({
      id: newId(),
      label: `${count}× Trous Ø${holeDiameter} sur PCD Ø${pcd}`,
      op: 'cut_hole_pattern',
      axis,
      count,
      holeDiameter,
      pcd,
      depth,
      startAngleDeg,
      x: 0, y: 0, z: 0
    });
    changes.push(`Ajouté ${count}× trous Ø${holeDiameter} sur PCD Ø${pcd}`);
  }

  // 3. Add flat / méplat (e.g. "méplat à 114.5" or "2 méplats à 55")
  if (/m[ée]plat|plat\s+lat[ée]ral|face\s+plane/.test(low) && !/supprim|retire/.test(low)) {
    const distM = p.match(/m[ée]plat[^\d]*(\d+(?:[.,]\d+)?)/i) || p.match(/(\d+(?:[.,]\d+)?)\s*mm/i);
    const val = distM ? parseFloat(distM[1].replace(',', '.')) : 55;
    const mainD = next.features.find(f => f.op === 'add_cylinder')?.diameter || 120;
    const distFromCenter = val > mainD * 0.65 ? Math.max(5, Number((val - mainD / 2).toFixed(2))) : val;
    const span = (next.features[0]?.length || 200) + 12;
    next.features.push({
      id: newId(),
      label: `Méplat (${val} mm)`,
      op: 'cut_flat',
      side: '+y',
      distanceFromCenter: distFromCenter,
      span
    });
    if (/2\s*m[ée]plat|double\s*m[ée]plat|oppos[ée]/.test(low)) {
      next.features.push({
        id: newId(),
        label: `Méplat opposé (${val} mm)`,
        op: 'cut_flat',
        side: '-y',
        distanceFromCenter: distFromCenter,
        span
      });
    }
    changes.push(`Ajouté méplat à ${val} mm`);
  }

  // 4. Add central bore / alésage (e.g. "alésage Ø60")
  if (/al[ée]sage|trou\s+central|per[çc]age\s+central/.test(low) && !/supprim|retire/.test(low)) {
    const dM = p.match(/(?:al[ée]sage|central)[^\d]*(?:Ø|ø|D)?\s*(\d+(?:[.,]\d+)?)/i);
    if (dM) {
      const diameter = parseFloat(dM[1].replace(',', '.'));
      const axis = next.features[0]?.axis || 'x';
      const length = (next.features[0]?.length || next.features[0]?.lz || 120) + 12;
      next.features.push({
        id: newId(),
        label: `Alésage Ø${diameter}`,
        op: 'cut_bore',
        axis,
        diameter,
        length,
        x: 0, y: 0, z: 0
      });
      changes.push(`Ajouté alésage Ø${diameter} mm`);
    }
  }

  // 5. Add slot / rainure / encoche (e.g. "rainure 25x30" or "rainure 25 mm")
  if (/rainure|clavette|encoche/.test(low) && !/supprim|retire/.test(low)) {
    const sM = p.match(/(?:rainure|clavette|encoche)[^\d]*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?/i);
    const lx = sM ? parseFloat(sM[1].replace(',', '.')) : 25;
    const depth = sM && sM[2] ? parseFloat(sM[2].replace(',', '.')) : 12;
    const mainD = next.features.find(f => f.op === 'add_cylinder')?.diameter || 100;
    next.features.push({
      id: newId(),
      label: `Rainure ${lx}×${depth} mm`,
      op: 'cut_slot',
      lx,
      ly: mainD + 10,
      lz: depth,
      x: 0, y: 0, z: Math.round(mainD / 2 - depth / 3)
    });
    changes.push(`Ajouté rainure ${lx}×${depth} mm`);
  }

  // 6. Add groove / filetage relief (e.g. "gorge" or "filetage Tr 65x8")
  if (/gorge|filet|tr\s*\d+/.test(low) && !/supprim|retire/.test(low)) {
    const tM = p.match(/(?:tr|filet|gorge)[^\d]*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?/i);
    const d = tM ? parseFloat(tM[1].replace(',', '.')) : 65;
    const pitch = tM && tM[2] ? parseFloat(tM[2].replace(',', '.')) : 8;
    const axis = next.features[0]?.axis || 'x';
    next.features.push({
      id: newId(),
      label: `Gorges/Filet Ø${d} pas ${pitch}`,
      op: 'cut_groove',
      axis,
      outerDiameter: d + 2,
      innerDiameter: Math.max(4, d - 6),
      width: Math.max(2, Number((pitch * 0.45).toFixed(1))),
      pitch,
      count: 6,
      x: 0, y: 0, z: 0
    });
    changes.push(`Ajouté gorges / profil fileté Ø${d} pas ${pitch}`);
  }

  // 7. Add collar / manchon / cylindre (e.g. "ajoute manchon Ø95 L230")
  if (/(?:ajoute|cr[ée]e)[^\n]*(?:cylindre|manchon|[ée]paulement|collerette)/.test(low)) {
    const dM = p.match(/(?:Ø|ø|D|diam[èe]tre\s*)\s*(\d+(?:[.,]\d+)?)/i);
    const lM = p.match(/(?:L|long(?:ueur)?\s*)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
    const diameter = dM ? parseFloat(dM[1].replace(',', '.')) : 95;
    const length = lM ? parseFloat(lM[1].replace(',', '.')) : 230;
    const axis = next.features[0]?.axis || 'x';
    next.features.push({
      id: newId(),
      label: `Manchon Ø${diameter} L${length}`,
      op: 'add_cylinder',
      axis,
      diameter,
      length,
      x: 0, y: 0, z: 0
    });
    changes.push(`Ajouté manchon Ø${diameter} × L${length} mm`);
  }

  // 8. Modify main length or outer diameter (e.g. "change la longueur à 230" or "diamètre extérieur 120")
  if (/change|modifie|passe|mets/.test(low) && next.features[0]) {
    const lM = p.match(/long(?:ueur)?[^\d]*(\d+(?:[.,]\d+)?)/i);
    const dM = p.match(/diam[èe]tre[^\d]*(\d+(?:[.,]\d+)?)/i);
    if (lM) {
      const val = parseFloat(lM[1].replace(',', '.'));
      if (next.features[0].length !== undefined) next.features[0].length = val;
      else if (next.features[0].lx !== undefined) next.features[0].lx = val;
      changes.push(`Longueur principale mise à ${val} mm`);
    }
    if (dM && next.features[0].diameter !== undefined) {
      const val = parseFloat(dM[1].replace(',', '.'));
      next.features[0].diameter = val;
      changes.push(`Diamètre principal mis à Ø${val} mm`);
    }
  }

  return {
    cadSpec: next,
    changesSummary: changes.length > 0
      ? changes.join(' · ')
      : "Instruction enregistrée. Pour les modifications géométriques complexes en langage libre, le Directeur peut configurer une clé IA dans Administration → Configuration IA — ou utilisez des cotes explicites (ex: 'Ajoute 6 trous Ø10 sur PCD 70', 'Ajoute méplat 114.5', 'Ajoute alésage Ø60', 'Ajoute rainure 25x12')."
  };
}

async function refineCadSpecWithAI({ cadSpec, prompt, history = [], planBuffer = null, filename = 'plan', attachments = [], ficheTechnique = null, errorContext = '', visualAudit = false, thinkingMode = 'auto' }) {
  const cleanSpec = sanitizeCadSpec(cadSpec);
  const ext = path.extname(filename || '').toLowerCase();
  const mimeType =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    'image/jpeg';

  const recentHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'Ingénieur BE' : 'Assistant IA BE'} : ${String(m.text || '').slice(0, 450)}`)
    .join('\n');

  const hasVision = (Array.isArray(attachments) && attachments.some(a => a?.base64)) || (planBuffer && Buffer.isBuffer(planBuffer) && planBuffer.length > 0);
  const compactFollowUp = !hasVision && !visualAudit && Boolean(ficheTechnique);
  const useDeepThinking = thinkingMode === 'deep'
    ? true
    : thinkingMode === 'fast'
      ? false
      : (hasVision && !errorContext);

  const machinesCtx = compactFollowUp ? '' : getWorkshopMachinesContext();
  const lockedParams = (cleanSpec.params || []).filter(p => p.confidence === 'locked');
  const lockedNote = lockedParams.length > 0
    ? `🔒 COTES VERROUILLÉES PAR L'INGÉNIEUR BE (NE PAS MODIFIER sauf demande explicite) : ${lockedParams.map(p => `${p.key}=${p.value}${p.unit || 'mm'}`).join(', ')}.\n`
    : '';

  const visualAuditNote = visualAudit
    ? `👁️ MODE CONTRÔLE VISUEL 3D vs PLAN 2D : Tu reçois le PLAN 2D ORIGINAL + le RENDU 3D ACTUEL en 3 vues (FACE / CÔTÉ / ISO). Compare-les impitoyablement ! Repère immédiatement toute inversion de volume (gros corps vs gorge centrale, collerettes vs manchons), toute forme manquante (méplat/profil en D, tenons/ergots, rainures, trous, inserts), et tout écart de proportion — puis produis la Fiche Géométrique ("engine": "assembly", "blueprint": {...}) CORRIGÉE ("modified": true).\n`
    : '';

  const compactRule = compactFollowUp
    ? `⚡ MODE SUIVI RAPIDE : La fiche technique / DFM / gamme CNC existe déjà — NE LA RÉGÉNÈRE PAS (omets "ficheTechnique" et "thinking") ! Retourne UNIQUEMENT "reply" (court, 1-3 phrases), "modified" et le "cadSpec" mis à jour.`
    : `6. Si des images/plans sont joints, extrais ou mets à jour aussi "ficheTechnique" et "thinking" dans la même réponse (0 requête supplémentaire).`;

  const refineInstruction = `Tu es un Ingénieur Bureau d'Études & Méthodes CNC senior, expert en lecture de plans ISO 2D, DFM atelier et CAO B-Rep OpenCASCADE par Fiche Géométrique + Briques d'assemblage.
Tu discutes en français naturel avec l'ingénieur BE pour concevoir, vérifier et modifier n'importe quelle pièce mécanique 3D exacte (exportable en .STEP et .STL, précision 0.001 mm).
Comprends le langage naturel même avec des fautes de frappe ("filtage" = filetage/taraudage, "chanfrin" = chanfrein, "6 pan" = hexagone).
${machinesCtx ? `${machinesCtx}\n` : ''}${lockedNote}${visualAuditNote}
Modèle 3D actuel (JSON cadSpec) :
${JSON.stringify(cleanSpec, null, 2)}

${!compactFollowUp && ficheTechnique ? `Fiche technique actuelle : ${JSON.stringify(ficheTechnique)}` : ''}
${recentHistory ? `Historique récent :\n${recentHistory}\n` : ''}
${errorContext ? `⚠️ ERREUR DE COMPILATION OPENCASCADE À CORRIGER IMMÉDIATEMENT (passe en "engine": "assembly" avec blueprint propre) :\n${errorContext}\n` : ''}
Nouveau message de l'ingénieur BE :
"${prompt}"

RÈGLES D'ACTION STRICTES (1 SEULE REQUÊTE = FICHE GÉOMÉTRIQUE + 3D DIRECT) :
1. PRIORITÉ À L'ACTION : Si l'utilisateur joint une image/plan, lance un contrôle visuel 3D vs Plan, demande de créer ou modifier une pièce, ou confirme ("oui", "ok", "vas-y", "corrige", "fais-le"), TU DOIS PRODUIRE IMMÉDIATEMENT LA FICHE GÉOMÉTRIQUE B-REP COMPLÈTE ("modified": true, "engine": "assembly", "params": [...], "blueprint": { "body": {...}, "features": [...] }) DÈS CE TOUR !
2. LECTURE CROISÉE ANTI-INVERSION & MODÉLISATION COMPLÈTE : Quand une image/plan (ou un zoom) est joint, recoupe TOUTES les vues (face, côté, coupes) pour ne JAMAIS inverser le gros corps principal avec une gorge centrale en creux. IL EST STRICTEMENT INTERDIT d'esquiver une forme visible (méplat / profil en D, gorge extérieure, tenons/manchons d'extrémité, rainures, perçages, inserts) : ajoute chaque brique dans \`blueprint.features\` et expose chaque cote dans \`params\`.
3. CONFIANCE & MÉMOIRE DES COTES : Marque chaque paramètre dans \`params\` avec \`"confidence": "high"\` (lu clairement), \`"check"\` (chiffre flou ou déduit à vérifier par l'ingénieur), ou conserve \`"locked"\` pour toutes les cotes déjà validées/verrouillées par l'ingénieur.
4. Ne mets "modified": false QUE si l'utilisateur pose une pure question théorique / méthodes sans aucune demande de création ou modification 3D.
5. Utilise \`"engine": "assembly"\` + \`"blueprint"\` (briques déterministes 0 bug) par défaut. N'utilise \`"engine": "replicad"\` + \`"code"\` que si la pièce est une forme organique impossible en briques.
${compactRule}

Retourne STRICTEMENT un objet JSON valide (aucun texte hors JSON) :
{
  ${compactFollowUp ? '' : `"thinking": { "vues_et_fonction": string, "cotes_cles": string[], "alertes_dfm": string[], "points_a_verifier": string[] },`}
  "reply": string (réponse claire et concise d'ingénieur BE en français),
  "modified": boolean,
  "cadSpec": {
    "engine": "assembly",
    "unit": "mm",
    "name": string,
    "material": string,
    "params": [
      { "key": string, "label": string, "value": number, "unit": "mm"|"°"|"u", "tolerance"?: string, "confidence": "high"|"check"|"locked", "sourceView"?: string }
    ],
    "blueprint": {
      "body": { "type": "d_profile"|"cylinder"|"revolve"|"box"|"flange"|"polygon", "axis": "x"|"y"|"z", ... },
      "features": [ { "id": string, "type": "boss"|"bore"|"groove_ext"|"groove_int"|"thread"|"hole_pattern"|"hole"|"slot"|"pins"|"chamfer"|"fillet", "label": string, ... } ]
    }
  }${compactFollowUp ? '' : `,
  "ficheTechnique"?: {
    "client": string,
    "reference": string,
    "revision": string,
    "partName": string,
    "material": string,
    "rawStock": string,
    "criticalTolerances": string[],
    "specialNotes": string[],
    "suggestedOperations": [
      { "libelle": string, "typeMachine": "Tournage CNC"|"Fraisage CNC"|"Tournage Manuel"|"Contrôle", "tempsReglageMin": number, "tempsUnitaireMin": number }
    ],
    "summary": string
  }`}
}

${ASSEMBLY_BLUEPRINT_DOC}`;

  const aiCfg = getAiSettings();

  // Merge explicit chat attachments + OF 2D plan buffer ONLY when passed (zero wasted tokens on text-only edits!)
  const visionImages = [];
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a?.base64) visionImages.push({ mimeType: a.mimeType || 'image/png', base64: a.base64 });
    }
  }
  if (planBuffer && Buffer.isBuffer(planBuffer) && planBuffer.length > 0 && visionImages.length < 3) {
    visionImages.push({ mimeType, base64: planBuffer.toString('base64') });
  }

  // When an AI provider IS configured, NEVER silently hide errors behind the offline parser!
  if (aiCfg.resolvedProvider !== 'offline') {
    const resp = await callConfiguredAiRaw({
      promptText: refineInstruction,
      images: visionImages,
      expectJson: true,
      deepThinking: useDeepThinking
    });
    const parsed = resp?.data;
    if (parsed && (parsed.reply || parsed.cadSpec)) {
      const nextSpec = parsed.cadSpec
        ? sanitizeCadSpec({ ...parsed.cadSpec, material: parsed.cadSpec.material || parsed.ficheTechnique?.material || cleanSpec.material || '' }, cleanSpec.name)
        : cleanSpec;
      const modified = parsed.modified !== undefined ? Boolean(parsed.modified) : JSON.stringify(nextSpec) !== JSON.stringify(cleanSpec);
      const reply = String(parsed.reply || parsed.changesSummary || (modified ? 'Modèle 3D B-Rep généré.' : 'Bien reçu.'));
      const thinking = parsed.thinking && typeof parsed.thinking === 'object' ? {
        vues_et_fonction: String(parsed.thinking.vues_et_fonction || ''),
        cotes_cles: Array.isArray(parsed.thinking.cotes_cles) ? parsed.thinking.cotes_cles : [],
        alertes_dfm: Array.isArray(parsed.thinking.alertes_dfm) ? parsed.thinking.alertes_dfm : [],
        points_a_verifier: Array.isArray(parsed.thinking.points_a_verifier) ? parsed.thinking.points_a_verifier : []
      } : null;
      return {
        mode: `${resp.provider}_vision_ai`,
        provider: resp.provider,
        model: resp.model,
        usedVision: hasVision,
        thinking,
        reply,
        modified,
        cadSpec: nextSpec,
        ficheTechnique: parsed.ficheTechnique || null,
        changesSummary: reply
      };
    }
    if (resp?.text && resp.text.trim()) {
      const plain = resp.text.trim();
      return {
        mode: `${resp.provider}_vision_ai`,
        provider: resp.provider,
        model: resp.model,
        usedVision: hasVision,
        thinking: null,
        reply: plain,
        modified: false,
        cadSpec: cleanSpec,
        changesSummary: plain
      };
    }
    throw new Error(`Réponse vide du modèle IA (${aiCfg.resolvedProvider}).`);
  }

  // Only when NO AI key is configured anywhere: local deterministic parser
  const localRes = applyLocalCadPrompt(cleanSpec, prompt);
  const modified = JSON.stringify(localRes.cadSpec) !== JSON.stringify(cleanSpec);
  return {
    mode: 'local_cad_parser',
    usedVision: false,
    thinking: null,
    reply: localRes.changesSummary,
    modified,
    cadSpec: localRes.cadSpec,
    changesSummary: localRes.changesSummary
  };
}

module.exports = {
  analyzePlanDocument,
  refineCadSpecWithAI,
  testAiConnection,
  listAvailableModels,
  extractLocalDimensions,
  buildDefaultCadSpec
};
