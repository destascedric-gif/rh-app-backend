const db = require('../config/db');

// ─────────────────────────────────────────────
// HISTORIQUE DE LA SANTÉ TECHNIQUE (pilotage, 15 nov. 2026)
// Compteurs heure par heure, gardés en base pour ne plus repartir de zéro
// à chaque redémarrage : nombre de requêtes, temps total (→ moyenne),
// requêtes lentes (≥ 1,5 s), erreurs du serveur (code 500 et plus),
// « contrôles » (un toutes les 5 minutes tant que le serveur tourne →
// disponibilité) et redémarrages (= mises en ligne, ou plantages).
// Aucune donnée personnelle : seulement des nombres.
// ─────────────────────────────────────────────

const RETENTION_MONTHS = 13;
const FLUSH_MS = 5 * 60 * 1000;   // écriture en base toutes les 5 minutes
const SLOW_MS = 1500;
const CHECKS_PER_DAY = (24 * 3600 * 1000) / FLUSH_MS; // 288

// Écrit en base seulement sur le vrai serveur (Railway) : les serveurs
// d'essai lancés sur l'ordinateur partagent la base de production et
// fausseraient l'historique
const ENABLED = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID
  || process.env.HEALTH_HISTORY === '1');

const FIELDS = ['requests', 'total_ms', 'slow', 'errors', 'checks', 'restarts'];
const pending = new Map(); // heure (ms) -> compteurs pas encore écrits
const hourOf = (t) => Math.floor(t / 3600000) * 3600000;
const bucket = (hour) => {
  let b = pending.get(hour);
  if (!b) { b = Object.fromEntries(FIELDS.map((f) => [f, 0])); pending.set(hour, b); }
  return b;
};

// Appelé pour chaque requête (middleware du journal)
const recordRequest = (ms, statusCode) => {
  const b = bucket(hourOf(Date.now()));
  b.requests += 1;
  b.total_ms += ms;
  if (ms >= SLOW_MS) b.slow += 1;
  if (statusCode >= 500) b.errors += 1;
  // Sans écriture en base (essais), ne garder que les dernières heures
  if (pending.size > 30) pending.delete(pending.keys().next().value);
};

// Ajoute les compteurs en attente à ceux déjà en base (jamais d'écrasement :
// après un redémarrage, l'heure en cours continue de s'additionner)
const flush = async ({ check = true } = {}) => {
  if (check) bucket(hourOf(Date.now())).checks += 1;
  const rows = [...pending.entries()];
  pending.clear();
  for (const [hour, b] of rows) {
    try {
      await db.query(
        `INSERT INTO health_hourly (hour, ${FIELDS.join(', ')})
         VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hour) DO UPDATE SET
           ${FIELDS.map((f) => `${f} = health_hourly.${f} + EXCLUDED.${f}`).join(', ')}`,
        [hour, ...FIELDS.map((f) => b[f])]
      );
    } catch (err) {
      // Remis de côté pour le prochain essai
      const p = bucket(hour);
      for (const f of FIELDS) p[f] += b[f];
      console.error('Historique de santé :', err.message);
    }
  }
};

const purge = () => db.query(
  `DELETE FROM health_hourly WHERE hour < NOW() - make_interval(months => ${RETENTION_MONTHS})`
).catch((err) => console.error('Purge de l’historique de santé :', err.message));

const startHealthHistory = () => {
  if (!ENABLED) return;
  bucket(hourOf(Date.now())).restarts += 1;
  flush({ check: false });
  setInterval(() => flush(), FLUSH_MS).unref();
  purge();
  setInterval(purge, 6 * 3600 * 1000).unref();
  // Mise en ligne : Railway arrête l'ancien serveur (SIGTERM) ; on écrit
  // les derniers compteurs avant de s'arrêter (3 secondes au plus)
  process.once('SIGTERM', () => {
    const done = () => process.exit(0);
    setTimeout(done, 3000).unref();
    flush({ check: false }).finally(done);
  });
};

// Dernières 24 heures, heure par heure (base + compteurs pas encore écrits)
const getLast24h = async () => {
  const hourNow = hourOf(Date.now());
  const from = hourNow - 23 * 3600000;
  const rows = (await db.query(
    `SELECT (extract(epoch FROM hour) * 1000)::bigint AS h, requests, total_ms
     FROM health_hourly WHERE hour >= to_timestamp($1 / 1000.0)`,
    [from]
  )).rows;
  const byHour = new Map();
  const add = (h, requests, totalMs) => {
    const b = byHour.get(h) ?? { requests: 0, totalMs: 0 };
    b.requests += requests; b.totalMs += totalMs;
    byHour.set(h, b);
  };
  for (const r of rows) add(Number(r.h), r.requests, Number(r.total_ms));
  for (const [h, b] of pending) if (h >= from) add(h, b.requests, b.total_ms);

  const series = [];
  let requests = 0, totalMs = 0;
  for (let h = from; h <= hourNow; h += 3600000) {
    const b = byHour.get(h) ?? { requests: 0, totalMs: 0 };
    requests += b.requests; totalMs += b.totalMs;
    series.push({ hour: new Date(h).toISOString(), count: b.requests, avg_ms: b.requests ? Math.round(b.totalMs / b.requests) : null });
  }
  return { series, requests, avgMs: requests ? Math.round(totalMs / requests) : null };
};

// Historique jour par jour sur N jours : rapidité et disponibilité (cette
// table, depuis le 15 nov. 2026), erreurs et e-mails (journal des actions,
// gardé 90 jours)
const getDailyHistory = async (days) => {
  const TODAY = "(NOW() AT TIME ZONE 'Europe/Paris')::date";
  const { rows } = await db.query(
    `WITH d AS (
       SELECT gs::date AS day FROM generate_series(${TODAY} - ($1::int - 1), ${TODAY}, interval '1 day') gs
     ),
     h AS (
       SELECT (hour AT TIME ZONE 'Europe/Paris')::date AS day,
              sum(requests)::int AS requests, sum(total_ms)::bigint AS total_ms, sum(slow)::int AS slow,
              sum(checks)::int AS checks, sum(restarts)::int AS restarts
       FROM health_hourly WHERE hour >= NOW() - make_interval(days => $1::int + 1)
       GROUP BY 1
     ),
     a AS (
       SELECT (created_at AT TIME ZONE 'Europe/Paris')::date AS day,
              count(*) FILTER (WHERE status = 'error' AND action <> 'EMAIL')::int AS errors,
              count(*) FILTER (WHERE action = 'EMAIL' AND status = 'ok')::int AS emails,
              count(*) FILTER (WHERE action = 'EMAIL' AND status = 'error')::int AS email_errors
       FROM activity_log WHERE created_at >= NOW() - make_interval(days => $1::int + 1)
       GROUP BY 1
     ),
     first AS (SELECT min(hour) AS at FROM health_hourly)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS bucket,
            h.requests, h.total_ms, h.slow, h.checks, h.restarts,
            COALESCE(a.errors, 0) AS errors, COALESCE(a.emails, 0) AS emails, COALESCE(a.email_errors, 0) AS email_errors,
            -- jour pleinement mesuré (pas le premier jour de mesure)
            (first.at IS NOT NULL AND d.day > (first.at AT TIME ZONE 'Europe/Paris')::date) AS measured,
            -- secondes écoulées du jour (aujourd'hui : jusqu'à maintenant)
            extract(epoch FROM LEAST(NOW(), (d.day + 1)::timestamp AT TIME ZONE 'Europe/Paris')
                               - (d.day::timestamp AT TIME ZONE 'Europe/Paris'))::int AS elapsed_s
     FROM d LEFT JOIN h USING (day) LEFT JOIN a USING (day) CROSS JOIN first
     ORDER BY d.day`,
    [days]
  );
  const first = (await db.query('SELECT min(hour) AS at FROM health_hourly')).rows[0].at;

  const series = rows.map((r) => {
    const expected = Math.floor(r.elapsed_s / (FLUSH_MS / 1000));
    const availability = r.measured && expected >= 12
      ? Math.min(100, Math.round(((r.checks ?? 0) / expected) * 1000) / 10)
      : null;
    return {
      bucket: r.bucket,
      requests: r.requests ?? null,
      avg_ms: r.requests ? Math.round(Number(r.total_ms) / r.requests) : null,
      slow: r.slow ?? null,
      restarts: r.restarts ?? 0,
      availability,
      errors: r.errors,
      emails: r.emails,
      email_errors: r.email_errors,
    };
  });

  const sum = (k) => series.reduce((s, x) => s + (x[k] ?? 0), 0);
  const requests = sum('requests');
  const totalMs = rows.reduce((s, r) => s + Number(r.total_ms ?? 0), 0);
  const measured = series.filter((x) => x.availability !== null);
  return {
    since: first,
    checks_per_day: CHECKS_PER_DAY,
    totals: {
      requests,
      avg_ms: requests ? Math.round(totalMs / requests) : null,
      slow: sum('slow'),
      errors: sum('errors'),
      emails: sum('emails'),
      email_errors: sum('email_errors'),
      restarts: sum('restarts'),
      availability: measured.length
        ? Math.round((measured.reduce((s, x) => s + x.availability, 0) / measured.length) * 10) / 10
        : null,
    },
    series,
  };
};

module.exports = { recordRequest, startHealthHistory, getLast24h, getDailyHistory };
