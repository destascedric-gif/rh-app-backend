// Doit être importé avant tout le reste (express compris) pour que
// l'instrumentation automatique de Sentry capte bien les requêtes.
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  sendDefaultPii: false, // pas d'IP/headers/cookies par défaut (données RH sensibles)
  // Les controllers attrapent systématiquement leurs erreurs eux-mêmes
  // (console.error + res.status(500)) sans jamais faire next(err) — sans
  // cette intégration, le handler Express ci-dessous ne verrait presque
  // jamais rien passer.
  integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
});

module.exports = Sentry;
