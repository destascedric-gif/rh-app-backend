// Crée (ou réinitialise) le compte propriétaire d'Orgaly, qui donne accès
// à la page de pilotage, et envoie à son adresse un lien pour choisir le
// mot de passe (valable 1 heure). Aucun mot de passe ne passe par ce script.
//
//   npm run proprietaire            → lien vers le site en ligne
//   npm run proprietaire -- --local → lien vers l'aperçu local (tests)
require('dotenv').config();
const crypto = require('crypto');
const db = require('../src/config/db');
const { sendMail } = require('../src/config/mailer');

const EMAIL = 'contact@myorgaly.fr';
const NAME = 'Cédric';
const SITE = process.argv.includes('--local') ? 'http://localhost:5173' : 'https://www.myorgaly.fr';

(async () => {
  await db.query(require('fs').readFileSync(require('path').join(__dirname, '../src/models/owner.schema.sql'), 'utf8'));

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    `INSERT INTO platform_owners (email, name, setup_token_hash, setup_expires)
     VALUES ($1, $2, $3, NOW() + interval '1 hour')
     ON CONFLICT (email) DO UPDATE
       SET setup_token_hash = EXCLUDED.setup_token_hash, setup_expires = EXCLUDED.setup_expires`,
    [EMAIL, NAME, tokenHash]
  );

  const link = `${SITE}/proprietaire/activer?token=${token}`;
  await sendMail({
    to: EMAIL,
    subject: 'Orgaly — choisissez le mot de passe du pilotage',
    html: `<p>Bonjour ${NAME},</p>
<p>Voici le lien pour choisir le mot de passe de votre compte propriétaire, qui ouvre la page de pilotage d'Orgaly :</p>
<p><a href="${link}">Choisir mon mot de passe</a></p>
<p>Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
  });

  console.log(`Lien envoyé à ${EMAIL} (valable 1 heure).`);
  process.exit(0);
})().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
