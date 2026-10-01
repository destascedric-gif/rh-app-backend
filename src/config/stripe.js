const Stripe = require('stripe');

// Sans clé, la facturation est simplement désactivée (dev local, ou avant
// l'ouverture du compte Stripe) : tout le monde reste sur le plan gratuit.
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

module.exports = stripe;
