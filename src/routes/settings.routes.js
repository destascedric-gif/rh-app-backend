const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { updateSettingsSchema } = require('../validators/settings.validators');
const ctrl     = require('../controllers/settings.controller');

router.use(auth);

// Lecture ouverte à tout utilisateur connecté (pour appliquer la personnalisation),
// écriture réservée à l'admin.
router.get('/', ctrl.getSettings);
router.put('/', isAdmin, validate(updateSettingsSchema), ctrl.updateSettings);

module.exports = router;
