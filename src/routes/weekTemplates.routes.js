const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const {
  createWeekTemplateSchema, updateWeekTemplateSchema, applyWeekTemplateSchema, clearWeekSchema,
} = require('../validators/weekTemplates.validators');
const ctrl     = require('../controllers/weekTemplates.controller');

// Semaines types du planning : réservées au gérant
router.use(auth, isAdmin);

router.get   ('/',      ctrl.getWeekTemplates);
router.post  ('/apply', validate(applyWeekTemplateSchema), ctrl.applyWeekTemplate);
router.post  ('/clear', validate(clearWeekSchema), ctrl.clearWeek);
router.post  ('/',      validate(createWeekTemplateSchema), ctrl.createWeekTemplate);
router.put   ('/:id',   validate(updateWeekTemplateSchema), ctrl.updateWeekTemplate);
router.delete('/:id',   ctrl.deleteWeekTemplate);

module.exports = router;
