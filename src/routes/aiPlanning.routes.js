const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { confirmContractSchema, generateSchema, applySchema } = require('../validators/aiPlanning.validators');
const ctrl     = require('../controllers/aiPlanning.controller');

// Planning généré par IA : réservé au gérant, et aux entreprises qui y ont
// accès (company.ai_planning_enabled : démo et SAS LLDB au départ)
router.use(auth, isAdmin, ctrl.requireAiAccess);

router.get ('/facts',            ctrl.getFacts);
router.post('/confirm-contract', validate(confirmContractSchema), ctrl.confirmContract);
router.post('/generate',         validate(generateSchema), ctrl.generate);   // proposition, rien n'est écrit
router.post('/apply',            validate(applySchema), ctrl.apply);         // écrit la proposition validée

module.exports = router;
