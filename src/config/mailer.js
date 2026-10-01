const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
const FROM_NAME  = process.env.SMTP_FROM_NAME || 'RH App';

// Envoi via l'API HTTP de Brevo (https, port 443) plutôt que par SMTP :
// certains hébergeurs (Railway notamment) bloquent silencieusement les ports
// SMTP sortants (587 et 465), ce qui fait planter/pendre l'envoi indéfiniment
// sans jamais lever d'erreur exploitable.
// Adresses du compte de démonstration (scripts/demo-seed.js) : elles
// n'existent pas, aucun e-mail ne doit partir vers elles.
const DEMO_EMAIL_DOMAIN = '@demo.myorgaly.fr';

const sendMail = async ({ to, subject, html }) => {
  if (String(to).toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) {
    console.log(`E-mail non envoyé (compte de démonstration) : ${subject}`);
    return { skipped: true };
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Échec de l'envoi via Brevo (${res.status}) : ${body}`);
  }

  return res.json();
};

module.exports = { sendMail, FRONTEND_URL, DEMO_EMAIL_DOMAIN };
