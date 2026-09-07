const rateLimit = require('express-rate-limit');

// Endpoints d'auth accessibles sans session (inscription, connexion,
// activation d'invitation) — cible directe du brute-force et du spam de
// création de comptes maintenant que l'inscription est ouverte à tous.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});

module.exports = { authLimiter };
