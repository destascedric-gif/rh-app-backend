const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const ctrl    = require('../controllers/settings.controller');

router.use(auth);

// Lecture ouverte à tout utilisateur connecté (pour appliquer la personnalisation),
// écriture réservée à l'admin.
router.get('/', ctrl.getSettings);
router.put('/', isAdmin, ctrl.updateSettings);

module.exports = router;
