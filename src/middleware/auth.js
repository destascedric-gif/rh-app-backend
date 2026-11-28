const jwt = require('jsonwebtoken');
const db  = require('../config/db');

// Vérifie que le token JWT est valide, puis (audit du 28 nov. 2026) que le
// compte existe toujours et n'a pas été désactivé : avant, un salarié retiré
// de l'équipe gardait l'accès jusqu'à 7 jours sur un appareil déjà connecté
// (planning, congés…). Le propriétaire d'Orgaly est revérifié par isOwner.
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant ou invalide.' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Token expiré ou invalide.' });
  }

  if (decoded.role !== 'owner') {
    try {
      const row = (await db.query('SELECT is_active FROM users WHERE id = $1', [decoded.id])).rows[0];
      if (!row || !row.is_active) {
        return res.status(401).json({ message: 'Ce compte a été désactivé. Contactez votre responsable.' });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Erreur serveur.' });
    }
  }

  req.user = decoded; // { id, email, role, companyId }
  next();
};

module.exports = authMiddleware;
