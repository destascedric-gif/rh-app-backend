const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');
const db       = require('../config/db');

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
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite?token=${inviteToken}`;

  await transporter.sendMail({
    from: `"RH App" <${process.env.SMTP_USER}>`,
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
// VÉRIFICATION DU SETUP INITIAL
// ─────────────────────────────────────────────

// GET /api/auth/setup-status
// Retourne si le setup initial a déjà été fait
const getSetupStatus = async (req, res) => {
  try {
    const result = await db.query('SELECT setup_complete FROM app_config LIMIT 1');
    res.json({ setupComplete: result.rows[0]?.setup_complete ?? false });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ÉTAPE 1 : CRÉATION DU COMPTE ADMIN
// ─────────────────────────────────────────────

// POST /api/auth/setup/admin
const setupAdmin = async (req, res) => {
  const { firstName, lastName, email, password, phone } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: 'Tous les champs obligatoires doivent être remplis.' });
  }

  try {
    // Vérifie que le setup n'a pas déjà été fait
    const config = await db.query('SELECT setup_complete FROM app_config LIMIT 1');
    if (config.rows[0]?.setup_complete) {
      return res.status(403).json({ message: 'Setup déjà effectué.' });
    }

    // Vérifie que l'email n'existe pas déjà
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    // Hash du mot de passe
    const passwordHash = await bcrypt.hash(password, 12);

    // Création de l'admin (sans company_id pour l'instant)
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, phone, invite_accepted)
       VALUES ($1, $2, $3, $4, 'admin', $5, TRUE)
       RETURNING id, email, role`,
      [firstName, lastName, email, passwordHash, phone]
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

  if (!name) {
    return res.status(400).json({ message: 'Le nom de l\'entreprise est obligatoire.' });
  }

  try {
    // Création de l'entreprise
    const companyResult = await db.query(
      `INSERT INTO company (name, siret, address, city, postal_code, sector)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, siret, address, city, postalCode, sector]
    );

    const companyId = companyResult.rows[0].id;

    // Rattachement de l'admin à l'entreprise
    await db.query(
      'UPDATE users SET company_id = $1 WHERE id = $2',
      [companyId, adminId]
    );

    // Marque le setup comme terminé
    await db.query('UPDATE app_config SET setup_complete = TRUE');

    // Nouveau token avec companyId
    const userResult = await db.query('SELECT * FROM users WHERE id = $1', [adminId]);
    const admin = userResult.rows[0];
    const token = generateToken(admin);

    res.status(201).json({ message: 'Entreprise créée.', token, companyId });
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

  if (!email || !password) {
    return res.status(400).json({ message: 'Email et mot de passe requis.' });
  }

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
  const { firstName, lastName, email, jobTitle, hireDate, grossSalary } = req.body;
  const companyId = req.user.companyId;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ message: 'Prénom, nom et email sont obligatoires.' });
  }

  try {
    // Vérifie que l'email n'existe pas déjà
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    // Génère un token d'invitation unique (valable 48h)
    const inviteToken  = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Crée l'employé sans mot de passe
    await db.query(
      `INSERT INTO users
         (company_id, first_name, last_name, email, role, job_title, hire_date,
          gross_salary, invite_token, invite_expires, invite_accepted)
       VALUES ($1,$2,$3,$4,'employee',$5,$6,$7,$8,$9,FALSE)`,
      [companyId, firstName, lastName, email, jobTitle, hireDate, grossSalary,
       inviteToken, inviteExpires]
    );

    // Envoie l'email d'invitation
    await sendInviteEmail(email, firstName, inviteToken);

    res.status(201).json({ message: `Invitation envoyée à ${email}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'envoi de l\'invitation.' });
  }
};

// POST /api/auth/accept-invite — L'employé définit son mot de passe
const acceptInvite = async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ message: 'Token et mot de passe requis.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Le mot de passe doit faire au moins 8 caractères.' });
  }

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

module.exports = {
  getSetupStatus,
  setupAdmin,
  setupCompany,
  login,
  inviteEmployee,
  acceptInvite,
};
