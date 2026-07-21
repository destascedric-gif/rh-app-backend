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
 * @param {number|null} [params.scheduledHours]    — heures nettes planifiées sur le mois (null = planning non pris en compte)
 * @param {number} [params.unpaidLeaveDays=0]      — jours de congé sans solde approuvés sur la période
 * @param {number} [params.overtimeTier1Rate=1.25]
 * @param {number} [params.overtimeTier2Rate=1.50]
 * @param {number} [params.overtimeTier2ThresholdHours=43] — seuil hebdo au-delà duquel la majoration passe au palier 2
 * @returns {{ lignes, totalSalarial, netSalary, netImposable, adjustedGross, overtime, absence }}
 */
const computePayroll = ({
  grossSalary,
  weeklyHours = 35,
  scheduledHours = null,
  unpaidLeaveDays = 0,
  overtimeTier1Rate = 1.25,
  overtimeTier2Rate = 1.50,
  overtimeTier2ThresholdHours = 43,
}) => {
  const contractualGross  = parseFloat(grossSalary);
  const monthlyBaseHours  = parseFloat(weeklyHours) * WEEKS_PER_MONTH;
  const monthlyTier2Hours = overtimeTier2ThresholdHours * WEEKS_PER_MONTH;
  const hourlyRate        = monthlyBaseHours > 0 ? contractualGross / monthlyBaseHours : 0;

  // Heures supplémentaires (à partir du planning, si disponible)
  let overtimeHours = 0, tier1Hours = 0, tier2Hours = 0, overtimePay = 0;
  if (scheduledHours != null) {
    overtimeHours = Math.max(0, scheduledHours - monthlyBaseHours);
    tier1Hours    = Math.min(overtimeHours, Math.max(0, monthlyTier2Hours - monthlyBaseHours));
    tier2Hours    = Math.max(0, overtimeHours - tier1Hours);
    overtimePay   = parseFloat((tier1Hours * hourlyRate * overtimeTier1Rate + tier2Hours * hourlyRate * overtimeTier2Rate).toFixed(2));
  }

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
    overtime: { hours: parseFloat(overtimeHours.toFixed(2)), pay: overtimePay },
    absence:  { days: unpaidLeaveDays, deduction: absenceDeduction },
  };
};

module.exports = { computePayroll };
