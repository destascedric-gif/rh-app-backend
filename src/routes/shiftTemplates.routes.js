const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { shiftTemplateSchema } = require('../validators/shiftTemplates.validators');
const ctrl     = require('../controllers/shiftTemplates.controller');

router.use(auth);
router.use(isAdmin); // seul l'admin crée les créneaux, donc seul lui gère les modèles

router.get   ('/',    ctrl.getShiftTemplates);
router.post  ('/',    validate(shiftTemplateSchema), ctrl.createShiftTemplate);
router.put   ('/:id', validate(shiftTemplateSchema), ctrl.updateShiftTemplate);
router.delete('/:id', ctrl.deleteShiftTemplate);

module.exports = router;
