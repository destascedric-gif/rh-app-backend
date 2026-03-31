const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const ctrl    = require('../controllers/payroll.controller');

// Toutes les routes paie sont réservées à l'admin
router.use(auth, isAdmin);

router.get ('/',                  ctrl.getAllPayslips);      // Liste tous les bulletins
router.post('/generate',          ctrl.generatePayslip);    // Générer un bulletin (+ PDF)
router.post('/generate-all',      ctrl.generateAllPayslips); // Générer pour tous les employés
router.get ('/:id/pdf',           ctrl.downloadPayslip);    // Télécharger un bulletin existant
router.delete('/:id',             ctrl.deletePayslip);      // Supprimer un bulletin

module.exports = router;
