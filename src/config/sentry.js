// Doit être importé avant tout le reste (express compris) pour que
// l'instrumentation automatique de Sentry capte bien les requêtes.
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Serveurs d'essai locaux (.claude/run-backend-test*.cmd) : SENTRY_DISABLED=1.
  // (Un « set SENTRY_DSN= » vide ne suffit pas : Windows efface la variable
  // et dotenv la reprend dans .env — d'où la fausse alerte du 24 nov. 2026.)
  enabled: process.env.SENTRY_DISABLED !== '1',
  environment: process.env.NODE_ENV || 'development',
  sendDefaultPii: false, // pas d'IP/headers/cookies par défaut (données RH sensibles)
  // Les controllers attrapent systématiquement leurs erreurs eux-mêmes
  // (console.error + res.status(500)) sans jamais faire next(err) — sans
  // cette intégration, le handler Express ci-dessous ne verrait presque
  // jamais rien passer.
  integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
});

module.exports = Sentry;
