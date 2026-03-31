// ─────────────────────────────────────────────
// SERVICE CONGÉS — Calculs métier
// Règle légale française : 2,5 jours ouvrables
// acquis par mois de travail effectif
// ─────────────────────────────────────────────

// Jours fériés français fixes + Pâques (approximatif)
const getFrenchHolidays = (year) => {
  const holidays = [
    `${year}-01-01`, // Jour de l'an
    `${year}-05-01`, // Fête du Travail
    `${year}-05-08`, // Victoire 1945
    `${year}-07-14`, // Fête Nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ];

  // Calcul Pâques (algorithme de Meeus/Jones/Butcher)
  const easterDate = getEasterDate(year);
  const easterMs   = easterDate.getTime();
  const ascension  = new Date(easterMs + 39 * 86400000);
  const pentecote  = new Date(easterMs + 49 * 86400000);
  const lundiPaques = new Date(easterMs + 86400000);

  holidays.push(
    lundiPaques.toISOString().slice(0, 10),
    ascension.toISOString().slice(0, 10),
    pentecote.toISOString().slice(0, 10),
  );

  return new Set(holidays);
};

const getEasterDate = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

/**
 * Calcule le nombre de jours ouvrés entre deux dates (inclus)
 * En excluant les samedis, dimanches et jours fériés français
 */
const countWorkingDays = (startDate, endDate) => {
  const start    = new Date(startDate);
  const end      = new Date(endDate);
  const holidays = getFrenchHolidays(start.getFullYear());

  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek  = current.getDay();
    const dateStr    = current.toISOString().slice(0, 10);
    const isWeekend  = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday  = holidays.has(dateStr);

    if (!isWeekend && !isHoliday) count++;
    current.setDate(current.getDate() + 1);
  }

  return count;
};

/**
 * Calcule le solde de congés payés acquis selon la règle légale française :
 * 2,5 jours ouvrables par mois de travail effectif = 30 jours/an
 * @param {Date} hireDate   — date d'embauche
 * @param {number} year     — année de référence (période juin N-1 → mai N)
 */
const computeLegalBalance = (hireDate, year) => {
  const hire = new Date(hireDate);

  // Période de référence légale : 1er juin N-1 → 31 mai N
  const periodStart = new Date(year - 1, 5, 1);  // 1er juin N-1
  const periodEnd   = new Date(year, 4, 31);      // 31 mai N

  // Début réel = max(date embauche, début période)
  const effectiveStart = hire > periodStart ? hire : periodStart;

  if (effectiveStart > periodEnd) return 0; // Pas encore embauché

  // Nombre de mois complets travaillés dans la période
  let months = 0;
  const cursor = new Date(effectiveStart);

  while (cursor <= periodEnd) {
    months++;
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // 2,5 jours par mois, plafonné à 30
  return Math.min(months * 2.5, 30);
};

module.exports = { countWorkingDays, computeLegalBalance, getFrenchHolidays };
