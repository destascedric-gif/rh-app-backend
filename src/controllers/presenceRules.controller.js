const db = require('../config/db');

// ─────────────────────────────────────────────
// RÈGLES DE PRÉSENCE PAR POSTE (11 nov. 2026)
// Fixées par le gérant dans Paramètres ; respectées par le planning généré
// par IA et vérifiées par Orgaly (services/aiPlanning/rules.js).
// ─────────────────────────────────────────────

const COLUMNS = 'id, job_title, min_count, scope, created_at';

// Postes remplis dans les fiches des salariés actifs (pour le menu du gérant)
const readJobTitles = async (companyId) => (await db.query(
  `SELECT DISTINCT TRIM(job_title) AS title FROM users
   WHERE company_id = $1 AND is_active = TRUE AND role = 'employee' AND NULLIF(TRIM(job_title), '') IS NOT NULL
   ORDER BY 1`,
  [companyId]
)).rows.map((r) => r.title);

// GET /api/presence-rules — { rules, jobTitles }
const getPresenceRules = async (req, res) => {
  const { companyId } = req.user;
  try {
    const rules = (await db.query(
      `SELECT ${COLUMNS} FROM presence_rules WHERE company_id = $1 ORDER BY created_at`,
      [companyId]
    )).rows;
    res.json({ rules, jobTitles: await readJobTitles(companyId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/presence-rules — { jobTitle, minCount, scope }
const createPresenceRule = async (req, res) => {
  const { companyId } = req.user;
  const { jobTitle, minCount, scope } = req.body;
  try {
    const duplicate = (await db.query(
      'SELECT 1 FROM presence_rules WHERE company_id = $1 AND LOWER(TRIM(job_title)) = LOWER($2) AND scope = $3',
      [companyId, jobTitle, scope]
    )).rows[0];
    if (duplicate) return res.status(409).json({ message: 'Une règle existe déjà pour ce poste : supprimez-la pour la remplacer.' });

    const result = await db.query(
      `INSERT INTO presence_rules (company_id, job_title, min_count, scope) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [companyId, jobTitle, minCount, scope]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// DELETE /api/presence-rules/:id
const deletePresenceRule = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      'DELETE FROM presence_rules WHERE id = $1 AND company_id = $2 RETURNING id',
      [req.params.id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Règle introuvable.' });
    res.json({ message: 'Règle supprimée.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { getPresenceRules, createPresenceRule, deletePresenceRule };
