const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const ctrl    = require('../controllers/schedule.controller');

router.use(auth);

// ── Employé ───────────────────────────────────────────
router.get('/my', ctrl.getMySchedule);              // Mon planning perso

// ── Admin ─────────────────────────────────────────────
router.get ('/admin',      isAdmin, ctrl.getAdminSchedule); // Planning tous employés
router.post('/',           isAdmin, ctrl.createShift);      // Créer un créneau
router.put ('/:id',        isAdmin, ctrl.updateShift);      // Modifier un créneau
router.delete('/:id',      isAdmin, ctrl.deleteShift);      // Supprimer un créneau

module.exports = router;
