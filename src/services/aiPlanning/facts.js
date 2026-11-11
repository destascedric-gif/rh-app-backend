// ─────────────────────────────────────────────
// PLANNING PAR IA — les faits rassemblés avant d'appeler l'IA (sans IA)
// Lecture seule : contrats, postes, jours fermés et fériés, horaires types,
// cases déjà posées, historique et habitudes (habits.js).
// ─────────────────────────────────────────────
const { getFrenchHolidays } = require('../leaves.service');
const { toLocalDateString } = require('../../utils/date');
const { addDays, weekdayOf, mondayOf } = require('./time');
const { computeHabits } = require('./habits');

const HISTORY_WEEKS = 8;
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// Cases (créneaux, repos, congés, absences) d'une entreprise entre deux dates
const readSlots = async (q, companyId, from, to) => {
  const shifts = (await q.query(
    `SELECT s.id, s.user_id, s.date, s.start_time, s.end_time, COALESCE(s.type, 'travail') AS type
     FROM shifts s
     WHERE s.company_id = $1 AND s.date BETWEEN $2::date AND $3::date
     ORDER BY s.date`,
    [companyId, from, to]
  )).rows;
  if (shifts.length === 0) return [];
  const breaks = (await q.query(
    'SELECT shift_id, start_time, end_time, label FROM shift_breaks WHERE shift_id = ANY($1) ORDER BY start_time',
    [shifts.map((s) => s.id)]
  )).rows;
  return shifts.map((s) => ({
    userId: s.user_id,
    date: toLocalDateString(s.date),
    type: s.type,
    startTime: hhmm(s.start_time),
    endTime: hhmm(s.end_time),
    breaks: breaks.filter((b) => b.shift_id === s.id)
      .map((b) => ({ start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), label: b.label || 'Pause' })),
  }));
};

/**
 * Faits pour générer le mois `month` (1-12) de `year`.
 * @param q  objet avec .query (le pool, ou un client en lecture seule pour les essais)
 */
const gatherFacts = async (q, companyId, { year, month }) => {
  const company = (await q.query(
    `SELECT id, name, COALESCE(open_days, '1111100') AS open_days,
            COALESCE(manager_in_schedule, FALSE) AS manager_in_schedule,
            COALESCE(pentecost_monday_worked, FALSE) AS pentecost_monday_worked
     FROM company WHERE id = $1`,
    [companyId]
  )).rows[0];
  if (!company) throw new Error('Entreprise introuvable.');

  // Personnes à planifier : salariés actifs, et le gérant s'il figure dans le planning
  const employees = (await q.query(
    `SELECT id, first_name, role, NULLIF(TRIM(job_title), '') AS job_title, weekly_hours, work_time
     FROM users
     WHERE company_id = $1 AND is_active = TRUE
       AND (role = 'employee' OR ($2 AND role = 'admin'))
     ORDER BY role DESC, first_name`,
    [companyId, company.manager_in_schedule]
  )).rows.map((u) => ({
    id: u.id,
    firstName: u.first_name,
    jobTitle: u.job_title || (u.role === 'admin' ? 'Gérant' : null),
    weeklyHours: u.weekly_hours == null ? null : Number(u.weekly_hours),
    workTime: u.work_time,
    isManager: u.role === 'admin',
  }));

  const templates = (await q.query(
    'SELECT name, start_time, end_time, break_start, break_end FROM shift_templates WHERE company_id = $1 ORDER BY start_time',
    [companyId]
  )).rows.map((t) => ({
    name: t.name,
    startTime: hhmm(t.start_time),
    endTime: hhmm(t.end_time),
    breakStart: hhmm(t.break_start),
    breakEnd: hhmm(t.break_end),
  }));

  // Période à générer : semaines entières (lundi → dimanche) qui couvrent le mois
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`, -1);
  const rangeStart = mondayOf(first);
  const rangeEnd = addDays(mondayOf(last), 6);
  const historyStart = addDays(rangeStart, -7 * HISTORY_WEEKS);
  const historyEnd = addDays(rangeStart, -1);

  const years = new Set([historyStart, rangeEnd].map((d) => Number(d.slice(0, 4))));
  const holidays = new Set();
  years.forEach((y) => getFrenchHolidays(y, { pentecostMondayWorked: company.pentecost_monday_worked })
    .forEach((d) => holidays.add(d)));

  const allSlots = await readSlots(q, companyId, historyStart, rangeEnd);
  const known = new Set(employees.map((e) => e.id));
  const slots = allSlots.filter((s) => known.has(s.userId));
  const history = slots.filter((s) => s.date <= historyEnd);
  const existing = slots.filter((s) => s.date >= rangeStart);

  const days = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
    days.push({
      date: d,
      weekday: weekdayOf(d),
      inMonth: d >= first && d <= last,
      open: company.open_days[weekdayOf(d)] === '1',
      holiday: holidays.has(d),
    });
  }

  const weeks = [];
  for (let w = historyStart; w <= historyEnd; w = addDays(w, 7)) weeks.push(w);

  // Règles de présence par poste fixées par le gérant (Paramètres)
  const presenceRules = (await q.query(
    'SELECT job_titles, min_count, scope FROM presence_rules WHERE company_id = $1 ORDER BY created_at',
    [companyId]
  )).rows.map((r) => ({ jobTitles: r.job_titles.map((t) => t.trim()), min: Number(r.min_count), when: r.scope }));

  const habits = computeHabits({
    employees, history, weeks, holidays, openDays: company.open_days, templates,
  });

  return {
    company: { id: company.id, name: company.name, openDays: company.open_days },
    month: { year, month, first, last },
    range: { start: rangeStart, end: rangeEnd },
    historyRange: { start: historyStart, end: historyEnd },
    employees,
    templates,
    days,
    existing,
    lastDayBefore: history.filter((s) => s.date === historyEnd),
    presenceRules,
    habits,
  };
};

module.exports = { gatherFacts, readSlots, HISTORY_WEEKS };
