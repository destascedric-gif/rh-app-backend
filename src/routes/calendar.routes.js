const express   = require('express');
const rateLimit = require('express-rate-limit');
const auth      = require('../middleware/auth');
const ctrl      = require('../controllers/calendar.controller');

const router = express.Router();

// Lien personnel de la personne connectée
router.get('/link', auth, ctrl.getLink);
router.post('/link/reset', auth, ctrl.resetLink);

// Fichier d'agenda lu par Google, Apple… (sans session) ; limite large :
// les serveurs de Google lisent les agendas de plusieurs personnes
const feedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de requêtes.',
});
router.get('/:file', feedLimiter, ctrl.feed);

module.exports = router;
