const express   = require('express');
const rateLimit = require('express-rate-limit');
const { trackVisit } = require('../services/visits.service');

const router = express.Router();

// Compteur de visites des pages publiques (sans session, sans cookie) ;
// limite large pour un même visiteur, juste contre l'abus
const visitsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de requêtes.' },
});

router.post('/', visitsLimiter, trackVisit);

module.exports = router;
