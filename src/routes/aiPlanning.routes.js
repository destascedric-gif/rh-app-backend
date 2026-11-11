const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { confirmContractSchema } = require('../validators/aiPlanning.validators');
const ctrl     = require('../controllers/aiPlanning.controller');

// Planning généré par IA : réservé au gérant
router.use(auth, isAdmin);

router.get ('/facts',            ctrl.getFacts);
router.post('/confirm-contract', validate(confirmContractSchema), ctrl.confirmContract);

module.exports = router;
