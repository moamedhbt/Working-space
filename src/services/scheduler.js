const PRIO_RANK = { Critique: 1, Urgent: 2, Normal: 3 };

function timeToMin(str, fallback = 480) {
  if (!str || !str.includes(':')) return fallback;
  const [h, m] = str.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return h * 60 + m;
}

function minToTime(totalMin) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMin)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDateYMD(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function nextWorkDay(dateObj, workDays) {
  const d = new Date(dateObj.getTime());
  const valid = Array.isArray(workDays) && workDays.length > 0 ? workDays : [0, 1, 2, 3, 4];
  for (let i = 0; i < 14; i++) {
    if (valid.includes(d.getUTCDay())) return d;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

function addWorkingSlots(startDayOffset, startMinInShift, durationMin, shiftLenMin, workDays) {
  let dayIdx = startDayOffset;
  let cursor = startMinInShift;
  let remaining = Math.max(5, durationMin);

  if (cursor >= shiftLenMin) {
    dayIdx += 1;
    cursor = 0;
  }
  const beginDay = dayIdx;
  const beginMin = cursor;

  while (remaining > 0) {
    const avail = shiftLenMin - cursor;
    if (remaining <= avail) {
      cursor += remaining;
      remaining = 0;
    } else {
      remaining -= avail;
      dayIdx += 1;
      cursor = 0;
    }
  }

  // Map logical working day indices to actual calendar dates skipping non-workDays
  const base = nextWorkDay(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), workDays);
  const dateForWorkDay = idx => {
    let cur = new Date(base.getTime());
    for (let step = 0; step < idx; step++) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      cur = nextWorkDay(cur, workDays);
    }
    return formatDateYMD(cur);
  };

  return {
    beginDay,
    beginMin,
    endDay: dayIdx,
    endMin: cursor,
    beginDate: dateForWorkDay(beginDay),
    endDate: dateForWorkDay(dayIdx)
  };
}

function slotToAbs(dayIdx, minInShift, shiftLenMin) {
  return dayIdx * shiftLenMin + minInShift;
}

function absToSlot(absMin, shiftLenMin) {
  const dayIdx = Math.floor(absMin / shiftLenMin);
  const minInShift = absMin % shiftLenMin;
  return { dayIdx, minInShift };
}

function analyzeScheduleAndAI(pieces, machines, users, pannes, settings) {
  const workDays = settings?.workDays || [0, 1, 2, 3, 4];
  const shiftStartMin = timeToMin(settings?.shiftStart || '08:00', 480);
  const shiftEndMin = timeToMin(settings?.shiftEnd || '17:00', 1020);
  const shiftLenMin = Math.max(120, shiftEndMin - shiftStartMin);
  const today = new Date().toISOString().slice(0, 10);

  const activeMachines = machines.filter(m => m.actif);
  const machineById = new Map(machines.map(m => [m.id, m]));
  const activeOperators = users.filter(u => u.role === 'operateur' && u.actif !== 0);

  const openPieces = [...pieces]
    .filter(p => p.statut !== 'Clôturé')
    .sort((a, b) => (a.ordrePlanning || 999) - (b.ordrePlanning || 999));

  const machineCursorAbs = {};
  activeMachines.forEach(m => { machineCursorAbs[m.id] = 0; });

  const scheduledOps = [];
  const conflicts = [];
  const operatorIntervals = []; // { operateurId, operateur, opId, pieceId, machine, startAbs, endAbs, date, debutStr, finStr }

  for (const p of openPieces) {
    if (!p.chuteDispo && !p.achatFait) {
      conflicts.push({
        type: 'matiere_manquante',
        severity: 'high',
        pieceId: p.id,
        text: `Matière manquante sur ${p.id} (${p.nom}) — Achat requis chez ${p.fournisseur || 'fournisseur'}`
      });
    }

    let prevOpEndAbs = 0;
    const ops = [...(p.operations || [])].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.statut === 'Terminée') continue;

      const dur = Math.max(5, (op.tempsPrevuMin || 60) - (op.tempsReelMin || 0));

      // Check manual precedence violation if user explicitly set debutStr earlier than previous op's finStr
      if (i > 0 && op.debutStr && ops[i - 1].finStr && ops[i - 1].statut !== 'Terminée') {
        const curStart = timeToMin(op.debutStr, 0);
        const prevEnd = timeToMin(ops[i - 1].finStr, 0);
        if (curStart > 0 && prevEnd > 0 && curStart < prevEnd && (!op.datePlanifiee || op.datePlanifiee === ops[i - 1].datePlanifiee)) {
          conflicts.push({
            type: 'conflit_precedence',
            severity: 'high',
            pieceId: p.id,
            operationId: op.id,
            text: `Conflit gamme sur ${p.id} : "${op.libelle}" démarre (${op.debutStr}) avant la fin de "${ops[i - 1].libelle}" (${ops[i - 1].finStr})`
          });
        }
      }

      if (op.estSousTraitance) {
        // Subcontracting step doesn't consume internal machine capacity; defaults to 1 working day lead time
        const startAbs = prevOpEndAbs;
        const endAbs = startAbs + shiftLenMin;
        const slot = addWorkingSlots(absToSlot(startAbs, shiftLenMin).dayIdx, absToSlot(startAbs, shiftLenMin).minInShift, shiftLenMin, shiftLenMin, workDays);
        prevOpEndAbs = endAbs;
        scheduledOps.push({
          opId: op.id,
          pieceId: p.id,
          libelle: op.libelle,
          estSousTraitance: true,
          sousTraitant: op.sousTraitant || 'Sous-traitant',
          datePlanifiee: op.dateEnvoi || slot.beginDate,
          dateRetourPrevue: op.dateRetourPrevue || slot.endDate,
          debutStr: minToTime(shiftStartMin),
          finStr: minToTime(shiftEndMin),
          startAbs,
          endAbs
        });
        continue;
      }

      const mach = machineById.get(op.machineId);
      if (mach && mach.enPanne) {
        conflicts.push({
          type: 'machine_panne',
          severity: 'high',
          pieceId: p.id,
          operationId: op.id,
          machineId: mach.id,
          text: `Machine en panne : ${mach.nom} bloque ${p.id} (${op.libelle})`
        });
      }

      const machAvailAbs = op.machineId ? (machineCursorAbs[op.machineId] || 0) : 0;
      const startAbs = Math.max(machAvailAbs, prevOpEndAbs);
      const startSlot = absToSlot(startAbs, shiftLenMin);
      const res = addWorkingSlots(startSlot.dayIdx, startSlot.minInShift, dur, shiftLenMin, workDays);
      const endAbs = slotToAbs(res.endDay, res.endMin, shiftLenMin);

      if (op.machineId) {
        machineCursorAbs[op.machineId] = endAbs;
      }
      prevOpEndAbs = endAbs;

      const debutStr = minToTime(shiftStartMin + res.beginMin);
      const finStr = minToTime(shiftStartMin + (res.endMin === 0 ? shiftLenMin : res.endMin));

      scheduledOps.push({
        opId: op.id,
        pieceId: p.id,
        libelle: op.libelle,
        machineId: op.machineId,
        machine: op.machine,
        operateurId: op.operateurId,
        operateur: op.operateur,
        tempsPrevuMin: op.tempsPrevuMin,
        tempsReglageMin: op.tempsReglageMin || 0,
        datePlanifiee: res.beginDate,
        endDate: res.endDate,
        debutStr,
        finStr,
        startAbs,
        endAbs
      });

      if (op.operateurId) {
        operatorIntervals.push({
          operateurId: op.operateurId,
          operateur: op.operateur,
          opId: op.id,
          pieceId: p.id,
          libelle: op.libelle,
          machineId: op.machineId,
          machine: op.machine,
          startAbs,
          endAbs,
          date: res.beginDate,
          debutStr,
          finStr
        });
      }
    }

    // Deadline risk check
    const lastOpSched = [...scheduledOps].reverse().find(s => s.pieceId === p.id);
    if (p.delai && (p.delai < today || (lastOpSched && lastOpSched.endDate > p.delai))) {
      conflicts.push({
        type: 'retard_delai',
        severity: p.urgence === 'Critique' ? 'high' : 'medium',
        pieceId: p.id,
        text: `Risque de retard sur ${p.id} (${p.nom}) : fin estimée ${lastOpSched?.endDate || '—'} pour délai ${p.delai}`
      });
    }
  }

  // Un opérateur peut surveiller plusieurs machines simultanément dans cet atelier.
  // Sans données de présence/temps de surveillance, un chevauchement n'est pas un conflit.
  const opConflictPairs = [];

  // Machine daily overload & preventive maintenance checks
  const machineLoads = {};
  activeMachines.forEach(m => {
    const loadMin = machineCursorAbs[m.id] || 0;
    machineLoads[m.nom] = loadMin;
    const cap = m.capaciteJourMin || 480;
    if (loadMin > cap) {
      conflicts.push({
        type: 'surcharge_machine',
        severity: 'medium',
        machineId: m.id,
        text: `Surcharge ${m.nom} : ${(loadMin / 60).toFixed(1)}h planifiées pour ${(cap / 60).toFixed(0)}h/jour`
      });
    }
    const sinceLast = (m.heuresCompteur || 0) - (m.dernierEntretienH || 0);
    const inter = m.intervalleEntretienH || 200;
    if (sinceLast >= inter) {
      conflicts.push({
        type: 'entretien_du',
        severity: 'high',
        machineId: m.id,
        text: `Maintenance préventive DÉPASSÉE sur ${m.nom} (${sinceLast.toFixed(0)}h / ${inter}h)`
      });
    } else if (sinceLast >= inter * 0.85) {
      conflicts.push({
        type: 'entretien_du',
        severity: 'medium',
        machineId: m.id,
        text: `Maintenance préventive proche sur ${m.nom} (${sinceLast.toFixed(0)}h / ${inter}h)`
      });
    }
  });

  // --- ACTIONABLE IA RECOMMENDATIONS ---
  const aiRecommendations = [];

  // 1. Reassign ops off broken-down machines
  for (const c of conflicts.filter(x => x.type === 'machine_panne')) {
    const brokenMach = machineById.get(c.machineId);
    const altMach = activeMachines
      .filter(m => m.id !== c.machineId && !m.enPanne && brokenMach?.type && m.type === brokenMach.type)
      .sort((a, b) => {
        const sameTypeA = brokenMach && a.type === brokenMach.type ? 0 : 1;
        const sameTypeB = brokenMach && b.type === brokenMach.type ? 0 : 1;
        return sameTypeA - sameTypeB || (machineCursorAbs[a.id] || 0) - (machineCursorAbs[b.id] || 0);
      })[0];
    if (altMach) {
      aiRecommendations.push({
        id: `ai_panne_${c.operationId}`,
        severity: 'high',
        title: `Contourner la panne ${brokenMach?.nom || ''}`,
        reason: `Proposer ${altMach.nom} (même type). Vérifier dimensions, commande, outils et disponibilité avant affectation.`,
        actionType: 'reassign_machine',
        payload: { operationId: c.operationId, machineId: altMach.id }
      });
    }
  }

  // 2. Resolve operator overlap conflict
  for (const [, b] of opConflictPairs.slice(0, 3)) {
    const busyOpIds = new Set(
      operatorIntervals
        .filter(iv => iv.startAbs < b.endAbs && b.startAbs < iv.endAbs)
        .map(iv => iv.operateurId)
    );
    const freeOp = activeOperators.find(o => !busyOpIds.has(o.id));
    if (freeOp) {
      aiRecommendations.push({
        id: `ai_op_${b.opId}`,
        severity: 'high',
        title: `Résoudre conflit opérateur (${b.operateur})`,
        reason: `Affecter ${freeOp.nom} (libre sur ce créneau) à ${b.pieceId} · ${b.libelle} sur ${b.machine}.`,
        actionType: 'reassign_operator',
        payload: { operationId: b.opId, operateurId: freeOp.id }
      });
    }
  }

  // 3. Reorder blocked vs ready urgent OFs
  const blockedBeforeReady = openPieces.findIndex(p => !p.chuteDispo && !p.achatFait);
  const readyAfterBlocked = blockedBeforeReady >= 0
    ? openPieces.slice(blockedBeforeReady + 1).find(p => (p.chuteDispo || p.achatFait) && p.statut !== 'À clôturer')
    : null;
  if (readyAfterBlocked) {
    const blockedP = openPieces[blockedBeforeReady];
    aiRecommendations.push({
      id: `ai_order_${readyAfterBlocked.id}`,
      severity: 'medium',
      title: `Débloquer l'atelier : avancer ${readyAfterBlocked.id}`,
      reason: `${blockedP.id} attend sa matière ; faire passer ${readyAfterBlocked.id} (${readyAfterBlocked.urgence}) en priorité + recalculer les créneaux.`,
      actionType: 'auto_optimize',
      payload: {}
    });
  }

  // 4. Balance overloaded machine to lighter compatible machine
  for (const c of conflicts.filter(x => x.type === 'surcharge_machine')) {
    const overMach = machineById.get(c.machineId);
    const candidateOp = scheduledOps.find(s => s.machineId === c.machineId && !s.estSousTraitance);
    const lighterMach = activeMachines
      .filter(m => m.id !== c.machineId && !m.enPanne && overMach?.type && m.type === overMach.type && (machineCursorAbs[m.id] || 0) < (m.capaciteJourMin || 480) * 0.75)
      .sort((a, b) => (machineCursorAbs[a.id] || 0) - (machineCursorAbs[b.id] || 0))[0];
    if (candidateOp && lighterMach && overMach) {
      aiRecommendations.push({
        id: `ai_bal_${candidateOp.opId}`,
        severity: 'medium',
        title: `Équilibrer la surcharge de ${overMach.nom}`,
        reason: `Proposer ${lighterMach.nom} (même type) pour ${candidateOp.pieceId}. Vérifier les capacités et l’outillage avant affectation.`,
        actionType: 'reassign_machine',
        payload: { operationId: candidateOp.opId, machineId: lighterMach.id }
      });
    }
  }

  // 5. Always offer smart precedence + calendar alignment if precedence conflict exists
  if (conflicts.some(c => c.type === 'conflit_precedence') || aiRecommendations.length === 0) {
    aiRecommendations.push({
      id: 'ai_align_calendar',
      severity: 'low',
      title: 'Optimiser l’ordonnancement multi-opérations (IA)',
      reason: 'Aligner automatiquement toutes les opérations (Op 10 → Op 20) selon les priorités, délais et jours ouvrés de l’atelier.',
      actionType: 'auto_optimize',
      payload: {}
    });
  }

  // --- REAL WORKSHOP ANALYTICS (TRS, QUALITY, SETUP RATIO, PREVENTIVE MAINTENANCE) ---
  const allOps = pieces.flatMap(p => (p.operations || []).map(o => ({ ...o, piece: p })));
  const totalPrevuMin = allOps.reduce((s, o) => s + (o.tempsPrevuMin || 0), 0);
  const totalReelMin = allOps.reduce((s, o) => s + (o.tempsReelMin || 0), 0);
  const totalReglageMin = allOps.reduce((s, o) => s + (o.tempsReglageMin || 0), 0);
  const totalUsinageMin = Math.max(0, totalPrevuMin - totalReglageMin);
  const setupRatioPct = totalPrevuMin > 0 ? Math.round((totalReglageMin / totalPrevuMin) * 100) : 0;

  const totalBonnes = allOps.reduce((s, o) => s + (o.quantiteBonne || 0), 0);
  const totalRebuts = allOps.reduce((s, o) => s + (o.quantiteRebut || 0), 0);
  const totalProduites = totalBonnes + totalRebuts;
  const qualitePct = totalProduites > 0 ? Math.round((totalBonnes / totalProduites) * 100) : 100;
  const tauxRebutPct = totalProduites > 0 ? Number(((totalRebuts / totalProduites) * 100).toFixed(1)) : 0;

  const totalArretPanneMin = (pannes || []).reduce((s, pa) => {
    if (pa.statut === 'Ouverte' && pa.createdAtMs > 0) {
      return s + Math.max(1, Math.round((Date.now() - pa.createdAtMs) / 60000));
    }
    return s + (pa.dureeArretMin || 0);
  }, 0);

  const totalCapacityMin = Math.max(480, activeMachines.reduce((s, m) => s + (m.capaciteJourMin || 480), 0));
  const disponibilitePct = Math.max(0, Math.min(100, Math.round(((totalCapacityMin - totalArretPanneMin) / totalCapacityMin) * 100)));

  const opsWithReal = allOps.filter(o => o.tempsReelMin > 0 && o.tempsPrevuMin > 0);
  const prevuForReal = opsWithReal.reduce((s, o) => s + o.tempsPrevuMin, 0);
  const reelForReal = opsWithReal.reduce((s, o) => s + o.tempsReelMin, 0);
  const performancePct = reelForReal > 0 ? Math.min(100, Math.round((prevuForReal / reelForReal) * 100)) : 100;
  const trsPct = Math.round((disponibilitePct * performancePct * qualitePct) / 10000);

  const machineStats = machines.map(m => {
    const mOps = allOps.filter(o => o.machineId === m.id);
    const mOpenOps = mOps.filter(o => o.statut !== 'Terminée' && o.piece.statut !== 'Clôturé');
    const chargeMin = mOpenOps.reduce((s, o) => s + (o.tempsPrevuMin || 0), 0);
    const prevuMin = mOps.reduce((s, o) => s + (o.tempsPrevuMin || 0), 0);
    const reelMin = mOps.reduce((s, o) => s + (o.tempsReelMin || 0), 0);
    const reglageMin = mOps.reduce((s, o) => s + (o.tempsReglageMin || 0), 0);
    const bonnes = mOps.reduce((s, o) => s + (o.quantiteBonne || 0), 0);
    const rebuts = mOps.reduce((s, o) => s + (o.quantiteRebut || 0), 0);
    const mPannes = (pannes || []).filter(pa => pa.machineId === m.id);
    const arretMin = mPannes.reduce((s, pa) => s + (pa.dureeArretMin || 0), 0);
    const cap = m.capaciteJourMin || 480;
    const utilisationPct = Math.min(150, Math.round((chargeMin / cap) * 100));

    const heuresDepuisEntretien = Number(((m.heuresCompteur || 0) - (m.dernierEntretienH || 0)).toFixed(1));
    const intervalle = m.intervalleEntretienH || 200;
    const resteAvantEntretienH = Number((intervalle - heuresDepuisEntretien).toFixed(1));
    const maintenanceStatut =
      heuresDepuisEntretien >= intervalle ? 'du' :
      heuresDepuisEntretien >= intervalle * 0.85 ? 'proche' : 'ok';

    return {
      id: m.id,
      nom: m.nom,
      type: m.type,
      actif: !!m.actif,
      enPanne: !!m.enPanne,
      chargeMin,
      capaciteJourMin: cap,
      utilisationPct,
      prevuMin,
      reelMin,
      reglageMin,
      ecartMin: reelMin - prevuMin,
      bonnes,
      rebuts,
      tauxRebutPct: bonnes + rebuts > 0 ? Number(((rebuts / (bonnes + rebuts)) * 100).toFixed(1)) : 0,
      nbPannes: mPannes.length,
      arretMin,
      heuresCompteur: Number((m.heuresCompteur || 0).toFixed(1)),
      intervalleEntretienH: intervalle,
      heuresDepuisEntretien,
      resteAvantEntretienH,
      dernierEntretienDate: m.dernierEntretienDate || '—',
      maintenanceStatut
    };
  });

  const operatorStats = users
    .filter(u => u.role === 'operateur')
    .map(u => {
      const uOps = allOps.filter(o => o.operateurId === u.id);
      const bonnes = uOps.reduce((s, o) => s + (o.quantiteBonne || 0), 0);
      const rebuts = uOps.reduce((s, o) => s + (o.quantiteRebut || 0), 0);
      const prevuMin = uOps.reduce((s, o) => s + (o.tempsPrevuMin || 0), 0);
      const reelMin = uOps.reduce((s, o) => s + (o.tempsReelMin || 0), 0);
      const activeOps = uOps.filter(o => o.statut !== 'Terminée' && o.piece.statut !== 'Clôturé').length;
      return {
        id: u.id,
        nom: u.nom,
        actif: u.actif !== 0,
        nbOps: uOps.length,
        activeOps,
        bonnes,
        rebuts,
        tauxRebutPct: bonnes + rebuts > 0 ? Number(((rebuts / (bonnes + rebuts)) * 100).toFixed(1)) : 0,
        prevuMin,
        reelMin,
        ecartMin: reelMin - prevuMin
      };
    });

  // IA Direction Insights
  const aiInsights = [];
  const dueMaint = machineStats.filter(m => m.maintenanceStatut !== 'ok');
  if (dueMaint.length > 0) {
    aiInsights.push({
      level: dueMaint.some(m => m.maintenanceStatut === 'du') ? 'danger' : 'warn',
      text: `Entretien préventif requis sur ${dueMaint.map(m => `${m.nom} (${m.heuresDepuisEntretien}h/${m.intervalleEntretienH}h)`).join(', ')}.`
    });
  }
  if (opConflictPairs.length > 0) {
    aiInsights.push({
      level: 'danger',
      text: `${opConflictPairs.length} conflit(s) d'opérateur simultané(s) détecté(s) dans le planning.`
    });
  }
  if (setupRatioPct >= 25) {
    aiInsights.push({
      level: 'info',
      text: `Temps de réglage élevé (${setupRatioPct}% du temps prévu) — regrouper les séries similaires réduirait les changements d'outils.`
    });
  }
  if (tauxRebutPct >= 2) {
    aiInsights.push({
      level: 'warn',
      text: `Taux de rebut global de ${tauxRebutPct}% (${totalRebuts} pièce(s) NC) — vérifier les gammes concernées.`
    });
  }
  if (aiInsights.length === 0) {
    aiInsights.push({
      level: 'ok',
      text: `TRS estimé ${trsPct}% selon les données enregistrées. Consultez le planning pour les contraintes.`
    });
  }

  return {
    scheduledOps,
    conflicts,
    machineLoads,
    aiRecommendations,
    analytics: {
      trsPct,
      disponibilitePct,
      performancePct,
      qualitePct,
      tauxRebutPct,
      totalBonnes,
      totalRebuts,
      totalPrevuMin,
      totalReelMin,
      totalReglageMin,
      totalUsinageMin,
      setupRatioPct,
      totalArretPanneMin,
      machineStats,
      operatorStats,
      aiInsights
    }
  };
}

function tokenize(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 3 && !['pour', 'avec', 'piece', 'standard', 'client'].includes(w));
}

function estimateNewOfAI(payload, pieces, machines, settings) {
  const qty = Math.max(1, Number(payload.quantitePrevue) || 1);
  const typeReq = String(payload.typeMachine || '').trim().toLowerCase();
  const nomTokens = tokenize(payload.nom || '');
  const matTokens = tokenize(payload.matiere || '');

  // Filter candidate machines by type or requested machineId
  const activeMachines = (machines || []).filter(m => m.actif);
  let matchingMachines = activeMachines.filter(m => !m.enPanne);
  if (payload.machineId) {
    const exact = activeMachines.find(m => m.id === payload.machineId);
    if (exact) matchingMachines = [exact, ...matchingMachines.filter(m => m.id !== exact.id)];
  } else if (typeReq) {
    const byType = matchingMachines.filter(m => (m.type || '').toLowerCase().includes(typeReq));
    if (byType.length > 0) matchingMachines = byType;
  }
  if (matchingMachines.length === 0) matchingMachines = activeMachines;

  // Compute current active load (minutes) per machine
  const loadByMachine = new Map();
  for (const m of activeMachines) loadByMachine.set(m.id, 0);
  for (const p of pieces) {
    if (p.statut === 'Clôturé' || p.statut === 'Refusé' || p.archived) continue;
    for (const o of (p.operations || [])) {
      if (o.estSousTraitance || o.statut === 'Terminée' || !o.machineId) continue;
      loadByMachine.set(o.machineId, (loadByMachine.get(o.machineId) || 0) + (o.tempsPrevuMin || 60));
    }
  }

  // Pick recommended machine (if user explicitly selected machineId, keep it; else pick least loaded matching machine)
  let recommendedMachine = payload.machineId
    ? activeMachines.find(m => m.id === payload.machineId)
    : [...matchingMachines].sort((a, b) => (loadByMachine.get(a.id) || 0) - (loadByMachine.get(b.id) || 0))[0];
  if (!recommendedMachine) recommendedMachine = activeMachines[0] || null;

  // Search historical pieces for similarity
  const scored = [];
  for (const p of pieces) {
    if (p.statut === 'Refusé') continue;
    const pTokens = tokenize(p.nom || '');
    const pMatTokens = tokenize(p.matiere || '');
    let score = 0;
    for (const t of nomTokens) {
      if (pTokens.includes(t)) score += 3;
      else if (pTokens.some(pt => pt.includes(t) || t.includes(pt))) score += 1.5;
    }
    for (const mt of matTokens) {
      if (pMatTokens.includes(mt)) score += 1.5;
    }
    const pType = (p.machineType || p.typeMachine || '').toLowerCase();
    if (typeReq && pType.includes(typeReq)) score += 2;
    else if (recommendedMachine && p.machineId === recommendedMachine.id) score += 1;

    // Bonus if piece has real finished production times!
    const hasReal = (p.tempsReelMin || 0) > 0 && (p.statut === 'Clôturé' || p.statut === 'À clôturer' || p.opsTerminees > 0);
    if (score >= 2 || (nomTokens.length === 0 && typeReq && pType.includes(typeReq))) {
      scored.push({ piece: p, score: score + (hasReal ? 1.5 : 0), hasReal });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const topSimilar = scored.slice(0, 3);

  let tempsReglageMin = 20;
  let tempsUnitaireMin = 6;
  let confidence = 'Standard';

  if (topSimilar.length > 0) {
    let regSum = 0;
    let unitSum = 0;
    let count = 0;
    for (const item of topSimilar) {
      const p = item.piece;
      const ops = (p.operations || []).filter(o => !o.estSousTraitance);
      const reg = ops.reduce((s, o) => s + (o.tempsReglageMin || 0), 0) || 20;
      const pQty = Math.max(1, p.quantitePrevue || 1);
      const effectiveTotal = item.hasReal && p.tempsReelMin > 0 ? p.tempsReelMin : (p.tempsPrevuMin || 90);
      const unit = Math.max(1, Number(((Math.max(10, effectiveTotal - reg)) / pQty).toFixed(1)));
      regSum += reg;
      unitSum += unit;
      count++;
    }
    tempsReglageMin = Math.round(regSum / count);
    tempsUnitaireMin = Number((unitSum / count).toFixed(1));
    confidence = topSimilar.some(s => s.hasReal) ? 'Élevée (temps réels)' : 'Moyenne (historique)';
  } else {
    if (typeReq.includes('fraisage')) { tempsReglageMin = 30; tempsUnitaireMin = 8; }
    else if (typeReq.includes('tournage cnc')) { tempsReglageMin = 25; tempsUnitaireMin = 6; }
    else if (typeReq.includes('manuel') || typeReq.includes('conventionnel')) { tempsReglageMin = 15; tempsUnitaireMin = 5; }
    else if (typeReq.includes('contr')) { tempsReglageMin = 10; tempsUnitaireMin = 2; }
  }

  const totalMin = Math.max(10, Math.round(tempsReglageMin + tempsUnitaireMin * qty));
  const totalHours = Number((totalMin / 60).toFixed(1));

  // Project completion date on recommended machine using workshop calendar
  const shiftStartMin = timeToMin(settings?.shiftStart || '08:00', 480);
  const shiftEndMin = timeToMin(settings?.shiftEnd || '17:00', 1020);
  const shiftDur = Math.max(60, shiftEndMin - shiftStartMin);
  const workDays = Array.isArray(settings?.workDays) && settings.workDays.length > 0 ? settings.workDays : [0, 1, 2, 3, 4];

  const existingLoadMin = recommendedMachine ? (loadByMachine.get(recommendedMachine.id) || 0) : 0;
  const totalDaysNeeded = Math.max(1, Math.ceil((existingLoadMin + totalMin) / shiftDur));

  const cursor = new Date();
  let counted = 0;
  let guard = 0;
  while (counted < totalDaysNeeded && guard < 90) {
    if (workDays.includes(cursor.getDay())) counted++;
    if (counted < totalDaysNeeded) cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  const projectedEndDate = cursor.toISOString().slice(0, 10);
  const delai = payload.delai || '';
  const deadlineOk = !delai || projectedEndDate <= delai;

  const similarList = topSimilar.map(s => ({
    id: s.piece.id,
    nom: s.piece.nom,
    quantitePrevue: s.piece.quantitePrevue,
    tempsReelMin: s.piece.tempsReelMin,
    tempsPrevuMin: s.piece.tempsPrevuMin
  }));

  const message = topSimilar.length > 0
    ? `Estimé à ${totalHours}h (${tempsReglageMin}m régl. + ${tempsUnitaireMin}m/pc) basé sur ${topSimilar.length} pièce(s) similaire(s). Fin prévue le ${projectedEndDate} sur ${recommendedMachine?.nom || 'atelier'}.`
    : `Aucune pièce similaire en historique — estimation standard ${totalHours}h (${tempsReglageMin}m régl. + ${tempsUnitaireMin}m/pc). Fin prévue le ${projectedEndDate} sur ${recommendedMachine?.nom || 'atelier'}.`;

  return {
    recommendedMachineId: recommendedMachine?.id || '',
    recommendedMachineNom: recommendedMachine?.nom || 'À affecter',
    existingLoadHours: Number((existingLoadMin / 60).toFixed(1)),
    tempsReglageMin,
    tempsUnitaireMin,
    totalMin,
    totalHours,
    projectedEndDate,
    deadlineOk,
    confidence,
    similarPieces: similarList,
    message
  };
}

module.exports = {
  PRIO_RANK,
  timeToMin,
  minToTime,
  analyzeScheduleAndAI,
  estimateNewOfAI
};
