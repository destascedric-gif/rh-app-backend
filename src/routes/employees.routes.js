const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const {
  updateEmployeeSchema,
  addDocumentSchema,
  timesheetSchema,
  updateTimesheetSchema,
  reviewTimesheetSchema,
} = require('../validators/employees.validators');
const ctrl     = require('../controllers/employees.controller');

// Toutes les routes nécessitent d'être connecté
router.use(auth);

// ── Auto-service pointage (l'employé gère ses propres heures) ──
// Déclarées avant "/:id" pour ne pas être capturées par ce paramètre.
router.get   ('/me/timesheets',                ctrl.getMyTimesheets);
router.post  ('/me/timesheets',                validate(timesheetSchema), ctrl.addMyTimesheet);
router.put   ('/me/timesheets/:timesheetId',   validate(updateTimesheetSchema), ctrl.updateMyTimesheet);
router.delete('/me/timesheets/:timesheetId',   ctrl.deleteMyTimesheet);

// Pointages en attente de validation, toute l'entreprise (tableau de bord)
router.get   ('/timesheets/pending', isAdmin, ctrl.getPendingTimesheets);

// ── Liste & fiche ──────────────────────────────────────
router.get   ('/',    isAdmin, ctrl.getEmployees);        // Liste tous les employés
router.get   ('/:id', isAdmin, ctrl.getEmployee);         // Fiche détaillée
router.put   ('/:id', isAdmin, validate(updateEmployeeSchema), ctrl.updateEmployee); // Modifier la fiche
router.delete('/:id', isAdmin, ctrl.deactivateEmployee);  // Désactiver (soft delete)
router.put   ('/:id/reactivate', isAdmin, ctrl.reactivateEmployee); // Réactiver

// ── Onglets de la fiche ───────────────────────────────
router.get   ('/:id/payslips',   isAdmin, ctrl.getPayslips);   // Bulletins de paie
router.get   ('/:id/documents',  isAdmin, ctrl.getDocuments);  // Documents
router.post  ('/:id/documents',  isAdmin, validate(addDocumentSchema), ctrl.addDocument);   // Ajouter un doc
router.get   ('/:id/timesheets', isAdmin, ctrl.getTimesheets); // Pointage
router.post  ('/:id/timesheets', isAdmin, validate(timesheetSchema), ctrl.addTimesheet);  // Ajouter une entrée
router.put   ('/:id/timesheets/:timesheetId', isAdmin, validate(updateTimesheetSchema), ctrl.updateTimesheet); // Modifier une entrée
router.delete('/:id/timesheets/:timesheetId', isAdmin, ctrl.deleteTimesheet); // Supprimer une entrée
router.patch ('/:id/timesheets/:timesheetId/status', isAdmin, validate(reviewTimesheetSchema), ctrl.reviewTimesheet); // Valider/refuser
router.get   ('/:id/monthly-summary', isAdmin, ctrl.getMonthlySummary); // Récap mensuel

module.exports = router;
