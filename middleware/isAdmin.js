// À utiliser APRÈS authMiddleware
// Bloque l'accès si l'utilisateur n'est pas admin
const isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Accès réservé à l\'administrateur.' });
  }
  next();
};

module.exports = isAdmin;
