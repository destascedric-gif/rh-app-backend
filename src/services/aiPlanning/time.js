// ─────────────────────────────────────────────
// PLANNING PAR IA — petits outils de dates et d'heures
// Dates au format 'AAAA-MM-JJ', heures au format 'HH:MM'.
// Calculs en UTC à midi : pas de décalage d'heure d'été.
// ─────────────────────────────────────────────

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 0 = lundi … 6 = dimanche (comme open_days et les semaines types)
const weekdayOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
const mondayOf = (iso) => addDays(iso, -weekdayOf(iso));

const toMin = (t) => {
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m);
};
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const breakMinutes = (slot) => (slot.breaks || [])
  .reduce((sum, b) => sum + Math.max(0, toMin(b.end_time) - toMin(b.start_time)), 0);

// Temps de travail effectif d'une case (pauses déduites), en minutes
const workedMinutes = (slot) => {
  if (!slot || slot.type !== 'travail') return 0;
  return Math.max(0, toMin(slot.endTime) - toMin(slot.startTime) - breakMinutes(slot));
};

// Présent (au travail, hors pause) à la minute m de la journée ?
const isPresentAt = (slot, m) => slot.type === 'travail'
  && toMin(slot.startTime) <= m && m < toMin(slot.endTime)
  && !(slot.breaks || []).some((b) => toMin(b.start_time) <= m && m < toMin(b.end_time));

// Heures en français : 7,5 h ; 35 h
const formatHours = (minutes) => {
  const h = Math.round((minutes / 60) * 100) / 100;
  return `${String(h).replace('.', ',')} h`;
};

module.exports = {
  DAY_NAMES, addDays, weekdayOf, mondayOf, toMin, fromMin, breakMinutes,
  workedMinutes, isPresentAt, formatHours,
};
