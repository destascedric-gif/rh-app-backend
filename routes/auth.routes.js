const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const ctrl     = require('../controllers/auth.controller');

// ── Setup initial (pas de token requis) ───────────────
router.get ('/setup-status',   ctrl.getSetupStatus);   // App déjà configurée ?
router.post('/setup/admin',    ctrl.setupAdmin);        // Étape 1 : créer l'admin
router.post('/setup/company',  auth, ctrl.setupCompany); // Étape 2 : infos entreprise

// ── Connexion ─────────────────────────────────────────
router.post('/login', ctrl.login);

// ── Invitations (admin seulement) ────────────────────
router.post('/invite',         auth, isAdmin, ctrl.inviteEmployee); // Créer + inviter un employé
router.post('/accept-invite',  ctrl.acceptInvite);                  // Employé crée son mdp

module.exports = router;
