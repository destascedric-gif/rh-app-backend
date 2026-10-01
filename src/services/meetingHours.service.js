const db = require('../config/db');
const { toLocalDateString } = require('../utils/date');

// Temps de réunion compté comme travail (réglage de l'entreprise
// « meetings_count_as_work ») : seule la partie d'une réunion qui tombe en
// dehors du temps déjà travaillé ce jour-là (créneau de travail moins ses
// pauses) s'ajoute, pour ne jamais compter deux fois la même minute.
// Même calcul côté écran : frontend-propre/src/components/schedule/meetingUtils.js

const toMin = (t) => {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

// Fusionne des intervalles [début, fin] qui se chevauchent
const merge = (intervals) => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
};

// Retire des intervalles « base » toutes les parties couvertes par « cut »
const subtract = (base, cut) => base.flatMap(([s, e]) => {
  let pieces = [[s, e]];
  for (const [cs, ce] of cut) {
    pieces = pieces.flatMap(([ps, pe]) => {
      if (ce <= ps || cs >= pe) return [[ps, pe]];
      return [[ps, cs], [ce, pe]].filter(([a, b]) => b > a);
    });
  }
  return pieces;
});

const total = (intervals) => intervals.reduce((sum, [s, e]) => sum + (e - s), 0);

// Minutes de réunion hors temps travaillé, pour une journée
const extraMinutesForDay = (meetingIntervals, shift, breaks = []) => {
  if (meetingIntervals.length === 0) return 0;
  const worked = shift && (shift.type || 'travail') === 'travail'
    ? subtract([[toMin(shift.start_time), toMin(shift.end_time)]], breaks.map((b) => [toMin(b.start_time), toMin(b.end_time)]))
    : [];
  return total(subtract(merge(meetingIntervals), worked));
};

// L'entreprise compte-t-elle les réunions dans les heures de travail ?
const meetingsCountAsWork = async (companyId) => {
  const result = await db.query('SELECT meetings_count_as_work FROM company WHERE id = $1', [companyId]);
  return Boolean(result.rows[0]?.meetings_count_as_work);
};

// Heures de réunion à ajouter aux heures planifiées d'un employé sur une
// période (0 si l'entreprise ne compte pas les réunions)
const getMeetingExtraHours = async (userId, companyId, periodStart, periodEnd) => {
  if (!(await meetingsCountAsWork(companyId))) return 0;

  const meetings = (await db.query(
    `SELECT m.date, m.start_time, m.end_time
     FROM meetings m
     JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = $1
     WHERE m.company_id = $2 AND m.date BETWEEN $3 AND $4`,
    [userId, companyId, periodStart, periodEnd]
  )).rows;
  if (meetings.length === 0) return 0;

  const shifts = (await db.query(
    `SELECT id, date, start_time, end_time, type FROM shifts
     WHERE user_id = $1 AND company_id = $2 AND date BETWEEN $3 AND $4`,
    [userId, companyId, periodStart, periodEnd]
  )).rows;
  const breaks = shifts.length === 0 ? [] : (await db.query(
    'SELECT shift_id, start_time, end_time FROM shift_breaks WHERE shift_id = ANY($1)',
    [shifts.map((s) => s.id)]
  )).rows;

  const byDay = {};
  for (const m of meetings) {
    (byDay[toLocalDateString(m.date)] ??= []).push([toMin(m.start_time), toMin(m.end_time)]);
  }

  let minutes = 0;
  for (const [day, intervals] of Object.entries(byDay)) {
    const shift = shifts.find((s) => toLocalDateString(s.date) === day);
    minutes += extraMinutesForDay(intervals, shift, shift ? breaks.filter((b) => b.shift_id === shift.id) : []);
  }
  return minutes / 60;
};

module.exports = { getMeetingExtraHours, extraMinutesForDay };
