const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../config/db');
const { sendMail, FRONTEND_URL } = require('../config/mailer');
const { CGU_VERSION } = require('../config/legal');
const { checkEmployeeLimit, syncSubscriptionQuantity } = require('../services/billing.service');

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────

// Génère un JWT pour un utilisateur
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, companyId: user.company_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Envoi de l'email d'invitation
const sendInviteEmail = async (email, firstName, inviteToken) => {
  const inviteUrl = `${FRONTEND_URL}/accept-invite?token=${inviteToken}`;

  await sendMail({
    to: email,
    subject: 'Bienvenue — Créez votre accès RH',
    html: `
      <h2>Bonjour ${firstName},</h2>
      <p>Votre compte a été créé. Cliquez sur le lien ci-dessous pour définir votre mot de passe :</p>
      <a href="${inviteUrl}" style="
        display:inline-block;padding:12px 24px;background:#4F46E5;
        color:#fff;border-radius:6px;text-decoration:none;font-weight:bold
      ">Créer mon mot de passe</a>
      <p style="color:#888;font-size:12px">Ce lien est valable 48 heures.</p>
    `,
  });
};

// ─────────────────────────────────────────────
// ÉTAPE 1 : CRÉATION DU COMPTE ADMIN (inscription d'une nouvelle entreprise)
// ─────────────────────────────────────────────

// POST /api/auth/setup/admin
const setupAdmin = async (req, res) => {
  const { firstName, lastName, email, password, phone } = req.body;

  try {
    // Vérifie que l'email n'existe pas déjà
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    // Hash du mot de passe
    const passwordHash = await bcrypt.hash(password, 12);

    // Création de l'admin (sans company_id pour l'instant)
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, phone, invite_accepted,
                          cgu_accepted_at, cgu_version)
       VALUES ($1, $2, $3, $4, 'admin', $5, TRUE, NOW(), $6)
       RETURNING id, email, role`,
      [firstName, lastName, email, passwordHash, phone, CGU_VERSION]
    );

    const admin = result.rows[0];

    // On retourne un token temporaire pour continuer le setup
    const token = generateToken({ ...admin, company_id: null });

    res.status(201).json({ message: 'Compte admin créé.', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ÉTAPE 2 : INFORMATIONS ENTREPRISE
// ─────────────────────────────────────────────

// POST /api/auth/setup/company
const setupCompany = async (req, res) => {
  const { name, siret, address, city, postalCode, sector } = req.body;
  const adminId = req.user.id;

  // SIRET optionnel : une chaîne vide viole la contrainte UNIQUE dès qu'une
  // deuxième entreprise le laisse aussi vide (NULL, lui, n'entre jamais en
  // conflit avec un autre NULL).
  const cleanSiret = siret && siret.trim() ? siret.trim() : null;

  try {
    // Création de l'entreprise
    const companyResult = await db.query(
      `INSERT INTO company (name, siret, address, city, postal_code, sector)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, cleanSiret, address, city, postalCode, sector]
    );

    const companyId = companyResult.rows[0].id;

    // Rattachement de l'admin à l'entreprise
    await db.query(
      'UPDATE users SET company_id = $1 WHERE id = $2',
      [companyId, adminId]
    );

    // Nouveau token avec companyId
    const userResult = await db.query('SELECT * FROM users WHERE id = $1', [adminId]);
    const admin = userResult.rows[0];
    const token = generateToken(admin);

    res.status(201).json({
      message: 'Entreprise créée.',
      token,
      companyId,
      user: {
        id: admin.id,
        firstName: admin.first_name,
        lastName: admin.last_name,
        email: admin.email,
        role: admin.role,
        companyId: admin.company_id,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// CONNEXION
// ─────────────────────────────────────────────

// POST /api/auth/login
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Identifiants incorrects.' });
    }

    if (!user.invite_accepted) {
      return res.status(403).json({ message: 'Vous devez d\'abord accepter votre invitation.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Identifiants incorrects.' });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// INVITATIONS EMPLOYÉS
// ─────────────────────────────────────────────

// POST /api/auth/invite — Créer un employé et envoyer l'invitation
const inviteEmployee = async (req, res) => {
  const { firstName, lastName, email, jobTitle, hireDate, grossSalary, workTime, weeklyHours } = req.body;
  const companyId = req.user.companyId;

  try {
    // Vérifie que l'email n'existe pas déjà
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    const limitError = await checkEmployeeLimit(companyId);
    if (limitError) {
      return res.status(403).json({ message: limitError, code: 'PLAN_LIMIT' });
    }

    // Génère un token d'invitation unique (valable 48h)
    const inviteToken  = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Heures hebdo par défaut = politique de l'entreprise si non précisées
    let effectiveWeeklyHours = weeklyHours;
    if (!effectiveWeeklyHours) {
      const companyResult = await db.query('SELECT default_weekly_hours FROM company WHERE id = $1', [companyId]);
      effectiveWeeklyHours = companyResult.rows[0]?.default_weekly_hours ?? 35;
    }

    // Crée l'employé sans mot de passe
    await db.query(
      `INSERT INTO users
         (company_id, first_name, last_name, email, role, job_title, hire_date,
          gross_salary, work_time, weekly_hours, invite_token, invite_expires, invite_accepted)
       VALUES ($1,$2,$3,$4,'employee',$5,$6,$7,$8,$9,$10,$11,FALSE)`,
      [companyId, firstName, lastName, email, jobTitle, hireDate, grossSalary,
       workTime || null, effectiveWeeklyHours, inviteToken, inviteExpires]
    );
    await syncSubscriptionQuantity(companyId);

    // L'employé est créé même si l'email échoue à partir d'ici — on ne bloque
    // pas la création pour un problème SMTP, mais on remonte l'info au front.
    let emailSent = true;
    try {
      await sendInviteEmail(email, firstName, inviteToken);
    } catch (mailErr) {
      console.error('Erreur envoi email invitation :', mailErr.message);
      emailSent = false;
    }

    res.status(201).json({
      message: emailSent
        ? `Invitation envoyée à ${email}.`
        : `Employé créé, mais l'email d'invitation n'a pas pu être envoyé. Vous pourrez le renvoyer depuis la fiche employé.`,
      emailSent,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création de l\'employé.' });
  }
};

// POST /api/auth/invite/:id/resend — Renvoyer l'email d'invitation à un employé en attente
const resendInvite = async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  try {
    const result = await db.query(
      `SELECT id, first_name, email, invite_accepted
       FROM users
       WHERE id = $1 AND company_id = $2 AND role = 'employee'`,
      [id, companyId]
    );

    const employee = result.rows[0];
    if (!employee) {
      return res.status(404).json({ message: 'Employé introuvable.' });
    }
    if (employee.invite_accepted) {
      return res.status(400).json({ message: 'Cet employé a déjà activé son compte.' });
    }

    const inviteToken   = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db.query(
      `UPDATE users SET invite_token = $1, invite_expires = $2, updated_at = NOW() WHERE id = $3`,
      [inviteToken, inviteExpires, id]
    );

    let emailSent = true;
    try {
      await sendInviteEmail(employee.email, employee.first_name, inviteToken);
    } catch (mailErr) {
      console.error('Erreur renvoi email invitation :', mailErr.message);
      emailSent = false;
    }

    res.json({
      message: emailSent ? 'Invitation renvoyée.' : "L'email n'a pas pu être envoyé.",
      emailSent,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/auth/accept-invite — L'employé définit son mot de passe
const acceptInvite = async (req, res) => {
  const { token, password } = req.body;

  try {
    const result = await db.query(
      `SELECT * FROM users
       WHERE invite_token = $1
         AND invite_expires > NOW()
         AND invite_accepted = FALSE`,
      [token]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: 'Lien d\'invitation invalide ou expiré.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Active le compte
    await db.query(
      `UPDATE users
       SET password_hash = $1, invite_accepted = TRUE,
           invite_token = NULL, invite_expires = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    // Connecte directement l'employé
    const jwtToken = generateToken(user);

    res.json({
      message: 'Mot de passe créé avec succès.',
      token: jwtToken,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// CHANGEMENT DE MOT DE PASSE (utilisateur connecté)
// ─────────────────────────────────────────────

// PUT /api/auth/change-password
const changePassword = async (req, res) => {
  const { id: userId } = req.user;
  const { currentPassword, newPassword } = req.body;

  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, userId]
    );

    res.json({ message: 'Mot de passe modifié avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  setupAdmin,
  setupCompany,
  login,
  inviteEmployee,
  resendInvite,
  acceptInvite,
  changePassword,
};
