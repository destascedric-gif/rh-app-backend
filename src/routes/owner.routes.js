const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isOwner  = require('../middleware/isOwner');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { ownerSetupSchema } = require('../validators/owner.validators');
const ctrl     = require('../controllers/owner.controller');

// Choix du mot de passe depuis le lien reçu par e-mail (sans session)
router.post('/setup', authLimiter, validate(ownerSetupSchema), ctrl.setupPassword);

// Page de pilotage : propriétaire d'Orgaly uniquement
router.get('/stats', auth, isOwner, ctrl.getStats);

module.exports = router;
