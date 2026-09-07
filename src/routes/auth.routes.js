const express      = require('express');
const router       = express.Router();
const auth         = require('../middleware/auth');
const isAdmin      = require('../middleware/isAdmin');
const { authLimiter } = require('../middleware/rateLimit');
const validate      = require('../middleware/validate');
const {
  setupAdminSchema,
  setupCompanySchema,
  loginSchema,
  inviteEmployeeSchema,
  acceptInviteSchema,
  changePasswordSchema,
} = require('../validators/auth.validators');
const ctrl         = require('../controllers/auth.controller');

// ── Inscription d'une nouvelle entreprise (pas de token requis) ──
router.post('/setup/admin',    authLimiter, validate(setupAdminSchema),   ctrl.setupAdmin);   // Étape 1 : créer l'admin
router.post('/setup/company',  auth, validate(setupCompanySchema),        ctrl.setupCompany); // Étape 2 : infos entreprise

// ── Connexion ─────────────────────────────────────────
router.post('/login', authLimiter, validate(loginSchema), ctrl.login);

// ── Compte (utilisateur connecté) ────────────────────
router.put('/change-password', auth, validate(changePasswordSchema), ctrl.changePassword);

// ── Invitations (admin seulement) ────────────────────
router.post('/invite',              auth, isAdmin, validate(inviteEmployeeSchema), ctrl.inviteEmployee); // Créer + inviter un employé
router.post('/invite/:id/resend',   auth, isAdmin, ctrl.resendInvite);                                    // Renvoyer l'invitation
router.post('/accept-invite',       authLimiter, validate(acceptInviteSchema), ctrl.acceptInvite);        // Employé crée son mdp

module.exports = router;
