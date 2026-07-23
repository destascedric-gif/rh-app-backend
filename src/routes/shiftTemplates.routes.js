const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const ctrl    = require('../controllers/shiftTemplates.controller');

router.use(auth);
router.use(isAdmin); // seul l'admin crée les créneaux, donc seul lui gère les modèles

router.get   ('/',    ctrl.getShiftTemplates);
router.post  ('/',    ctrl.createShiftTemplate);
router.put   ('/:id', ctrl.updateShiftTemplate);
router.delete('/:id', ctrl.deleteShiftTemplate);

module.exports = router;
