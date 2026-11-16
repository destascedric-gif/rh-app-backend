const express   = require('express');
const rateLimit = require('express-rate-limit');
const { sendMail } = require('../config/mailer');

// Formulaire de contact du site vitrine (16 nov. 2026, demande de Cédric) :
// le visiteur écrit depuis la page /contact, le message arrive par e-mail
// sur la boîte d'Orgaly ; « Répondre » écrit directement au visiteur.
// Rien n'est enregistré en base (seule une ligne sans contenu dans le
// journal du pilotage). Sans session.

const router = express.Router();

// 5 messages par quart d'heure et par adresse : assez pour un vrai
// visiteur, pas pour un robot qui enverrait des centaines de messages
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de messages envoyés. Réessayez dans quelques minutes, ou écrivez à contact@myorgaly.fr.' },
});

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@myorgaly.fr';
const SUBJECTS = {
  question: 'Une question',
  demo: 'Une démonstration',
  ia: "L'option IA avancée",
  autre: 'Autre',
};
const TEAM_SIZES = ['1 à 3', '4 à 10', '11 à 20', 'Plus de 20'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

router.post('/', contactLimiter, async (req, res) => {
  const body = req.body || {};
  // Champ caché « site web » : invisible pour un humain, rempli par les
  // robots. Dans ce cas, on fait comme si tout s'était bien passé.
  if (clean(body.website, 200)) return res.json({ ok: true });

  const name    = clean(body.name, 100);
  const email   = clean(body.email, 200);
  const company = clean(body.company, 120);
  const team    = TEAM_SIZES.includes(body.team) ? body.team : '';
  const subject = SUBJECTS[body.subject] ? body.subject : 'question';
  const message = clean(body.message, 5000);

  if (!name) return res.status(400).json({ message: 'Indiquez votre nom.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Indiquez une adresse e-mail valide, pour que nous puissions vous répondre.' });
  if (message.length < 5) return res.status(400).json({ message: 'Écrivez votre message.' });

  const row = (label, value) => (value
    ? `<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">${label}</td><td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`
    : '');

  try {
    await sendMail({
      to: CONTACT_EMAIL,
      replyTo: { email, name },
      subject: `[Site] ${SUBJECTS[subject]} — ${name}${company ? ` (${company})` : ''}`,
      html: `
        <h2 style="margin:0 0 12px">Nouveau message depuis myorgaly.fr</h2>
        <table style="border-collapse:collapse;margin:0 0 16px">
          ${row('Demande', SUBJECTS[subject])}
          ${row('Nom', name)}
          ${row('E-mail', email)}
          ${row('Commerce', company)}
          ${row('Salariés', team)}
        </table>
        <div style="padding:12px 14px;background:#F4F5F8;border-radius:8px;white-space:pre-wrap">${escapeHtml(message)}</div>
        <p style="color:#888;font-size:13px">Pour répondre, utilisez simplement « Répondre » : le message ira à ${escapeHtml(email)}.</p>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Formulaire de contact :', err.message);
    res.status(502).json({ message: "Le message n'a pas pu partir. Réessayez, ou écrivez directement à contact@myorgaly.fr." });
  }
});

module.exports = router;
