// ─────────────────────────────────────────────
// SERVICE PAIE — Cotisations salariales
// Taux simplifiés 2024 (ordre de grandeur PME)
// ─────────────────────────────────────────────

// Cotisations salariales (prélevées sur le salaire brut)
const COTISATIONS = [
  // Sécurité sociale
  { label: 'Assurance maladie',          categorie: 'Sécurité sociale',  taux: 0.0000 }, // exonérée salarié
  { label: 'Vieillesse plafonnée',       categorie: 'Sécurité sociale',  taux: 0.0690 },
  { label: 'Vieillesse déplafonnée',     categorie: 'Sécurité sociale',  taux: 0.0040 },
  { label: 'Veuvage',                    categorie: 'Sécurité sociale',  taux: 0.0010 },

  // Chômage
  { label: 'Assurance chômage',          categorie: 'Chômage',           taux: 0.0000 }, // supprimée salariés depuis 2018

  // Retraite complémentaire (AGIRC-ARRCO tranche 1)
  { label: 'Retraite complémentaire T1', categorie: 'Retraite',          taux: 0.0315 },
  { label: 'Retraite complémentaire T2', categorie: 'Retraite',          taux: 0.0086 }, // CEG

  // CSG / CRDS
  { label: 'CSG déductible',             categorie: 'CSG / CRDS',        taux: 0.0675 },
  { label: 'CSG non déductible',         categorie: 'CSG / CRDS',        taux: 0.0290 },
  { label: 'CRDS',                       categorie: 'CSG / CRDS',        taux: 0.0050 },
];

// Assiette CSG/CRDS = 98,25% du brut
const CSG_ASSIETTE_RATIO = 0.9825;

// Moyenne de semaines par mois (base légale française)
const WEEKS_PER_MONTH = 52 / 12;
// Durée légale du travail : seuil des heures supplémentaires
const LEGAL_WEEKLY_HOURS = 35;
// Temps partiel : majoration légale des heures complémentaires
// (article L3123-29) — +10 % dans la limite du dixième de la durée du
// contrat, +25 % au-delà
const COMPLEMENTARY_RATE_LOW  = 1.10;
const COMPLEMENTARY_RATE_HIGH = 1.25;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Heures majorées d'une semaine, décomptées semaine par semaine comme le
 * veut le Code du travail (une semaine courte ne compense jamais une
 * semaine longue).
 * - Temps plein (contrat ≥ 35 h) : au-delà du contrat, palier 1 jusqu'au
 *   seuil (43 h par défaut), palier 2 au-delà. Les heures entre 35 h et un
 *   contrat de 39 h sont déjà comprises dans le salaire mensualisé.
 * - Temps partiel : au-delà du contrat et jusqu'à 35 h, heures
 *   complémentaires (+10 % puis +25 %) ; au-delà de 35 h, paliers des
 *   heures supplémentaires.
 */
const weeklyExtras = (hours, weeklyHours, tier2Threshold) => {
  const out = { tier1: 0, tier2: 0, complementaryLow: 0, complementaryHigh: 0 };
  if (weeklyHours >= LEGAL_WEEKLY_HOURS) {
    out.tier1 = Math.max(0, Math.min(hours, tier2Threshold) - weeklyHours);
    out.tier2 = Math.max(0, hours - Math.max(tier2Threshold, weeklyHours));
  } else {
    const complementary = Math.max(0, Math.min(hours, LEGAL_WEEKLY_HOURS) - weeklyHours);
    out.complementaryLow  = Math.min(complementary, weeklyHours / 10);
    out.complementaryHigh = complementary - out.complementaryLow;
    out.tier1 = Math.max(0, Math.min(hours, tier2Threshold) - LEGAL_WEEKLY_HOURS);
    out.tier2 = Math.max(0, hours - Math.max(tier2Threshold, LEGAL_WEEKLY_HOURS));
  }
  return out;
};
// Convention simplifiée : jours ouvrés moyens par mois, pour proratiser une absence
const WORKING_DAYS_PER_MONTH = 22;

/**
 * Calcule toutes les cotisations et le salaire net à partir du brut,
 * en tenant compte des heures supplémentaires planifiées et des jours
 * de congé sans solde sur la période.
 *
 * @param {object} params
 * @param {number} params.grossSalary            — salaire brut contractuel mensuel
 * @param {number} [params.weeklyHours=35]        — durée hebdomadaire contractuelle
 * @param {{ start: string, hours: number }[]} [params.weeks] — heures nettes planifiées de chaque semaine
 *        rattachée au mois (vide = planning non pris en compte)
 * @param {number} [params.unpaidLeaveDays=0]      — jours de congé sans solde approuvés sur la période
 * @param {number} [params.overtimeTier1Rate=1.25]
 * @param {number} [params.overtimeTier2Rate=1.50]
 * @param {number} [params.overtimeTier2ThresholdHours=43] — seuil hebdo au-delà duquel la majoration passe au palier 2
 * @returns {{ lignes, totalSalarial, netSalary, netImposable, adjustedGross, overtime, absence }}
 */
const computePayroll = ({
  grossSalary,
  weeklyHours = 35,
  weeks = [],
  unpaidLeaveDays = 0,
  overtimeTier1Rate = 1.25,
  overtimeTier2Rate = 1.50,
  overtimeTier2ThresholdHours = 43,
}) => {
  const contractualGross  = parseFloat(grossSalary);
  const contractHours     = parseFloat(weeklyHours);
  const threshold         = parseFloat(overtimeTier2ThresholdHours);
  // Taux horaire de base : un contrat au-delà de 35 h (ex. 39 h) inclut déjà
  // des heures supplémentaires majorées dans le salaire mensualisé.
  const paidWeeklyHours = contractHours <= LEGAL_WEEKLY_HOURS
    ? contractHours
    : LEGAL_WEEKLY_HOURS
      + (Math.min(contractHours, threshold) - LEGAL_WEEKLY_HOURS) * parseFloat(overtimeTier1Rate)
      + Math.max(0, contractHours - threshold) * parseFloat(overtimeTier2Rate);
  const monthlyBaseHours  = paidWeeklyHours * WEEKS_PER_MONTH;
  const hourlyRate        = monthlyBaseHours > 0 ? contractualGross / monthlyBaseHours : 0;

  // Heures majorées, semaine par semaine (à partir du planning)
  const weekDetails = weeks.map((w) => ({ start: w.start, hours: round2(w.hours), ...weeklyExtras(w.hours, contractHours, threshold) }));
  const sum = (key) => weekDetails.reduce((s, w) => s + w[key], 0);
  const tier1Hours = sum('tier1');
  const tier2Hours = sum('tier2');
  const complementaryLowHours  = sum('complementaryLow');
  const complementaryHighHours = sum('complementaryHigh');
  const overtimeHours = tier1Hours + tier2Hours + complementaryLowHours + complementaryHighHours;
  const overtimePay = parseFloat((hourlyRate * (
    tier1Hours * parseFloat(overtimeTier1Rate)
    + tier2Hours * parseFloat(overtimeTier2Rate)
    + complementaryLowHours * COMPLEMENTARY_RATE_LOW
    + complementaryHighHours * COMPLEMENTARY_RATE_HIGH
  )).toFixed(2));

  // Déduction pour congé sans solde (prorata sur des jours ouvrés moyens)
  const dailyRate        = contractualGross / WORKING_DAYS_PER_MONTH;
  const absenceDeduction = parseFloat((unpaidLeaveDays * dailyRate).toFixed(2));

  // Brut réel du mois = contractuel + heures sup - absence non rémunérée
  const brut = parseFloat((contractualGross + overtimePay - absenceDeduction).toFixed(2));

  const assietteCSG = brut * CSG_ASSIETTE_RATIO;

  const lignes = COTISATIONS
    .filter(c => c.taux > 0)
    .map(c => {
      const assiette = c.label.startsWith('CSG') || c.label === 'CRDS'
        ? assietteCSG
        : brut;
      const montant = parseFloat((assiette * c.taux).toFixed(2));
      return {
        label:     c.label,
        categorie: c.categorie,
        assiette:  parseFloat(assiette.toFixed(2)),
        taux:      c.taux,
        montant,
      };
    });

  const totalSalarial  = parseFloat(lignes.reduce((s, l) => s + l.montant, 0).toFixed(2));
  const netSalary      = parseFloat((brut - totalSalarial).toFixed(2));

  // Net imposable = net + CSG non déductible + CRDS
  const csgNonDed = lignes.find(l => l.label === 'CSG non déductible')?.montant ?? 0;
  const crds      = lignes.find(l => l.label === 'CRDS')?.montant ?? 0;
  const netImposable = parseFloat((netSalary + csgNonDed + crds).toFixed(2));

  return {
    lignes, totalSalarial, netSalary, netImposable,
    adjustedGross: brut,
    overtime: {
      hours: round2(overtimeHours),
      pay:   overtimePay,
      // Détail : heures supplémentaires par palier, heures complémentaires
      // (temps partiel) et semaines prises en compte
      tier1Hours:             round2(tier1Hours),
      tier2Hours:             round2(tier2Hours),
      complementaryLowHours:  round2(complementaryLowHours),
      complementaryHighHours: round2(complementaryHighHours),
      weeks: weekDetails.map((w) => ({
        start: w.start, hours: w.hours,
        extra: round2(w.tier1 + w.tier2 + w.complementaryLow + w.complementaryHigh),
      })),
    },
    absence:  { days: unpaidLeaveDays, deduction: absenceDeduction },
  };
};

module.exports = { computePayroll, weeklyExtras };
