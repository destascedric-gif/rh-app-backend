const db = require('../config/db');
const { gatherFacts } = require('../services/aiPlanning/facts');

// ─────────────────────────────────────────────
// PLANNING GÉNÉRÉ PAR IA (11 nov. 2026) — règles validées par Cédric :
// Notes/Planning par IA - règles.md
// ─────────────────────────────────────────────

// Mois demandé dans ?year=2027&month=1
const readMonth = (query) => {
  const year = Number(query.year);
  const month = Number(query.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
};

// GET /api/ai-planning/facts?year=…&month=… — ce qu'Orgaly sait avant de
// générer : habitudes, compteur d'écart, points à signaler au gérant.
const getFacts = async (req, res) => {
  const period = readMonth(req.query);
  if (!period) return res.status(400).json({ message: 'Mois invalide.' });
  try {
    const facts = await gatherFacts(db, req.user.companyId, period);
    res.json({
      month: facts.month,
      range: facts.range,
      warnings: facts.habits.warnings,
      people: facts.habits.people.map((p) => ({
        userId: p.userId,
        firstName: p.firstName,
        jobTitle: p.jobTitle,
        isManager: p.isManager,
        contractHours: p.contractHours,
        meanHours: p.meanHours,
        gapHours: p.gapHours,
        contractConfirmed: p.contractConfirmed,
      })),
      existingCount: facts.existing.length,
      presenceRules: facts.presenceRules,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/ai-planning/confirm-contract — { userId }
// « Oui, la fiche est juste » : on retient la durée du contrat confirmée,
// la question n'est plus posée (tant que le contrat ne change pas).
const confirmContract = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      `UPDATE users SET planning_hours_confirmed = weekly_hours
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE
       RETURNING id, planning_hours_confirmed`,
      [req.body.userId, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Salarié introuvable.' });
    res.json({ message: 'C\'est noté : la question ne sera plus posée pour ce salarié.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { getFacts, confirmContract, readMonth };
