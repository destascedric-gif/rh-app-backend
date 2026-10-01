const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { checkoutSchema } = require('../validators/billing.validators');
const ctrl     = require('../controllers/billing.controller');

// Le webhook Stripe (corps brut, sans token) est monté à part dans server.js,
// avant express.json() qui détruirait le corps nécessaire à la vérification
// de signature.

router.use(auth, isAdmin);

router.get ('/',         ctrl.getBilling);
router.post('/checkout', validate(checkoutSchema), ctrl.createCheckoutSession);
router.post('/portal',   ctrl.createPortalSession);

module.exports = router;
