const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { DEMO_EMAIL_DOMAIN } = require('../config/mailer');
const { FREE_EMPLOYEE_LIMIT } = require('../services/billing.service');

// ─────────────────────────────────────────────
// PAGE DE PILOTAGE — réservée au propriétaire d'Orgaly
// Uniquement des chiffres globaux par entreprise : jamais le détail des
// salariés, plannings ou congés des clients.
// ─────────────────────────────────────────────

const PERIODS = { 7: 7, 30: 30, 365: 365 };

// Le compte de démonstration n'est pas un client : exclu des chiffres
const REAL_COMPANY = `c.id NOT IN (
  SELECT u.company_id FROM users u
  WHERE u.company_id IS NOT NULL AND lower(u.email) LIKE '%' || $1
)`;

// POST /api/owner/setup  { token, password }
// Choix du mot de passe depuis le lien envoyé par scripts/create-owner.js
const setupPassword = async (req, res) => {
  const { token, password } = req.body;
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');

  try {
    const owner = (await db.query(
      'SELECT id FROM platform_owners WHERE setup_token_hash = $1 AND setup_expires > NOW()',
      [tokenHash]
    )).rows[0];
    if (!owner) {
      return res.status(400).json({ message: 'Ce lien n\'est plus valable. Demandez-en un nouveau.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      `UPDATE platform_owners
       SET password_hash = $1, setup_token_hash = NULL, setup_expires = NULL
       WHERE id = $2`,
      [passwordHash, owner.id]
    );
    res.json({ message: 'Mot de passe enregistré. Vous pouvez vous connecter.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/owner/stats?days=30
const getStats = async (req, res) => {
  const days = PERIODS[req.query.days] ?? 30;
  const demo = DEMO_EMAIL_DOMAIN;

  try {
    const [totals, series, plans, companies] = await Promise.all([
      db.query(
        `SELECT
           (SELECT count(*) FROM company c WHERE ${REAL_COMPANY})::int AS companies,
           (SELECT count(*) FROM company c WHERE ${REAL_COMPANY}
              AND c.created_at >= NOW() - make_interval(days => $2))::int AS new_companies,
           (SELECT count(*) FROM users u JOIN company c ON c.id = u.company_id
              WHERE ${REAL_COMPANY} AND u.role = 'employee' AND u.is_active)::int AS employees,
           (SELECT count(*) FROM users u JOIN company c ON c.id = u.company_id
              WHERE ${REAL_COMPANY} AND u.role = 'employee' AND u.is_active
                AND u.created_at >= NOW() - make_interval(days => $2))::int AS new_employees,
           (SELECT count(*) FROM company c WHERE ${REAL_COMPANY} AND c.plan = 'pro')::int AS pro_companies`,
        [demo, days]
      ),
      // Inscriptions : par jour (7 ou 30 jours) ou par mois (12 mois)
      days === 365
        ? db.query(
          `SELECT to_char(m, 'YYYY-MM-01') AS bucket,
                  (SELECT count(*) FROM company c WHERE ${REAL_COMPANY}
                     AND date_trunc('month', c.created_at) = m)::int AS count
           FROM generate_series(date_trunc('month', NOW()) - interval '11 months',
                                date_trunc('month', NOW()), interval '1 month') AS m
           ORDER BY m`,
          [demo]
        )
        : db.query(
          `SELECT to_char(d, 'YYYY-MM-DD') AS bucket,
                  (SELECT count(*) FROM company c WHERE ${REAL_COMPANY}
                     AND c.created_at::date = d::date)::int AS count
           FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d
           ORDER BY d`,
          [demo, days]
        ),
      db.query(
        `SELECT c.plan, count(*)::int AS count FROM company c WHERE ${REAL_COMPANY} GROUP BY c.plan`,
        [demo]
      ),
      // Activité : dernière trace connue dans le planning, les congés, le
      // pointage ou l'équipe (le journal des actions viendra s'y ajouter)
      db.query(
        `SELECT c.id, c.name, c.created_at, c.plan,
                (SELECT count(*) FROM users u
                   WHERE u.company_id = c.id AND u.role = 'employee' AND u.is_active)::int AS employees,
                (SELECT count(*) FROM shifts s
                   WHERE s.company_id = c.id AND s.created_at >= NOW() - interval '30 days')::int AS shifts_30d,
                GREATEST(
                  (SELECT max(s.updated_at) FROM shifts s WHERE s.company_id = c.id),
                  (SELECT max(l.updated_at) FROM leave_requests l WHERE l.company_id = c.id),
                  (SELECT max(t.created_at) FROM timesheets t WHERE t.company_id = c.id),
                  (SELECT max(u.updated_at) FROM users u WHERE u.company_id = c.id)
                ) AS last_activity
         FROM company c
         WHERE ${REAL_COMPANY}
         ORDER BY last_activity DESC NULLS LAST, c.created_at DESC`,
        [demo]
      ),
    ]);

    const planCount = (p) => plans.rows.find((r) => r.plan === p)?.count ?? 0;
    const proCount = planCount('pro');

    res.json({
      days,
      totals: { ...totals.rows[0], revenue_month: null },
      series: series.rows,
      plans: { free: totals.rows[0].companies - proCount, pro: proCount },
      free_limit: FREE_EMPLOYEE_LIMIT,
      near_limit: companies.rows
        .filter((c) => c.plan !== 'pro' && c.employees >= FREE_EMPLOYEE_LIMIT - 1)
        .map((c) => ({ id: c.id, name: c.name, employees: c.employees })),
      companies: companies.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { setupPassword, getStats };
