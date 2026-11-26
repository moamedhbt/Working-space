// Projection d'affichage des créneaux enregistrés : les segments ne modifient jamais le planning.
function segmentsForOperation(op, settings) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(op.datePlanifiee || '') || !/^\d{2}:\d{2}$/.test(op.debutStr || '')) return [];
  const minutes = t => { const [h,m] = t.split(':').map(Number); return h * 60 + m; };
  const start = minutes(settings.shiftStart || '08:00');
  const end = minutes(settings.shiftEnd || '17:00');
  if (end <= start) return [];
  const days = Array.isArray(settings.workDays) && settings.workDays.length ? settings.workDays : [0,1,2,3,4];
  const date = new Date(op.datePlanifiee + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime())) return [];
  let cursor = Math.max(start, minutes(op.debutStr));
  let remaining = Math.max(0, (Number(op.tempsPrevuMin) || 0) - (Number(op.tempsReelMin) || 0));
  const result = [];
  const hhmm = n => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
  for (let i=0; remaining > 0 && i<730; i++) {
    if (days.includes(date.getUTCDay()) && cursor < end) {
      const length = Math.min(remaining, end-cursor);
      result.push({ date:date.toISOString().slice(0,10), start:hhmm(cursor), end:hhmm(cursor+length) });
      remaining -= length;
    }
    date.setUTCDate(date.getUTCDate()+1); cursor=start;
  }
  return result;
}
module.exports = { segmentsForOperation };
