const crypto = require('crypto');
const db = require('../config/db');
const { FRONTEND_URL } = require('../config/mailer');
const { toLocalDateString } = require('../utils/date');

// ─────────────────────────────────────────────
// PLANNING DANS L'AGENDA DU TÉLÉPHONE (24 nov. 2026, demande de Cédric)
// Chaque salarié (et le gérant s'il apparaît dans le planning) a un lien
// personnel et secret vers un fichier d'agenda au format iCalendar (.ics).
// Google Agenda, l'agenda de l'iPhone… s'y « abonnent » et le relisent
// eux-mêmes de temps en temps : sens unique, Orgaly → agenda.
// Contenu (choix de Cédric) : créneaux de travail (avec la pause), réunions
// et congés / absences. Jamais les repos (« un trou dans l'agenda suffit »).
// ─────────────────────────────────────────────

const PAST_DAYS = 60;     // historique gardé dans l'agenda
const FUTURE_DAYS = 400;  // planning à venir

const newToken = () => crypto.randomBytes(24).toString('base64url'); // 32 caractères

// Adresse publique du lien. En ligne : https://www.myorgaly.fr/agenda/…
// (le site relaie vers le serveur, voir vercel.json) ; en local : le
// serveur directement.
const feedUrl = (req, token) => {
  if (/localhost|127\.0\.0\.1/.test(FRONTEND_URL)) {
    return `${req.protocol}://${req.get('host')}/api/calendar/${token}.ics`;
  }
  const base = FRONTEND_URL.replace(/\/+$/, '').replace('://myorgaly.fr', '://www.myorgaly.fr');
  return `${base}/agenda/${token}.ics`;
};

// ── Format iCalendar ────────────────────────────────────────────────────
const esc = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lignes de 75 octets au plus (règle du format), suite précédée d'un espace
const fold = (line) => {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
};

// Dates déjà au format AAAA-MM-JJ (texte)
const ymd = (d) => String(d).slice(0, 10).replace(/-/g, '');
const hms = (t) => String(t).slice(0, 8).replace(/:/g, '').padEnd(6, '0');
const hhmm = (t) => String(t).slice(0, 5);
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toLocalDateString(d);
};
const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// Fuseau de Paris (heure d'été / d'hiver), pour que les heures restent
// justes quel que soit le réglage du téléphone
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
  'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
  'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const timedEvent = ({ uid, date, start, end, summary, description, stamp }) => {
  const endDate = hhmm(end) <= hhmm(start) ? addDays(date, 1) : date; // créneau de nuit
  return [
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Paris:${ymd(date)}T${hms(start)}`,
    `DTEND;TZID=Europe/Paris:${ymd(endDate)}T${hms(end)}`,
    `SUMMARY:${esc(summary)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    'TRANSP:OPAQUE', 'END:VEVENT',
  ];
};

const allDayEvent = ({ uid, from, to, summary, description, stamp }) => [
  'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`,
  `DTSTART;VALUE=DATE:${ymd(from)}`, `DTEND;VALUE=DATE:${ymd(addDays(to, 1))}`,
  `SUMMARY:${esc(summary)}`,
  ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
  'TRANSP:TRANSPARENT', 'END:VEVENT',
];

// Libellé d'un jour de congé : le type de congé payé / RTT, sinon « Congé » ;
// une absence (maladie, sans solde) reste « Absence », sans le motif.
const leaveLabel = (s) => {
  if (s.type === 'absence') return 'Absence';
  return ['Congés payés', 'RTT'].includes(s.note) ? s.note : 'Congé';
};

// Le fichier .ics d'une personne (null si le lien n'est pas valable)
const buildFeed = async (token) => {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const person = (await db.query(
    `SELECT u.id, u.first_name, u.role, u.company_id, c.name AS company_name, c.manager_in_schedule
     FROM users u JOIN company c ON c.id = u.company_id
     WHERE u.calendar_token = $1 AND u.is_active`,
    [token]
  )).rows[0];
  if (!person) return null;
  // Le gérant seulement s'il apparaît dans le planning
  if (person.role !== 'employee' && !(person.role === 'admin' && person.manager_in_schedule)) return null;

  const [shifts, breaks, templates, meetings] = await Promise.all([
    db.query(
      `SELECT id, date, start_time, end_time, type, note FROM shifts
       WHERE user_id = $1 AND type IN ('travail', 'conge', 'absence')
         AND date BETWEEN CURRENT_DATE - $2::int AND CURRENT_DATE + $3::int
       ORDER BY date`,
      [person.id, PAST_DAYS, FUTURE_DAYS]
    ),
    db.query(
      `SELECT b.shift_id, b.start_time, b.end_time FROM shift_breaks b JOIN shifts s ON s.id = b.shift_id
       WHERE s.user_id = $1 AND s.date BETWEEN CURRENT_DATE - $2::int AND CURRENT_DATE + $3::int
       ORDER BY b.start_time`,
      [person.id, PAST_DAYS, FUTURE_DAYS]
    ),
    db.query('SELECT name, start_time, end_time FROM shift_templates WHERE company_id = $1', [person.company_id]),
    db.query(
      `SELECT m.id, m.title, m.date, m.start_time, m.end_time, m.note FROM meetings m
       JOIN meeting_participants p ON p.meeting_id = m.id AND p.user_id = $1
       WHERE m.date BETWEEN CURRENT_DATE - $2::int AND CURRENT_DATE + $3::int
       ORDER BY m.date, m.start_time`,
      [person.id, PAST_DAYS, FUTURE_DAYS]
    ),
  ]);

  const stamp = stampNow();
  const where = `Planning Orgaly · ${person.company_name}`;
  const breaksOf = {};
  for (const b of breaks.rows) (breaksOf[b.shift_id] ??= []).push(b);
  const templateOf = (s) => templates.rows.find((t) => hhmm(t.start_time) === hhmm(s.start_time)
    && hhmm(t.end_time) === hhmm(s.end_time));

  const events = [];
  const leaves = [];
  for (const s of shifts.rows) {
    const date = toLocalDateString(s.date);
    if (s.type === 'travail') {
      const tpl = templateOf(s);
      const pauses = (breaksOf[s.id] ?? []).map((b) => `${hhmm(b.start_time)}-${hhmm(b.end_time)}`);
      events.push(...timedEvent({
        uid: `travail-${s.id}@myorgaly.fr`, date, start: s.start_time, end: s.end_time, stamp,
        summary: tpl ? `Travail (${tpl.name})` : 'Travail',
        description: [pauses.length ? `Pause ${pauses.join(', ')}` : '', where].filter(Boolean).join('\n'),
      }));
    } else {
      leaves.push({ date, label: leaveLabel(s) });
    }
  }

  // Jours de congé qui se suivent (même libellé) → un seul événement
  let run = null;
  const flush = () => {
    if (!run) return;
    events.push(...allDayEvent({
      uid: `conge-${person.id}-${run.from}@myorgaly.fr`, from: run.from, to: run.to,
      summary: run.label, description: where, stamp,
    }));
    run = null;
  };
  for (const l of leaves) {
    if (run && run.label === l.label && addDays(run.to, 1) === l.date) run.to = l.date;
    else { flush(); run = { from: l.date, to: l.date, label: l.label }; }
  }
  flush();

  for (const m of meetings.rows) {
    const title = m.title?.trim() || 'Réunion';
    events.push(...timedEvent({
      uid: `reunion-${m.id}@myorgaly.fr`, date: toLocalDateString(m.date), start: m.start_time, end: m.end_time, stamp,
      summary: /r[ée]union/i.test(title) ? title : `Réunion : ${title}`,
      description: [m.note, where].filter(Boolean).join('\n'),
    }));
  }

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orgaly//Planning//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`Orgaly · ${person.company_name}`)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE, ...events, 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
};

module.exports = { newToken, feedUrl, buildFeed };
