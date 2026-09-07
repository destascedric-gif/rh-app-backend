// Valide req.body contre un schéma zod ; renvoie 400 avec le premier message
// d'erreur si invalide, sinon remplace req.body par la version normalisée
// (trim, casse email, etc.) et passe la main.
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const message = result.error.issues[0]?.message || 'Requête invalide.';
    return res.status(400).json({ message });
  }

  req.body = result.data;
  next();
};

module.exports = validate;
