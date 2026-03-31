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

/**
 * Calcule toutes les cotisations et le salaire net à partir du brut
 * @param {number} grossSalary — salaire brut mensuel
 * @returns {{ cotisations, totalSalarial, netSalary, netImposable }}
 */
const computePayroll = (grossSalary) => {
  const brut      = parseFloat(grossSalary);
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

  return { lignes, totalSalarial, netSalary, netImposable };
};

module.exports = { computePayroll };
