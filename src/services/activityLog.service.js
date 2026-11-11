const db = require('../config/db');

// ─────────────────────────────────────────────
// JOURNAL DES ACTIONS ET SANTÉ TECHNIQUE (page de pilotage)
// On note qui (rôle, entreprise), quoi, quand et le résultat de chaque
// action qui modifie quelque chose — jamais le contenu de la requête.
// ─────────────────────────────────────────────

const RETENTION_DAYS = 90;

// Libellés des actions, par « MÉTHODE /api/chemin » (tel que déclaré dans
// les routes). null = action non journalisée (sans intérêt pour le suivi).
// Le code est stocké tel quel : un libellé corrigé ici s'applique aussi à
// l'historique.
const ACTION_LABELS = {
  'POST /api/auth/setup/admin': 'a créé son compte gérant',
  'POST /api/auth/setup/company': 'a créé son entreprise',
  'POST /api/auth/login': "s'est connecté",
  'PUT /api/auth/change-password': 'a changé son mot de passe',
  'POST /api/auth/invite': 'a invité un salarié',
  'POST /api/auth/invite/:id/resend': 'a renvoyé une invitation',
  'POST /api/auth/accept-invite': 'a accepté son invitation',
  'POST /api/billing/checkout': 'a ouvert le paiement de la formule Pro',
  'POST /api/billing/portal': "a ouvert la gestion de l'abonnement",
  'POST /api/employees/me/timesheets': 'a pointé',
  'PUT /api/employees/me/timesheets/:timesheetId': 'a modifié son pointage',
  'DELETE /api/employees/me/timesheets/:timesheetId': 'a supprimé un pointage',
  'PUT /api/employees/order': "a réordonné l'équipe",
  'PUT /api/employees/:id': 'a modifié une fiche salarié',
  'DELETE /api/employees/:id': 'a désactivé un salarié',
  'PUT /api/employees/:id/reactivate': 'a réactivé un salarié',
  'POST /api/employees/:id/documents': 'a ajouté un document',
  'POST /api/employees/:id/timesheets': 'a ajouté un pointage',
  'PUT /api/employees/:id/timesheets/:timesheetId': 'a modifié un pointage',
  'DELETE /api/employees/:id/timesheets/:timesheetId': 'a supprimé un pointage',
  'PATCH /api/employees/:id/timesheets/:timesheetId/status': 'a validé ou refusé un pointage',
  'POST /api/leaves/request': 'a demandé un congé',
  'PATCH /api/leaves/notifications/read-all': null,
  'PATCH /api/leaves/admin/requests/:id': 'a traité une demande de congé',
  'POST /api/meetings/': 'a créé une réunion',
  'PUT /api/meetings/:id': 'a modifié une réunion',
  'DELETE /api/meetings/:id': 'a supprimé une réunion',
  'POST /api/owner/setup': null,
  'POST /api/payroll/generate': 'a généré un bulletin de paie',
  'POST /api/payroll/generate-all': 'a généré les bulletins du mois',
  'DELETE /api/payroll/:id': 'a supprimé un bulletin de paie',
  'POST /api/schedule/': 'a créé un créneau',
  'PUT /api/schedule/:id': 'a modifié un créneau',
  'DELETE /api/schedule/:id': 'a supprimé un créneau',
  'PUT /api/settings/': 'a modifié les paramètres',
  'POST /api/shift-templates/': 'a créé un horaire type',
  'PUT /api/shift-templates/:id': 'a modifié un horaire type',
  'DELETE /api/shift-templates/:id': 'a supprimé un horaire type',
  'POST /api/week-templates/': 'a enregistré une semaine type',
  'PUT /api/week-templates/:id': 'a modifié une semaine type',
  'DELETE /api/week-templates/:id': 'a supprimé une semaine type',
  'POST /api/visits/': null, // compteur de visites : pas dans le journal
  'POST /api/week-templates/apply': 'a rempli une semaine (semaine type ou copie)',
  'POST /api/week-templates/clear': 'a vidé une semaine du planning',
  EMAIL: 'e-mail envoyé',
};

// Libellés différents quand l'action a été refusée
const REFUSED_LABELS = {
  'POST /api/auth/login': 'connexion refusée',
};

const labelOf = (action, status) => {
  if (status === 'refused' && REFUSED_LABELS[action]) return REFUSED_LABELS[action];
  if (Object.prototype.hasOwnProperty.call(ACTION_LABELS, action) && ACTION_LABELS[action]) {
    return ACTION_LABELS[action];
  }
  if (action.startsWith('GET ')) return `a ouvert ${action.slice(4)}`;
  return action;
};

const statusOf = (httpStatus) => (httpStatus >= 500 ? 'error' : httpStatus >= 400 ? 'refused' : 'ok');

// Enregistrement « au mieux » : une panne du journal ne doit jamais faire
// échouer l'action de l'utilisateur.
const logActivity = ({ companyId = null, userId = null, role = null, action, status, httpStatus = null, durationMs = null }) => {
  db.query(
    `INSERT INTO activity_log (company_id, user_id, actor_role, action, status, http_status, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [companyId, userId, role, action, status, httpStatus, durationMs]
  ).catch((err) => console.error('Journal des actions :', err.message));
};

// ── Temps de réponse : compteurs en mémoire, par minute, sur 24 h ──────
// (remis à zéro au redémarrage du serveur, suffisant pour une tendance)
const minuteStats = new Map(); // minute (ms) -> { count, totalMs }
const recordTiming = (ms) => {
  const minute = Math.floor(Date.now() / 60000) * 60000;
  const s = minuteStats.get(minute) ?? { count: 0, totalMs: 0 };
  s.count += 1;
  s.totalMs += ms;
  minuteStats.set(minute, s);
  const oldest = Date.now() - 24 * 3600 * 1000;
  for (const key of minuteStats.keys()) {
    if (key < oldest) minuteStats.delete(key); else break;
  }
};
// Courbe heure par heure sur 24 h : nombre de requêtes et temps moyen
const getTimingSeries = () => {
  const hourNow = Math.floor(Date.now() / 3600000) * 3600000;
  const buckets = [];
  for (let i = 23; i >= 0; i -= 1) buckets.push({ hour: new Date(hourNow - i * 3600000).toISOString(), count: 0, totalMs: 0 });
  for (const [minute, s] of minuteStats) {
    const idx = 23 - Math.floor((hourNow - Math.floor(minute / 3600000) * 3600000) / 3600000);
    if (idx >= 0 && idx < 24) { buckets[idx].count += s.count; buckets[idx].totalMs += s.totalMs; }
  }
  return buckets.map((b) => ({ hour: b.hour, count: b.count, avg_ms: b.count ? Math.round(b.totalMs / b.count) : null }));
};
const getTimingStats = () => {
  let count = 0, totalMs = 0;
  for (const s of minuteStats.values()) { count += s.count; totalMs += s.totalMs; }
  return { requests: count, avgMs: count ? Math.round(totalMs / count) : null };
};

// ── Middleware : à monter avant les routes ─────────────────────────────
// Journalise les actions qui modifient quelque chose (et toute erreur
// serveur), une fois la réponse envoyée, avec l'auteur identifié par la
// route (req.user) ou par la connexion (res.locals.actor).
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const activityMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - start) / 1000000n);
    if (req.originalUrl.startsWith('/api/health')) return;
    recordTiming(durationMs);

    if (!req.route) return; // aucune route trouvée (404)
    const action = `${req.method} ${req.baseUrl}${req.route.path}`;
    const isWrite = WRITE_METHODS.has(req.method);
    if (!isWrite && res.statusCode < 500) return;
    if (Object.prototype.hasOwnProperty.call(ACTION_LABELS, action) && ACTION_LABELS[action] === null) return;

    const actor = req.user ?? res.locals.actor ?? {};
    if (actor.role === 'owner') return; // le propriétaire ne se journalise pas lui-même
    logActivity({
      companyId: actor.companyId ?? null,
      userId: actor.role === 'owner' ? null : (actor.id ?? null),
      role: actor.role ?? null,
      action,
      status: statusOf(res.statusCode),
      httpStatus: res.statusCode,
      durationMs,
    });
  });
  next();
};

// ── Purge à 90 jours : au démarrage puis toutes les 6 heures ───────────
const purgeOldActivity = () => db.query(
  `DELETE FROM activity_log WHERE created_at < NOW() - make_interval(days => $1)`,
  [RETENTION_DAYS]
).catch((err) => console.error('Purge du journal :', err.message));

const startActivityPurge = () => {
  purgeOldActivity();
  setInterval(purgeOldActivity, 6 * 3600 * 1000).unref();
};

module.exports = {
  RETENTION_DAYS, labelOf, logActivity, activityMiddleware, startActivityPurge, getTimingStats, getTimingSeries,
};
