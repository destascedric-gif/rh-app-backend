const express   = require('express');
const rateLimit = require('express-rate-limit');
const { trackVisit, forgetVisits } = require('../services/visits.service');

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
// « Ne pas compter cet appareil » : retire ses visites du jour
router.post('/forget', visitsLimiter, forgetVisits);

module.exports = router;
