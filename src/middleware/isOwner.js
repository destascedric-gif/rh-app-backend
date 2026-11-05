const db = require('../config/db');

// À utiliser APRÈS authMiddleware : réservé au propriétaire d'Orgaly
// (page de pilotage). Le compte est revérifié en base à chaque appel, pour
// qu'un accès retiré le soit immédiatement.
const isOwner = async (req, res, next) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ message: 'Accès réservé au propriétaire d\'Orgaly.' });
  }
  try {
    const result = await db.query(
      'SELECT 1 FROM platform_owners WHERE id = $1 AND password_hash IS NOT NULL',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'Accès réservé au propriétaire d\'Orgaly.' });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = isOwner;
