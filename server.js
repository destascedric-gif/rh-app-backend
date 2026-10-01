require('dotenv').config();
const Sentry  = require('./src/config/sentry');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const authRoutes     = require('./src/routes/auth.routes');
const employeeRoutes = require('./src/routes/employees.routes');
const leavesRoutes   = require('./src/routes/leaves.routes');
const scheduleRoutes = require('./src/routes/schedule.routes');
const payrollRoutes  = require('./src/routes/payroll.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const shiftTemplatesRoutes = require('./src/routes/shiftTemplates.routes');
const meetingsRoutes = require('./src/routes/meetings.routes');
const billingRoutes  = require('./src/routes/billing.routes');
const billingCtrl    = require('./src/controllers/billing.controller');

const app  = express();
const PORT = process.env.PORT || 3001;

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
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Origine non autorisée par CORS.'));
  },
  credentials: true,
}));

// Webhook Stripe : doit recevoir le corps brut (vérification de signature),
// donc déclaré avant express.json().
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingCtrl.handleWebhook);

app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/billing',   billingRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves',    leavesRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/payroll',   payrollRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/shift-templates', shiftTemplatesRoutes);
app.use('/api/meetings',  meetingsRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Après toutes les routes, avant app.listen : capture les erreurs non
// gérées par les try/catch des controllers.
Sentry.setupExpressErrorHandler(app);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur RH démarré sur le port ${PORT}`);
});
