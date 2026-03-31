const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const ctrl     = require('../controllers/employees.controller');

// Toutes les routes nécessitent d'être connecté
router.use(auth);

// ── Liste & fiche ──────────────────────────────────────
router.get ('/',    isAdmin, ctrl.getEmployees);        // Liste tous les employés
router.get ('/:id', isAdmin, ctrl.getEmployee);         // Fiche détaillée
router.put ('/:id', isAdmin, ctrl.updateEmployee);      // Modifier la fiche
router.delete('/:id', isAdmin, ctrl.deactivateEmployee); // Désactiver (soft delete)

// ── Onglets de la fiche ───────────────────────────────
router.get ('/:id/payslips',   isAdmin, ctrl.getPayslips);   // Bulletins de paie
router.get ('/:id/documents',  isAdmin, ctrl.getDocuments);  // Documents
router.post('/:id/documents',  isAdmin, ctrl.addDocument);   // Ajouter un doc
router.get ('/:id/timesheets', isAdmin, ctrl.getTimesheets); // Pointage

module.exports = router;
