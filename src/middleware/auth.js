const jwt = require('jsonwebtoken');

// Vérifie que le token JWT est valide
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant ou invalide.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role, companyId }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token expiré ou invalide.' });
  }
};

module.exports = authMiddleware;
