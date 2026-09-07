const express      = require('express');
const router       = express.Router();
const auth         = require('../middleware/auth');
const isAdmin      = require('../middleware/isAdmin');
const { authLimiter } = require('../middleware/rateLimit');
const ctrl         = require('../controllers/auth.controller');

// ── Inscription d'une nouvelle entreprise (pas de token requis) ──
router.post('/setup/admin',    authLimiter, ctrl.setupAdmin);        // Étape 1 : créer l'admin
router.post('/setup/company',  auth, ctrl.setupCompany);              // Étape 2 : infos entreprise

// ── Connexion ─────────────────────────────────────────
router.post('/login', authLimiter, ctrl.login);

// ── Compte (utilisateur connecté) ────────────────────
router.put('/change-password', auth, ctrl.changePassword);

// ── Invitations (admin seulement) ────────────────────
router.post('/invite',              auth, isAdmin, ctrl.inviteEmployee); // Créer + inviter un employé
router.post('/invite/:id/resend',   auth, isAdmin, ctrl.resendInvite);   // Renvoyer l'invitation
router.post('/accept-invite',       authLimiter, ctrl.acceptInvite);     // Employé crée son mdp

module.exports = router;
