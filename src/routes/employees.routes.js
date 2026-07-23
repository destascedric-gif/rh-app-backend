const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const ctrl     = require('../controllers/employees.controller');

// Toutes les routes nécessitent d'être connecté
router.use(auth);

// ── Auto-service pointage (l'employé gère ses propres heures) ──
// Déclarées avant "/:id" pour ne pas être capturées par ce paramètre.
router.get   ('/me/timesheets',                ctrl.getMyTimesheets);
router.post  ('/me/timesheets',                ctrl.addMyTimesheet);
router.put   ('/me/timesheets/:timesheetId',   ctrl.updateMyTimesheet);
router.delete('/me/timesheets/:timesheetId',   ctrl.deleteMyTimesheet);

// ── Liste & fiche ──────────────────────────────────────
router.get   ('/',    isAdmin, ctrl.getEmployees);        // Liste tous les employés
router.get   ('/:id', isAdmin, ctrl.getEmployee);         // Fiche détaillée
router.put   ('/:id', isAdmin, ctrl.updateEmployee);      // Modifier la fiche
router.delete('/:id', isAdmin, ctrl.deactivateEmployee);  // Désactiver (soft delete)
router.put   ('/:id/reactivate', isAdmin, ctrl.reactivateEmployee); // Réactiver

// ── Onglets de la fiche ───────────────────────────────
router.get   ('/:id/payslips',   isAdmin, ctrl.getPayslips);   // Bulletins de paie
router.get   ('/:id/documents',  isAdmin, ctrl.getDocuments);  // Documents
router.post  ('/:id/documents',  isAdmin, ctrl.addDocument);   // Ajouter un doc
router.get   ('/:id/timesheets', isAdmin, ctrl.getTimesheets); // Pointage
router.post  ('/:id/timesheets', isAdmin, ctrl.addTimesheet);  // Ajouter une entrée
router.put   ('/:id/timesheets/:timesheetId', isAdmin, ctrl.updateTimesheet); // Modifier une entrée
router.delete('/:id/timesheets/:timesheetId', isAdmin, ctrl.deleteTimesheet); // Supprimer une entrée
router.patch ('/:id/timesheets/:timesheetId/status', isAdmin, ctrl.reviewTimesheet); // Valider/refuser
router.get   ('/:id/monthly-summary', isAdmin, ctrl.getMonthlySummary); // Récap mensuel

module.exports = router;
