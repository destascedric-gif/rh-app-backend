const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { DEMO_EMAIL_DOMAIN } = require('../config/mailer');
const { FREE_EMPLOYEE_LIMIT } = require('../services/billing.service');
const { labelOf, getTimingStats, getTimingSeries, RETENTION_DAYS } = require('../services/activityLog.service');

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
                  (SELECT max(u.updated_at) FROM users u WHERE u.company_id = c.id),
                  (SELECT max(a.created_at) FROM activity_log a WHERE a.company_id = c.id AND a.action <> 'EMAIL')
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

// Journal sans le compte démo, ni les e-mails (comptés dans la santé)
const DEMO_COMPANIES = `(SELECT u.company_id FROM users u
  WHERE u.company_id IS NOT NULL AND lower(u.email) LIKE '%' || $1)`;

const ROLE_LABELS = { admin: 'gérant', employee: 'employé' };

// GET /api/owner/activity?status=all|error|refused&company=<id>&limit=100
const getActivity = async (req, res) => {
  const status = ['error', 'refused'].includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const params = [DEMO_EMAIL_DOMAIN, limit];
  let filters = '';
  if (status) { params.push(status); filters += ` AND a.status = $${params.length}`; }
  if (/^[0-9a-f-]{36}$/i.test(req.query.company ?? '')) { params.push(req.query.company); filters += ` AND a.company_id = $${params.length}`; }

  try {
    const result = await db.query(
      `SELECT a.id, a.created_at, a.action, a.status, a.http_status, a.actor_role, c.name AS company
       FROM activity_log a
       LEFT JOIN company c ON c.id = a.company_id
       WHERE a.action <> 'EMAIL'
         AND (a.company_id IS NULL OR a.company_id NOT IN ${DEMO_COMPANIES})${filters}
       ORDER BY a.created_at DESC
       LIMIT $2`,
      params
    );
    res.json({
      retention_days: RETENTION_DAYS,
      entries: result.rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        company: r.company,
        role: ROLE_LABELS[r.actor_role] ?? null,
        label: labelOf(r.action, r.status),
        status: r.status,
        http_status: r.http_status,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/owner/health — dernières 24 heures
const getHealth = async (req, res) => {
  try {
    const counts = (await db.query(
      `SELECT
         count(*) FILTER (WHERE status = 'error' AND action <> 'EMAIL'
                          AND created_at >= NOW() - interval '24 hours')::int AS errors_24h,
         count(*) FILTER (WHERE action = 'EMAIL' AND status = 'ok'
                          AND created_at >= date_trunc('day', NOW()))::int AS emails_today,
         count(*) FILTER (WHERE action = 'EMAIL' AND status = 'error'
                          AND created_at >= NOW() - interval '24 hours')::int AS email_errors_24h,
         max(created_at) FILTER (WHERE status = 'error' AND action <> 'EMAIL') AS last_error_at
       FROM activity_log`
    )).rows[0];
    const timing = getTimingStats();
    res.json({
      online: true,
      uptime_s: Math.round(process.uptime()),
      requests_24h: timing.requests,
      avg_ms: timing.avgMs,
      errors_24h: counts.errors_24h,
      last_error_at: counts.last_error_at,
      emails_today: counts.emails_today,
      email_errors_24h: counts.email_errors_24h,
      email_daily_limit: 300,
      series: getTimingSeries(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/owner/companies/:id — fiche d'une entreprise : uniquement des
// nombres (jamais les noms des salariés, horaires, motifs…)
const UUID_RE = /^[0-9a-f-]{36}$/i;
const getCompany = async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Entreprise introuvable.' });

  try {
    const company = (await db.query(
      `SELECT c.id, c.name, c.created_at, c.plan,
              (SELECT count(*) FROM users u WHERE u.company_id = c.id AND u.role = 'employee' AND u.is_active AND u.invite_accepted)::int AS employees,
              (SELECT count(*) FROM users u WHERE u.company_id = c.id AND u.role = 'employee' AND u.is_active AND NOT u.invite_accepted)::int AS pending_invites,
              (SELECT count(*) FROM users u WHERE u.company_id = c.id AND u.role = 'employee' AND NOT u.is_active)::int AS inactive_employees,
              (SELECT count(*) FROM users u WHERE u.company_id = c.id AND u.role = 'admin')::int AS managers,
              (SELECT count(*) FROM shifts s WHERE s.company_id = c.id AND s.created_at >= NOW() - interval '30 days')::int AS shifts_30d,
              (SELECT count(*) FROM leave_requests l WHERE l.company_id = c.id AND l.created_at >= NOW() - interval '30 days')::int AS leaves_30d,
              (SELECT count(*) FROM timesheets t WHERE t.company_id = c.id AND t.created_at >= NOW() - interval '30 days')::int AS timesheets_30d,
              (SELECT count(*) FROM payslips p WHERE p.company_id = c.id AND p.created_at >= NOW() - interval '30 days')::int AS payslips_30d,
              (SELECT count(*) FROM meetings m WHERE m.company_id = c.id AND m.created_at >= NOW() - interval '30 days')::int AS meetings_30d,
              GREATEST(
                (SELECT max(s.updated_at) FROM shifts s WHERE s.company_id = c.id),
                (SELECT max(l.updated_at) FROM leave_requests l WHERE l.company_id = c.id),
                (SELECT max(t.created_at) FROM timesheets t WHERE t.company_id = c.id),
                (SELECT max(u.updated_at) FROM users u WHERE u.company_id = c.id),
                (SELECT max(a.created_at) FROM activity_log a WHERE a.company_id = c.id AND a.action <> 'EMAIL')
              ) AS last_activity
       FROM company c
       WHERE c.id = $2 AND ${REAL_COMPANY}`,
      [DEMO_EMAIL_DOMAIN, id]
    )).rows[0];
    if (!company) return res.status(404).json({ message: 'Entreprise introuvable.' });

    const [weeks, actions] = await Promise.all([
      // Actions par semaine, 12 dernières semaines (journal des actions)
      db.query(
        `SELECT to_char(w, 'YYYY-MM-DD') AS bucket,
                (SELECT count(*) FROM activity_log a
                   WHERE a.company_id = $1 AND a.action <> 'EMAIL'
                     AND a.created_at >= w AND a.created_at < w + interval '7 days')::int AS count
         FROM generate_series(date_trunc('week', NOW()) - interval '11 weeks',
                              date_trunc('week', NOW()), interval '1 week') AS w
         ORDER BY w`,
        [id]
      ),
      // Actions les plus fréquentes sur 30 jours
      db.query(
        `SELECT action, count(*)::int AS count
         FROM activity_log
         WHERE company_id = $1 AND action <> 'EMAIL' AND status = 'ok'
           AND created_at >= NOW() - interval '30 days'
         GROUP BY action ORDER BY count DESC LIMIT 8`,
        [id]
      ),
    ]);

    res.json({
      company,
      free_limit: FREE_EMPLOYEE_LIMIT,
      weeks: weeks.rows,
      top_actions: actions.rows.map((a) => ({ label: labelOf(a.action, 'ok'), count: a.count })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { setupPassword, getStats, getActivity, getHealth, getCompany };
