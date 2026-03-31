const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const ctrl    = require('../controllers/leaves.controller');

router.use(auth); // Toutes les routes nécessitent d'être connecté

// ── Employé ───────────────────────────────────────────
router.get ('/balance',                  ctrl.getMyBalance);    // Mon solde
router.get ('/my-requests',             ctrl.getMyRequests);   // Mes demandes
router.post('/request',                 ctrl.submitRequest);   // Soumettre une demande
router.get ('/notifications',           ctrl.getNotifications); // Mes notifications
router.patch('/notifications/read-all', ctrl.markAllRead);     // Marquer tout lu

// ── Admin ─────────────────────────────────────────────
router.get  ('/admin/requests',          isAdmin, ctrl.getAllRequests);      // Toutes les demandes
router.patch('/admin/requests/:id',      isAdmin, ctrl.reviewRequest);       // Approuver / refuser
router.get  ('/admin/balances/:userId',  isAdmin, ctrl.getEmployeeBalance);  // Solde d'un employé

module.exports = router;
