const crypto = require('crypto');
const db = require('../config/db');
const { DEMO_EMAIL_DOMAIN } = require('../config/mailer');

// ─────────────────────────────────────────────
// VISITES DU SITE (pilotage, 11 nov. 2026)
// Compteur maison des pages publiques, sans cookie ni donnée personnelle :
// - aucune adresse IP n'est enregistrée ; seule une empreinte du jour
//   (IP + navigateur, passés dans un secret qui change chaque jour) permet
//   de compter les visiteurs différents d'une journée ;
// - provenance : lien marqué (?src=carte, ?src=insta) ou site d'origine ;
// - robots ignorés ; lignes effacées au bout de 13 mois.
// ─────────────────────────────────────────────

const RETENTION_MONTHS = 13;

// Pages publiques comptées (les pages de l'appli, une fois connecté, non)
const PUBLIC_PATHS = new Set([
  '/', '/login', '/setup/admin', '/setup/company', '/mot-de-passe-oublie',
  '/mentions-legales', '/cgu', '/cgv', '/confidentialite', '/dpa',
]);

// ?src=… des liens que Cédric diffuse
const SRC_CODES = {
  carte: 'carte', qr: 'carte', cartes: 'carte',
  insta: 'instagram', instagram: 'instagram', ig: 'instagram',
  facebook: 'facebook', fb: 'facebook',
  google: 'google',
};

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|httpclient|monitor/i;

const sourceOf = (src, ref) => {
  if (typeof src === 'string' && src.trim()) return SRC_CODES[src.trim().toLowerCase()] || 'lien';
  if (typeof ref !== 'string' || !ref) return 'direct';
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return 'direct'; }
  if (host.endsWith('myorgaly.fr') || host === 'localhost' || host.endsWith('.vercel.app')) return 'direct';
  if (host.includes('instagram')) return 'instagram';
  if (host.includes('facebook') || host === 'fb.com' || host.endsWith('.fb.com')) return 'facebook';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (host.includes('bing.')) return 'bing';
  return 'autre';
};

const parisDay = () => new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
const SECRET = process.env.JWT_SECRET || 'orgaly-visites';

// POST /api/visits — { path, ref, src } ; répond tout de suite, sans contenu
const trackVisit = async (req, res) => {
  res.status(204).end();
  try {
    const ua = String(req.get('user-agent') || '').slice(0, 400);
    if (!ua || BOT_RE.test(ua)) return;
    const path = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!PUBLIC_PATHS.has(path)) return;
    const source = sourceOf(req.body.src, req.body.ref);
    const device = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'telephone' : 'ordinateur';
    const daySecret = crypto.createHmac('sha256', SECRET).update(`visites|${parisDay()}`).digest();
    const visitor = crypto.createHmac('sha256', daySecret).update(`${req.ip}|${ua}`).digest('hex').slice(0, 16);
    await db.query(
      'INSERT INTO site_visits (path, source, device, visitor) VALUES ($1, $2, $3, $4)',
      [path, source, device, visitor]
    );
  } catch (err) {
    console.error('Compteur de visites :', err.message);
  }
};

const purgeOldVisits = async () => {
  try {
    await db.query(`DELETE FROM site_visits WHERE created_at < NOW() - make_interval(months => ${RETENTION_MONTHS})`);
  } catch (err) {
    console.error('Purge des visites :', err.message);
  }
};
const startVisitsPurge = () => {
  purgeOldVisits();
  setInterval(purgeOldVisits, 6 * 3600 * 1000).unref();
};

// Chiffres de la page « Visites du site » du pilotage. Un « visiteur » =
// une empreinte sur une journée (on ne peut pas suivre quelqu'un d'un jour
// à l'autre : quelqu'un qui revient deux jours compte deux fois).
const getVisitStats = async (days) => {
  const TODAY = "(NOW() AT TIME ZONE 'Europe/Paris')::date";
  const DAY = "(created_at AT TIME ZONE 'Europe/Paris')::date";
  const base = `WITH v AS (
      SELECT *, ${DAY} AS day FROM site_visits
      WHERE ${DAY} >= ${TODAY} - ($1::int - 1)
    ),
    uniq AS (
      SELECT DISTINCT ON (day, visitor) day, visitor, source, device FROM v ORDER BY day, visitor, created_at
    )`;

  const [totals, previous, series, sources, pages, devices, signups] = await Promise.all([
    db.query(`${base}
      SELECT (SELECT count(*) FROM v)::int AS views,
             (SELECT count(*) FROM uniq)::int AS visitors,
             (SELECT count(*) FROM uniq WHERE source = 'carte')::int AS from_cards,
             (SELECT count(DISTINCT (day, visitor)) FROM v WHERE path = '/setup/admin')::int AS opened_signup`, [days]),
    db.query(
      `SELECT count(*)::int AS views FROM site_visits
       WHERE ${DAY} >= ${TODAY} - (2 * $1::int - 1) AND ${DAY} < ${TODAY} - ($1::int - 1)`,
      [days]
    ),
    days === 365
      ? db.query(`${base}
        SELECT to_char(m, 'YYYY-MM-01') AS bucket,
               (SELECT count(*) FROM v WHERE date_trunc('month', v.day) = m)::int AS views,
               (SELECT count(*) FROM uniq f WHERE date_trunc('month', f.day) = m)::int AS visitors
        FROM generate_series(date_trunc('month', NOW() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                             date_trunc('month', NOW() AT TIME ZONE 'Europe/Paris'), interval '1 month') AS m
        ORDER BY m`, [days])
      : db.query(`${base}
        SELECT to_char(d, 'YYYY-MM-DD') AS bucket,
               (SELECT count(*) FROM v WHERE v.day = d::date)::int AS views,
               (SELECT count(*) FROM uniq f WHERE f.day = d::date)::int AS visitors
        FROM generate_series(${TODAY} - ($1::int - 1), ${TODAY}, interval '1 day') AS d
        ORDER BY d`, [days]),
    db.query(`${base} SELECT source, count(*)::int AS count FROM uniq GROUP BY source ORDER BY count DESC`, [days]),
    db.query(`${base} SELECT path, count(*)::int AS count FROM v GROUP BY path ORDER BY count DESC`, [days]),
    db.query(`${base} SELECT device, count(*)::int AS count FROM uniq GROUP BY device`, [days]),
    // Entreprises créées sur la période (hors compte de démonstration)
    db.query(
      `SELECT count(*)::int AS count FROM company c
       WHERE (c.created_at AT TIME ZONE 'Europe/Paris')::date >= ${TODAY} - ($1::int - 1)
         AND c.id NOT IN (SELECT u.company_id FROM users u
                          WHERE u.company_id IS NOT NULL AND lower(u.email) LIKE '%' || $2)`,
      [days, DEMO_EMAIL_DOMAIN]
    ),
  ]);

  return {
    totals: { ...totals.rows[0], previous_views: previous.rows[0].views, signups: signups.rows[0].count },
    series: series.rows,
    sources: sources.rows,
    pages: pages.rows,
    devices: devices.rows,
    retention_months: RETENTION_MONTHS,
  };
};

module.exports = { trackVisit, startVisitsPurge, getVisitStats, sourceOf, PUBLIC_PATHS };
