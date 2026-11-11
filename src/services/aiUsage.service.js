const db = require('../config/db');

// ─────────────────────────────────────────────
// DÉPENSES DE L'IA (pilotage, 11 nov. 2026)
// Chaque génération est enregistrée avec les jetons comptés par Anthropic et
// le coût estimé (prix publics). Le crédit restant est ESTIMÉ : dernier
// relevé réel noté par Cédric (ou zéro) + recharges notées depuis − coûts
// enregistrés depuis. Écarts possibles : dépenses faites hors d'Orgaly,
// génération coupée avant la fin ; un nouveau relevé les remet à zéro.
// ─────────────────────────────────────────────

const ALERT_USD = Number(process.env.AI_CREDIT_ALERT_USD) || 2;
// Jour et mois à l'heure de Paris
const PARIS_DAY = "(created_at AT TIME ZONE 'Europe/Paris')::date";
const TODAY = "(NOW() AT TIME ZONE 'Europe/Paris')::date";

// Ne doit jamais faire échouer la génération elle-même
const recordGeneration = async (g) => {
  try {
    const u = g.usage || {};
    const r = await db.query(
      `INSERT INTO ai_generations (company_id, month, status, model, attempts, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, refinement, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        g.companyId, g.month, g.status, g.model || null, g.attempts || 0,
        u.input_tokens || 0, u.output_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0,
        Number(g.costUsd || 0).toFixed(4), g.durationMs ?? null, Boolean(g.refinement),
        g.error ? String(g.error).slice(0, 200) : null,
      ]
    );
    return r.rows[0].id;
  } catch (err) {
    console.error('Enregistrement de la génération IA :', err.message);
    return null;
  }
};

// La dernière proposition du mois (moins de 24 h) a été appliquée au planning
const markApplied = async (companyId, month) => {
  try {
    await db.query(
      `UPDATE ai_generations SET applied_at = NOW()
       WHERE id = (SELECT id FROM ai_generations
                   WHERE company_id = $1 AND month = $2 AND status = 'proposee' AND applied_at IS NULL
                     AND created_at > NOW() - interval '1 day'
                   ORDER BY created_at DESC LIMIT 1)`,
      [companyId, month]
    );
  } catch (err) {
    console.error('Génération IA marquée comme appliquée :', err.message);
  }
};

// Crédit restant estimé
const getCredit = async () => {
  const events = (await db.query(
    `SELECT id, kind, amount_usd::float AS amount, occurred_at
     FROM ai_credit_events ORDER BY occurred_at DESC, created_at DESC`
  )).rows;
  if (events.length === 0) return { balance: null, events: [], alert_usd: ALERT_USD };

  const anchor = events.find((e) => e.kind === 'releve') || null;
  const from = anchor ? anchor.occurred_at : events[events.length - 1].occurred_at;
  const recharges = events
    .filter((e) => e.kind === 'recharge' && (!anchor || e.occurred_at > anchor.occurred_at))
    .reduce((s, e) => s + e.amount, 0);
  const spent = (await db.query(
    'SELECT COALESCE(SUM(cost_usd), 0)::float AS s FROM ai_generations WHERE created_at > $1',
    [from]
  )).rows[0].s;
  const base = anchor ? anchor.amount : 0;

  return {
    balance: Math.round((base + recharges - spent) * 100) / 100,
    base,
    anchor: anchor ? { amount: anchor.amount, at: anchor.occurred_at } : null,
    recharges_since: recharges,
    spent_since: Math.round(spent * 100) / 100,
    from,
    events: events.slice(0, 12),
    alert_usd: ALERT_USD,
  };
};

const addCreditEvent = async (kind, amount) => (await db.query(
  'INSERT INTO ai_credit_events (kind, amount_usd) VALUES ($1, $2) RETURNING id, kind, amount_usd::float AS amount, occurred_at',
  [kind, amount]
)).rows[0];

const deleteCreditEvent = async (id) => (await db.query('DELETE FROM ai_credit_events WHERE id = $1 RETURNING id', [id])).rows[0];

// Chiffres de la page « Intelligence artificielle » du pilotage
const getAiStats = async (days) => {
  const period = `${PARIS_DAY} >= ${TODAY} - ($1::int - 1)`;
  const [totals, month, series, recent, byCompany, credit] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS generations,
              count(*) FILTER (WHERE status = 'proposee')::int AS proposed,
              count(*) FILTER (WHERE applied_at IS NOT NULL)::int AS applied,
              count(*) FILTER (WHERE status = 'echec')::int AS failed,
              COALESCE(SUM(cost_usd), 0)::float AS cost,
              COALESCE(AVG(cost_usd) FILTER (WHERE status = 'proposee'), 0)::float AS avg_cost,
              COALESCE(AVG(duration_ms) FILTER (WHERE status = 'proposee'), 0)::float AS avg_ms
       FROM ai_generations WHERE ${period}`,
      [days]
    ),
    db.query(
      `SELECT count(*)::int AS generations, COALESCE(SUM(cost_usd), 0)::float AS cost
       FROM ai_generations
       WHERE date_trunc('month', created_at AT TIME ZONE 'Europe/Paris') = date_trunc('month', NOW() AT TIME ZONE 'Europe/Paris')`
    ),
    days === 365
      ? db.query(
        `SELECT to_char(m, 'YYYY-MM-01') AS bucket,
                COALESCE((SELECT SUM(cost_usd) FROM ai_generations
                          WHERE date_trunc('month', created_at AT TIME ZONE 'Europe/Paris') = m), 0)::float AS value
         FROM generate_series(date_trunc('month', NOW() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                              date_trunc('month', NOW() AT TIME ZONE 'Europe/Paris'), interval '1 month') AS m
         ORDER BY m`
      )
      : db.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS bucket,
                COALESCE((SELECT SUM(cost_usd) FROM ai_generations WHERE ${PARIS_DAY} = d::date), 0)::float AS value
         FROM generate_series(${TODAY} - ($1::int - 1), ${TODAY}, interval '1 day') AS d
         ORDER BY d`,
        [days]
      ),
    db.query(
      `SELECT g.id, g.created_at, g.month, g.status, g.duration_ms, g.cost_usd::float AS cost, g.refinement,
              g.applied_at IS NOT NULL AS applied, g.error, c.name AS company
       FROM ai_generations g LEFT JOIN company c ON c.id = g.company_id
       ORDER BY g.created_at DESC LIMIT 12`
    ),
    db.query(
      `SELECT c.id, COALESCE(c.name, 'Entreprise supprimée') AS company, count(*)::int AS generations,
              COALESCE(SUM(g.cost_usd), 0)::float AS cost
       FROM ai_generations g LEFT JOIN company c ON c.id = g.company_id
       WHERE ${PARIS_DAY.replace('created_at', 'g.created_at')} >= ${TODAY} - ($1::int - 1)
       GROUP BY c.id, c.name ORDER BY cost DESC`,
      [days]
    ),
    getCredit(),
  ]);

  return {
    totals: totals.rows[0],
    month: month.rows[0],
    series: series.rows,
    recent: recent.rows,
    by_company: byCompany.rows,
    credit,
  };
};

module.exports = {
  recordGeneration, markApplied, getCredit, addCreditEvent, deleteCreditEvent, getAiStats, ALERT_USD,
};
