const db = require('../config/db');

// ─────────────────────────────────────────────
// RÈGLES DE PRÉSENCE PAR POSTE (11 nov. 2026)
// Fixées par le gérant dans Paramètres ; respectées par le planning généré
// par IA et vérifiées par Orgaly (services/aiPlanning/rules.js).
// ─────────────────────────────────────────────

const COLUMNS = 'id, job_titles, min_count, scope, created_at';

// Même liste de postes, sans tenir compte de l'ordre, des majuscules ni des espaces
const sameTitles = (a, b) => {
  const norm = (list) => list.map((t) => t.trim().toLowerCase()).sort().join('|');
  return norm(a) === norm(b);
};

// Postes remplis dans les fiches des salariés actifs (pour le menu du gérant),
// plus celui du gérant s'il figure dans le planning (12 nov. 2026)
const readJobTitles = async (companyId) => (await db.query(
  `SELECT DISTINCT TRIM(u.job_title) AS title
   FROM users u JOIN company c ON c.id = u.company_id
   WHERE u.company_id = $1 AND u.is_active = TRUE AND NULLIF(TRIM(u.job_title), '') IS NOT NULL
     AND (u.role = 'employee' OR (u.role = 'admin' AND c.manager_in_schedule))
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

// POST /api/presence-rules — { jobTitles: [...], minCount, scope }
const createPresenceRule = async (req, res) => {
  const { companyId } = req.user;
  const { jobTitles, minCount, scope } = req.body;
  try {
    const sameScope = (await db.query(
      'SELECT job_titles FROM presence_rules WHERE company_id = $1 AND scope = $2',
      [companyId, scope]
    )).rows;
    if (sameScope.some((r) => sameTitles(r.job_titles, jobTitles))) {
      return res.status(409).json({ message: 'Une règle existe déjà pour ces postes : supprimez-la pour la remplacer.' });
    }

    const result = await db.query(
      `INSERT INTO presence_rules (company_id, job_titles, min_count, scope) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [companyId, jobTitles, minCount, scope]
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
