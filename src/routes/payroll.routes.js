const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { generatePayslipSchema, generateAllPayslipsSchema } = require('../validators/payroll.validators');
const ctrl     = require('../controllers/payroll.controller');

// Toutes les routes paie sont réservées à l'admin
router.use(auth, isAdmin);

router.get ('/',                  ctrl.getAllPayslips);      // Liste tous les bulletins
router.post('/generate',          validate(generatePayslipSchema), ctrl.generatePayslip);    // Générer un bulletin (+ PDF)
router.post('/generate-all',      validate(generateAllPayslipsSchema), ctrl.generateAllPayslips); // Générer pour tous les employés
router.get ('/:id/pdf',           ctrl.downloadPayslip);    // Télécharger un bulletin existant
router.delete('/:id',             ctrl.deletePayslip);      // Supprimer un bulletin

module.exports = router;
