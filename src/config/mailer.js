const nodemailer = require('nodemailer');

const port = Number(process.env.SMTP_PORT) || 587;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Adresse d'expédition affichée — doit correspondre à un expéditeur vérifié
// chez le fournisseur SMTP (pas forcément le login SMTP lui-même, ex. Brevo).
const FROM_ADDRESS = `"${process.env.SMTP_FROM_NAME || 'RH App'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`;

module.exports = { transporter, FRONTEND_URL, FROM_ADDRESS };
