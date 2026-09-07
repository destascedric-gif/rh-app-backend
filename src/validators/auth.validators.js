const { z } = require('zod');
const { requiredString, optionalText, email } = require('./common');

const password = (label = 'Le mot de passe') => {
  const message = `${label} doit faire au moins 8 caractères.`;
  return z.string({ error: message }).min(8, message);
};

const setupAdminSchema = z.object({
  firstName: requiredString('Le prénom'),
  lastName:  requiredString('Le nom'),
  email:     email(),
  password:  password(),
  phone:     optionalText(),
});

const setupCompanySchema = z.object({
  name:       requiredString('Le nom de l\'entreprise'),
  siret:      optionalText(),
  address:    optionalText(),
  city:       optionalText(),
  postalCode: optionalText(),
  sector:     optionalText(),
});

const loginSchema = z.object({
  email:    email(),
  password: requiredString('Le mot de passe'),
});

const inviteEmployeeSchema = z.object({
  firstName:   requiredString('Le prénom'),
  lastName:    requiredString('Le nom'),
  email:       email(),
  jobTitle:    optionalText(),
  hireDate:    optionalText(),
  grossSalary: z.union([z.number(), z.string()]).optional(),
  workTime:    optionalText(),
  weeklyHours: z.union([z.number(), z.string()]).optional(),
});

const acceptInviteSchema = z.object({
  token:    requiredString('Le token'),
  password: password(),
});

const changePasswordSchema = z.object({
  currentPassword: requiredString('Le mot de passe actuel'),
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
