// ─────────────────────────────────────────────
// PLANNING PAR IA — calcul des habitudes (sans IA)
// Règles validées par Cédric le 11 nov. 2026 (Notes/Planning par IA - règles.md) :
// - on prend ce qui se fait LE PLUS SOUVENT, jamais le minimum ;
// - les jours fériés et les semaines inhabituelles sont mis de côté ;
// - l'habitude passe avant les heures du contrat (on décrit le rythme réel).
// Fonctions pures : aucune lecture de la base ici.
// ─────────────────────────────────────────────
const {
  DAY_NAMES, addDays, weekdayOf, mondayOf, toMin, fromMin, workedMinutes, isPresentAt,
} = require('./time');

// Part minimale pour parler d'habitude (5 semaines sur 8, par exemple)
const HABIT_SHARE = 0.6;
// Grande différence contrat / réalité : au moins 5 h et 25 % du contrat
const ANOMALY_MIN_HOURS = 5;
const ANOMALY_SHARE = 0.25;
const STEP = 15; // minutes, pour le décompte des présences

// Valeur la plus fréquente d'une liste (la plus récente gagne en cas d'égalité)
const mode = (values) => {
  if (values.length === 0) return null;
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null;
  for (const v of values) if (best === null || counts.get(v) >= counts.get(best)) best = v;
  return { value: best, count: counts.get(best), share: counts.get(best) / values.length };
};

// Nom de l'horaire type qui correspond exactement à la case, sinon « 9:30-18:30 »
const slotLabel = (slot, templates) => {
  const tpl = templates.find((t) => t.startTime === slot.startTime && t.endTime === slot.endTime);
  return tpl ? tpl.name : `${slot.startTime}-${slot.endTime}`;
};

// Plages « 09:30-10:00 : 1 ; 10:00-12:15 : 2 » à partir d'une suite de valeurs par quart d'heure
const toRanges = (startMin, values) => {
  const ranges = [];
  values.forEach((v, i) => {
    const from = startMin + i * STEP;
    const last = ranges[ranges.length - 1];
    if (last && last.count === v) last.to = from + STEP;
    else ranges.push({ from, to: from + STEP, count: v });
  });
  return ranges.map((r) => ({ from: fromMin(r.from), to: fromMin(r.to), count: r.count }));
};

/**
 * @param {object}   p
 * @param {object[]} p.employees   [{ id, firstName, jobTitle, weeklyHours, isManager }]
 * @param {object[]} p.history     cases de l'historique [{ userId, date, type, startTime, endTime, breaks }]
 * @param {string[]} p.weeks       lundis des semaines d'historique à étudier
 * @param {Set}      p.holidays    jours fériés 'AAAA-MM-JJ'
 * @param {string}   p.openDays    '1111110' (lundi → dimanche)
 * @param {object[]} p.templates   horaires types [{ name, startTime, endTime }]
 */
const computeHabits = ({ employees, history, weeks, holidays, openDays, templates }) => {
  const byKey = new Map(history.map((s) => [`${s.userId}|${s.date}`, s]));
  // Une semaine est « planifiée » si l'entreprise y a posé au moins une case
  const plannedWeeks = weeks.filter((w) => history.some((s) => s.date >= w && s.date <= addDays(w, 6)));
  const isOpen = (iso) => openDays[weekdayOf(iso)] === '1';
  // Semaine inhabituelle pour toute l'équipe : un jour férié tombe un jour d'ouverture
  const holidayWeek = (w) => [...Array(7)].some((_, i) => holidays.has(addDays(w, i)) && isOpen(addDays(w, i)));

  // ── Habitudes de chaque personne ──
  const people = employees.map((e) => {
    const days = DAY_NAMES.map((name, wd) => {
      const statuses = [];
      const labels = [];
      for (const w of plannedWeeks) {
        const date = addDays(w, wd);
        if (holidays.has(date)) continue;
        const s = byKey.get(`${e.id}|${date}`);
        if (s && (s.type === 'conge' || s.type === 'absence')) continue; // pas représentatif
        statuses.push(s ? s.type : 'vide');
        if (s && s.type === 'travail') labels.push(slotLabel(s, templates));
      }
      const top = mode(statuses);
      const habit = top && top.share >= HABIT_SHARE ? top.value : 'variable';
      const usual = mode(labels);
      return {
        day: name,
        habit,                               // 'travail' | 'repos' | 'vide' | 'variable'
        share: top ? Math.round(top.share * 100) : 0,
        observed: statuses.length,
        workedShare: statuses.length ? Math.round((labels.length / statuses.length) * 100) : 0,
        usualShift: usual ? usual.value : null,
      };
    });

    // Rythme des heures : semaines sans férié ni congé/absence
    const weekHours = [];
    const unusualWeeks = [];
    for (const w of plannedWeeks) {
      const slots = [...Array(7)].map((_, i) => byKey.get(`${e.id}|${addDays(w, i)}`)).filter(Boolean);
      const hasLeave = slots.some((s) => s.type === 'conge' || s.type === 'absence');
      const minutes = slots.reduce((sum, s) => sum + workedMinutes(s), 0);
      if (hasLeave || holidayWeek(w)) unusualWeeks.push({ week: w, hours: minutes / 60, reason: hasLeave ? 'congé ou absence' : 'jour férié' });
      else weekHours.push({ week: w, hours: minutes / 60 });
    }
    const hours = weekHours.map((x) => x.hours);
    const mean = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
    const contract = e.isManager ? null : e.weeklyHours;
    // Compteur d'écart (niveau 1, informatif) : heures prévues − contrat, semaines habituelles
    const gap = contract != null && hours.length ? hours.reduce((a, h) => a + (h - contract), 0) : null;

    // Grande différence contrat / planning : question au gérant, sauf s'il a
    // déjà confirmé que la fiche est juste (on suit alors l'habitude).
    let anomaly = null;
    let contractDiffers = false;
    if (contract != null && hours.length >= 3) {
      const diff = Math.abs(mean - contract);
      contractDiffers = diff >= ANOMALY_MIN_HOURS && diff >= ANOMALY_SHARE * contract;
      if (contractDiffers && !e.contractConfirmed) {
        anomaly = {
          code: 'contrat_historique',
          userId: e.id,
          message: `${e.firstName} : ${contract} h au contrat, mais ${Math.round(mean * 10) / 10} h en moyenne dans le planning. La fiche est-elle juste ?`,
        };
      }
    }

    return {
      userId: e.id,
      firstName: e.firstName,
      jobTitle: e.jobTitle || null,
      isManager: Boolean(e.isManager),
      contractHours: contract,
      days,
      weekHours,
      unusualWeeks,
      meanHours: mean == null ? null : Math.round(mean * 10) / 10,
      // Compteur d'écart sans objet quand le contrat ne reflète pas la réalité (confirmé)
      gapHours: gap == null || (contractDiffers && e.contractConfirmed) ? null : Math.round(gap * 10) / 10,
      contractConfirmed: contractDiffers && Boolean(e.contractConfirmed),
      anomaly,
      noHistory: weekHours.length === 0 && unusualWeeks.length === 0,
    };
  });

  // ── Habitudes de l'entreprise, jour par jour ──
  const usualDates = (wd) => plannedWeeks.map((w) => addDays(w, wd))
    .filter((d) => !holidays.has(d) && !holidayWeek(mondayOf(d)));
  const workersOn = (date, filter = () => true) => employees
    .filter(filter)
    .map((e) => byKey.get(`${e.id}|${date}`))
    .filter((s) => s && s.type === 'travail');

  // Postes réellement remplis (« Gérant », mis par défaut au gérant, n'en est pas un)
  const jobTitles = [...new Set(employees
    .filter((e) => !(e.isManager && e.jobTitle === 'Gérant'))
    .map((e) => e.jobTitle).filter(Boolean))];

  const staffing = DAY_NAMES.map((name, wd) => {
    if (openDays[wd] !== '1') return { day: name, open: false };
    const dates = usualDates(wd).filter((d) => workersOn(d).length > 0);
    if (dates.length === 0) return { day: name, open: true, observed: 0 };

    const opening = mode(dates.map((d) => Math.min(...workersOn(d).map((s) => toMin(s.startTime)))));
    const closing = mode(dates.map((d) => Math.max(...workersOn(d).map((s) => toMin(s.endTime)))));
    const people = mode(dates.map((d) => workersOn(d).length));

    // Présence habituelle par quart d'heure, entre l'ouverture et la fermeture habituelles
    const from = opening.value;
    const to = closing.value;
    const presence = [];
    for (let m = from; m < to; m += STEP) {
      presence.push(mode(dates.map((d) => workersOn(d).filter((s) => isPresentAt(s, m)).length)).value);
    }

    // Postes : nombre habituel de personnes par poste, et présence permanente
    const byTitle = jobTitles.map((title) => {
      const onlyTitle = (e) => e.jobTitle === title;
      const perDay = mode(dates.map((d) => workersOn(d, onlyTitle).length));
      const alwaysCovered = dates.filter((d) => {
        const slots = workersOn(d, onlyTitle);
        for (let m = from; m < to; m += STEP) if (!slots.some((s) => isPresentAt(s, m))) return false;
        return true;
      }).length;
      return {
        jobTitle: title,
        usualCount: perDay.value,
        alwaysPresentShare: Math.round((alwaysCovered / dates.length) * 100),
      };
    });

    return {
      day: name,
      open: true,
      observed: dates.length,
      usualOpening: fromMin(opening.value),
      usualClosing: fromMin(closing.value),
      usualPeople: people.value,
      usualPeopleShare: Math.round(people.share * 100),
      presence: toRanges(from, presence),
      byTitle,
    };
  });

  // ── Points à signaler au gérant avant de générer ──
  const warnings = [];
  people.forEach((p) => { if (p.anomaly) warnings.push(p.anomaly); });
  const withoutTitle = employees.filter((e) => !e.isManager && !e.jobTitle);
  if (withoutTitle.length > 0) {
    warnings.push({
      code: 'postes_vides',
      message: withoutTitle.length === employees.filter((e) => !e.isManager).length
        ? 'Les postes ne sont pas remplis dans les fiches : l\'IA ne pourra pas tenir compte des diplômes ni des métiers.'
        : `Poste non rempli pour : ${withoutTitle.map((e) => e.firstName).join(', ')}.`,
    });
  }
  if (plannedWeeks.length < 3) {
    warnings.push({
      code: 'peu_historique',
      message: `Seulement ${plannedWeeks.length} semaine(s) de planning dans l'historique : les habitudes seront peu fiables.`,
    });
  }
  people.filter((p) => p.noHistory && !p.isManager).forEach((p) => warnings.push({
    code: 'sans_historique',
    message: `${p.firstName} n'apparaît pas encore dans le planning : pas d'habitude connue.`,
  }));

  return { weeksStudied: plannedWeeks, people, staffing, warnings };
};

module.exports = { computeHabits, mode, slotLabel, HABIT_SHARE };
