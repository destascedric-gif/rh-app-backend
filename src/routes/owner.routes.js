const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isOwner  = require('../middleware/isOwner');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { ownerSetupSchema } = require('../validators/owner.validators');
const { creditEventSchema } = require('../validators/owner.ai.validators');
const ctrl     = require('../controllers/owner.controller');

// Choix du mot de passe depuis le lien reçu par e-mail (sans session)
router.post('/setup', authLimiter, validate(ownerSetupSchema), ctrl.setupPassword);

// Page de pilotage : propriétaire d'Orgaly uniquement
router.get('/stats', auth, isOwner, ctrl.getStats);
router.get('/activity', auth, isOwner, ctrl.getActivity);
router.get('/health', auth, isOwner, ctrl.getHealth);
router.get('/companies/:id', auth, isOwner, ctrl.getCompany);
// Intelligence artificielle (dépenses, crédit estimé) et visites du site
router.get('/ai', auth, isOwner, ctrl.getAi);
router.post('/ai/credit', auth, isOwner, validate(creditEventSchema), ctrl.addAiCredit);
router.delete('/ai/credit/:id', auth, isOwner, ctrl.deleteAiCredit);
router.get('/visits', auth, isOwner, ctrl.getVisits);

module.exports = router;
