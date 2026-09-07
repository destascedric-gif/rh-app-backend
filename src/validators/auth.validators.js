const { z } = require('zod');

// z.string({ error }) couvre le champ absent/mauvais type ; .min(1, error)
// couvre la chaîne vide — même message français dans les deux cas plutôt
// que le message générique de zod ("expected string, received undefined").
const required = (label) => {
  const message = `${label} est obligatoire.`;
  return z.string({ error: message }).trim().min(1, message);
};
const optionalText = () => z.string().trim().optional().or(z.literal(''));
const email = () => {
  const message = 'Email invalide.';
  return z.string({ error: message }).trim().toLowerCase().email(message);
};
const password = (label = 'Le mot de passe') => {
  const message = `${label} doit faire au moins 8 caractères.`;
  return z.string({ error: message }).min(8, message);
};

const setupAdminSchema = z.object({
  firstName: required('Le prénom'),
  lastName:  required('Le nom'),
  email:     email(),
  password:  password(),
  phone:     optionalText(),
});

const setupCompanySchema = z.object({
  name:       required('Le nom de l\'entreprise'),
  siret:      optionalText(),
  address:    optionalText(),
  city:       optionalText(),
  postalCode: optionalText(),
  sector:     optionalText(),
});

const loginSchema = z.object({
  email:    email(),
  password: required('Le mot de passe'),
});

const inviteEmployeeSchema = z.object({
  firstName:   required('Le prénom'),
  lastName:    required('Le nom'),
  email:       email(),
  jobTitle:    optionalText(),
  hireDate:    optionalText(),
  grossSalary: z.union([z.number(), z.string()]).optional(),
  workTime:    optionalText(),
  weeklyHours: z.union([z.number(), z.string()]).optional(),
});

const acceptInviteSchema = z.object({
  token:    required('Le token'),
  password: password(),
});

const changePasswordSchema = z.object({
  currentPassword: required('Le mot de passe actuel'),
  newPassword:     password('Le nouveau mot de passe'),
});

module.exports = {
  setupAdminSchema,
  setupCompanySchema,
  loginSchema,
  inviteEmployeeSchema,
  acceptInviteSchema,
  changePasswordSchema,
};
