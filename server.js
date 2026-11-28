require('dotenv').config();
const Sentry  = require('./src/config/sentry');
const express = require('express');
require('./src/middleware/asyncErrors'); // erreurs des routes async → réponse 500 (audit du 28 nov. 2026)
const cors    = require('cors');
const helmet  = require('helmet');

const authRoutes     = require('./src/routes/auth.routes');
const employeeRoutes = require('./src/routes/employees.routes');
const leavesRoutes   = require('./src/routes/leaves.routes');
const scheduleRoutes = require('./src/routes/schedule.routes');
const payrollRoutes  = require('./src/routes/payroll.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const shiftTemplatesRoutes = require('./src/routes/shiftTemplates.routes');
const weekTemplatesRoutes = require('./src/routes/weekTemplates.routes');
const visitsRoutes = require('./src/routes/visits.routes');
const calendarRoutes = require('./src/routes/calendar.routes');
const contactRoutes = require('./src/routes/contact.routes');
const { startVisitsPurge } = require('./src/services/visits.service');
const { startHealthHistory } = require('./src/services/healthHistory.service');
const presenceRulesRoutes = require('./src/routes/presenceRules.routes');
const aiPlanningRoutes = require('./src/routes/aiPlanning.routes');
const meetingsRoutes = require('./src/routes/meetings.routes');
const ownerRoutes    = require('./src/routes/owner.routes');
const { activityMiddleware, startActivityPurge } = require('./src/services/activityLog.service');
const billingRoutes  = require('./src/routes/billing.routes');
const billingCtrl    = require('./src/controllers/billing.controller');

const app  = express();
const PORT = process.env.PORT || 3001;

// En ligne, Railway place un relais devant le serveur : sans ce réglage,
// tous les visiteurs semblent venir de la même adresse, et la limite de
// tentatives de connexion (rateLimit.js) serait partagée par tout le monde.
app.set('trust proxy', 1);

app.use(helmet());

// L'app est accessible depuis plusieurs origines (domaine propre + alias
// Vercel) : on autorise explicitement chacune plutôt qu'une seule.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://myorgaly.fr',
  'https://www.myorgaly.fr',
  'https://rh-app-frontend.vercel.app',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Origine inconnue (ex. robot de Vercel qui ouvre chaque nouvelle version
    // du site sur son adresse d'essai) : on n'envoie simplement pas les
    // en-têtes CORS, le navigateur bloque la réponse. Pas d'erreur levée,
    // sinon chaque mise en ligne déclenchait de fausses alertes Sentry.
    callback(null, !origin || allowedOrigins.includes(origin));
  },
  credentials: true,
}));

// Webhook Stripe : doit recevoir le corps brut (vérification de signature),
// donc déclaré avant express.json().
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingCtrl.handleWebhook);

// 1 Mo : un planning d'un mois proposé par l'IA peut dépasser les 100 ko par défaut
app.use(express.json({ limit: '1mb' }));
// Journal des actions et temps de réponse (page de pilotage)
app.use(activityMiddleware);

app.use('/api/auth',      authRoutes);
app.use('/api/billing',   billingRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves',    leavesRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/payroll',   payrollRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/shift-templates', shiftTemplatesRoutes);
app.use('/api/week-templates', weekTemplatesRoutes);
app.use('/api/visits', visitsRoutes);
// Planning dans l'agenda du téléphone (lien personnel .ics)
app.use('/api/calendar', calendarRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/presence-rules', presenceRulesRoutes);
app.use('/api/ai-planning', aiPlanningRoutes);
app.use('/api/meetings',  meetingsRoutes);
app.use('/api/owner',     ownerRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Après toutes les routes, avant app.listen : capture les erreurs non
// gérées par les try/catch des controllers.
Sentry.setupExpressErrorHandler(app);

// Dernier filet : toute erreur arrivée jusqu'ici reçoit une réponse JSON
// courte (jamais le détail technique), au lieu de la page d'erreur d'Express
// ou d'une requête restée sans réponse.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  if (res.headersSent) return;
  res.status(status).json({ message: status === 500 ? 'Erreur serveur.' : 'Requête invalide.' });
});

// Erreur hors requête (tâche de fond…) : on la note sans arrêter le serveur.
process.on('unhandledRejection', (err) => {
  console.error('Erreur non rattrapée :', err);
});

startActivityPurge();
startVisitsPurge();
startHealthHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur RH démarré sur le port ${PORT}`);
});
