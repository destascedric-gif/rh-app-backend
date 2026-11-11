const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { createPresenceRuleSchema } = require('../validators/presenceRules.validators');
const ctrl     = require('../controllers/presenceRules.controller');

// Règles de présence par poste : réservées au gérant
router.use(auth, isAdmin);

router.get   ('/',    ctrl.getPresenceRules);
router.post  ('/',    validate(createPresenceRuleSchema), ctrl.createPresenceRule);
router.delete('/:id', ctrl.deletePresenceRule);

module.exports = router;
