const db = require('../config/db');
const { newToken, feedUrl, buildFeed } = require('../services/calendarFeed.service');

// Planning dans l'agenda du téléphone : lien personnel (voir
// calendarFeed.service.js). Employés, et gérant seulement s'il apparaît
// dans le planning.

const allowed = async (user) => {
  if (user.role === 'employee') return true;
  if (user.role !== 'admin') return false;
  const c = (await db.query('SELECT manager_in_schedule FROM company WHERE id = $1', [user.companyId])).rows[0];
  return Boolean(c?.manager_in_schedule);
};

const NOT_ALLOWED = 'Le planning dans l’agenda est proposé quand vous apparaissez dans le planning (Paramètres → Planning → Gérant dans le planning).';

// GET /api/calendar/link — le lien de la personne connectée (créé au
// premier appel)
const getLink = async (req, res) => {
  try {
    if (!(await allowed(req.user))) return res.status(403).json({ message: NOT_ALLOWED });
    let token = (await db.query('SELECT calendar_token FROM users WHERE id = $1', [req.user.id])).rows[0]?.calendar_token;
    if (!token) {
      token = newToken();
      await db.query('UPDATE users SET calendar_token = $1 WHERE id = $2 AND calendar_token IS NULL', [token, req.user.id]);
      token = (await db.query('SELECT calendar_token FROM users WHERE id = $1', [req.user.id])).rows[0].calendar_token;
    }
    res.json({ url: feedUrl(req, token) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/calendar/link/reset — nouveau lien ; l'ancien ne marche plus
const resetLink = async (req, res) => {
  try {
    if (!(await allowed(req.user))) return res.status(403).json({ message: NOT_ALLOWED });
    const token = newToken();
    await db.query('UPDATE users SET calendar_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ url: feedUrl(req, token) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/calendar/:file (« <lien>.ics ») — lu par Google, Apple… sans
// session : le lien secret fait office de clé
const feed = async (req, res) => {
  try {
    const token = String(req.params.file || '').replace(/\.ics$/i, '');
    const ics = await buildFeed(token);
    if (!ics) return res.status(404).type('text/plain').send('Agenda introuvable : ce lien a été changé ou n’est plus actif.');
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="orgaly-planning.ics"',
      'Cache-Control': 'no-cache',
      'X-Robots-Tag': 'noindex',
    });
    res.send(ics);
  } catch (err) {
    console.error(err);
    res.status(500).type('text/plain').send('Erreur serveur.');
  }
};

module.exports = { getLink, resetLink, feed };
