// Express 4 ne voit pas les erreurs des fonctions « async » qui échouent en
// dehors de leur try/catch : la promesse rejetée n'était rattrapée par
// personne, la requête restait sans réponse et, sans Sentry (serveurs
// d'essai), le serveur entier s'arrêtait (vu lors de l'audit du 28 nov.
// 2026 : un identifiant mal formé envoyé à POST /api/schedule suffisait).
// Ce module transmet ces erreurs au gestionnaire d'erreurs d'Express
// (réponse 500 propre), comme le fait le paquet express-async-errors.
// À charger une seule fois, avant la déclaration des routes (server.js).
const Layer = require('express/lib/router/layer');

const forward = (ret, next) => {
  if (ret && typeof ret.then === 'function') {
    ret.then(undefined, (err) => next(err || new Error('Erreur inconnue')));
  }
};

// Mêmes fonctions qu'Express 4 (express/lib/router/layer.js), avec en plus
// la transmission des promesses rejetées.
Layer.prototype.handle_request = function handle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next();
  try {
    forward(fn(req, res, next), next);
  } catch (err) {
    next(err);
  }
};

Layer.prototype.handle_error = function handleError(error, req, res, next) {
  const fn = this.handle;
  if (fn.length !== 4) return next(error);
  try {
    forward(fn(error, req, res, next), next);
  } catch (err) {
    next(err);
  }
};
