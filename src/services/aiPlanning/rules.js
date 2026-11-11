// ─────────────────────────────────────────────
// PLANNING PAR IA — vérification d'une proposition (sans IA)
// Ce que l'IA propose n'est jamais cru sur parole : Orgaly vérifie lui-même
// les règles strictes (point 3 de Notes/Planning par IA - règles.md).
// Niveaux : 'bloquant' (à corriger avant de proposer au gérant),
//           'avertissement' (montré au gérant, qui décide),
//           'info' (écart à l'habitude, pour l'aperçu).
// Fonction pure : aucune lecture de la base ici.
// ─────────────────────────────────────────────
const {
  addDays, toMin, fromMin, workedMinutes, isPresentAt, formatHours,
} = require('./time');

const PROTECTED_TYPES = ['conge', 'absence'];
const MAX_DAY_MIN = 10 * 60;        // 10 h de travail par jour
const MAX_WEEK_MIN = 48 * 60;       // 48 h par semaine
const DAILY_REST_MIN = 11 * 60;     // 11 h entre deux journées
const WEEKLY_REST_MIN = 35 * 60;    // 24 h + 11 h d'affilée chaque semaine
const PAUSE_FROM_MIN = 6 * 60;      // pause obligatoire dès 6 h de travail…
const PAUSE_MIN = 20;               // … d'au moins 20 minutes d'affilée
const DAY = 24 * 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Postes comparés sans tenir compte des majuscules ni des espaces autour
const sameTitle = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();

const frenchDate = (iso) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * @param {object}   p
 * @param {object}   p.facts     résultat de gatherFacts
 * @param {object[]} p.proposal  cases proposées [{ userId, date, type: 'travail'|'repos', startTime, endTime, breaks }]
 * @returns {{ planning: object[], problems: object[], counts: object }}
 */
const checkPlanning = ({ facts, proposal = [] }) => {
  const problems = [];
  const people = new Map(facts.employees.map((e) => [e.id, e]));
  const name = (id) => people.get(id)?.firstName || 'Salarié inconnu';
  const add = (level, code, message, extra = {}) => problems.push({ level, code, message, ...extra });

  // ── 1. Fusion : cases déjà posées + proposition ──
  const final = new Map(facts.existing.map((s) => [`${s.userId}|${s.date}`, s]));
  const seen = new Set();
  for (const s of proposal) {
    const key = `${s.userId}|${s.date}`;
    const where = { userId: s.userId, date: s.date };
    if (!people.has(s.userId)) { add('bloquant', 'salarie_inconnu', `Case pour un salarié inconnu ou parti (${s.date}).`, where); continue; }
    if (s.date < facts.range.start || s.date > facts.range.end) { add('bloquant', 'hors_periode', `${name(s.userId)} : case en dehors de la période (${s.date}).`, where); continue; }
    if (seen.has(key)) { add('bloquant', 'doublon', `${name(s.userId)} : deux cases le ${frenchDate(s.date)}.`, where); continue; }
    seen.add(key);
    const current = final.get(key);
    if (current && PROTECTED_TYPES.includes(current.type)) {
      add('bloquant', 'conge_touche', `${name(s.userId)} est en ${current.type === 'conge' ? 'congé' : 'absence'} le ${frenchDate(s.date)} : on n'y touche pas.`, where);
      continue;
    }
    if (!['travail', 'repos'].includes(s.type)) { add('bloquant', 'type_invalide', `${name(s.userId)} : type de case inconnu le ${s.date}.`, where); continue; }
    if (s.type === 'travail') {
      const times = [s.startTime, s.endTime, ...(s.breaks || []).flatMap((b) => [b.start_time, b.end_time])];
      const badTime = times.some((t) => !TIME_RE.test(String(t)));
      const badOrder = !badTime && (toMin(s.startTime) >= toMin(s.endTime)
        || (s.breaks || []).some((b) => toMin(b.start_time) >= toMin(b.end_time)
          || toMin(b.start_time) < toMin(s.startTime) || toMin(b.end_time) > toMin(s.endTime)));
      if (badTime || badOrder) { add('bloquant', 'horaire_invalide', `${name(s.userId)} : horaire impossible le ${frenchDate(s.date)}.`, where); continue; }
    }
    final.set(key, s);
  }
  const planning = [...final.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ── 2. Règles de la journée ──
  const dayInfo = new Map(facts.days.map((d) => [d.date, d]));
  for (const s of planning) {
    if (s.type !== 'travail') continue;
    const where = { userId: s.userId, date: s.date };
    const info = dayInfo.get(s.date);
    if (info && !info.open) add('avertissement', 'jour_ferme', `${name(s.userId)} travaille le ${frenchDate(s.date)}, un jour fermé.`, where);
    if (info && info.holiday && info.open) add('avertissement', 'jour_ferie', `${name(s.userId)} travaille le ${frenchDate(s.date)}, jour férié.`, where);

    if (people.get(s.userId)?.isManager) continue; // le gérant n'est pas soumis aux mêmes règles
    const worked = workedMinutes(s);
    if (worked > MAX_DAY_MIN) add('bloquant', 'plus_de_10h', `${name(s.userId)} : ${formatHours(worked)} de travail le ${frenchDate(s.date)} (10 h maximum).`, where);
    const longestBreak = Math.max(0, ...(s.breaks || []).map((b) => toMin(b.end_time) - toMin(b.start_time)));
    if (worked >= PAUSE_FROM_MIN && longestBreak < PAUSE_MIN) {
      add('bloquant', 'pause_manquante', `${name(s.userId)} : pas de pause de 20 minutes le ${frenchDate(s.date)} (obligatoire dès 6 h de travail).`, where);
    }
  }

  // ── 3. Règles sur plusieurs jours (salariés seulement) ──
  const before = new Map((facts.lastDayBefore || []).map((s) => [s.userId, s]));
  const weeks = [];
  for (let w = facts.range.start; w <= facts.range.end; w = addDays(w, 7)) weeks.push(w);

  for (const e of facts.employees) {
    if (e.isManager) continue;
    const mine = planning.filter((s) => s.userId === e.id && s.type === 'travail');

    // Périodes de travail en minutes depuis le début de la période (la veille comprise)
    const offset = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${facts.range.start}T00:00:00Z`)) / 60000);
    const intervals = [before.get(e.id), ...mine]
      .filter((s) => s && s.type === 'travail')
      .map((s) => ({ date: s.date, from: offset(s.date) + toMin(s.startTime), to: offset(s.date) + toMin(s.endTime) }))
      .sort((a, b) => a.from - b.from);

    // 11 h de repos entre deux journées
    for (let i = 1; i < intervals.length; i += 1) {
      const rest = intervals[i].from - intervals[i - 1].to;
      if (rest < DAILY_REST_MIN) {
        add('bloquant', 'repos_11h', `${e.firstName} : seulement ${formatHours(rest)} de repos avant le ${frenchDate(intervals[i].date)} (11 h minimum).`,
          { userId: e.id, date: intervals[i].date });
      }
    }

    for (const w of weeks) {
      const wStart = offset(w);
      const wEnd = wStart + 7 * DAY;
      // 48 h par semaine
      const weekMin = mine.filter((s) => s.date >= w && s.date <= addDays(w, 6)).reduce((sum, s) => sum + workedMinutes(s), 0);
      if (weekMin > MAX_WEEK_MIN) {
        add('bloquant', 'plus_de_48h', `${e.firstName} : ${formatHours(weekMin)} la semaine du ${frenchDate(w)} (48 h maximum).`, { userId: e.id, date: w });
      }
      // 35 h de repos d'affilée, dont au moins 24 h dans la semaine.
      // Le dimanche seul suffit (samedi 19 h → lundi 9 h 30 = 38 h 30, dont 29 h dans la semaine).
      const gaps = [];
      let previousEnd = -Infinity;
      for (const it of intervals) { gaps.push([previousEnd, it.from]); previousEnd = it.to; }
      gaps.push([previousEnd, Infinity]);
      const rested = gaps.some(([a, b]) => b - a >= WEEKLY_REST_MIN
        && Math.min(b, wEnd) - Math.max(a, wStart) >= DAY);
      if (!rested) {
        add('bloquant', 'repos_hebdo', `${e.firstName} : pas de repos de 35 h d'affilée la semaine du ${frenchDate(w)}.`, { userId: e.id, date: w });
      }
    }
  }

  // ── 4. Règles de présence par poste (fixées par le gérant) et écarts à l'habitude ──
  const staffing = facts.habits?.staffing || [];
  for (const d of facts.days) {
    if (!d.inMonth || !d.open || d.holiday) continue;
    const usual = staffing[d.weekday];
    const workers = planning.filter((s) => s.date === d.date && s.type === 'travail');

    for (const rule of facts.presenceRules || []) {
      const ofTitle = workers.filter((s) => sameTitle(people.get(s.userId)?.jobTitle, rule.jobTitle));
      let ok = ofTitle.length >= rule.min;
      // Heures où il manque quelqu'un : « de 12:30 à 13:30 »
      const missing = [];
      if (ok && rule.when === 'toujours' && usual?.usualOpening) {
        for (let m = toMin(usual.usualOpening); m < toMin(usual.usualClosing); m += 15) {
          if (ofTitle.filter((s) => isPresentAt(s, m)).length >= rule.min) continue;
          const last = missing[missing.length - 1];
          if (last && last[1] === m) last[1] = m + 15;
          else missing.push([m, m + 15]);
        }
        ok = missing.length === 0;
      }
      if (!ok) {
        const when = missing.length
          ? ` (manque ${missing.map(([a, b]) => `de ${fromMin(a)} à ${fromMin(b)}`).join(', ')})`
          : '';
        add('bloquant', 'regle_presence', `Le ${frenchDate(d.date)} : il faut au moins ${rule.min} ${rule.jobTitle}${rule.when === 'toujours' ? ' à chaque heure d\'ouverture' : ' dans la journée'}${when}.`, { date: d.date });
      }
    }

    if (usual?.usualPeople && workers.length < usual.usualPeople) {
      add('info', 'moins_que_habitude', `Le ${frenchDate(d.date)} : ${workers.length} personne(s), d'habitude ${usual.usualPeople}.`, { date: d.date });
    }
  }

  const counts = { bloquant: 0, avertissement: 0, info: 0 };
  problems.forEach((p) => { counts[p.level] += 1; });
  return { planning, problems, counts };
};

module.exports = { checkPlanning, frenchDate, PROTECTED_TYPES };
