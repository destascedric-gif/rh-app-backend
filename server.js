const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const authRoutes     = require('./src/routes/auth.routes');
const employeeRoutes = require('./src/routes/employees.routes');
const leavesRoutes   = require('./src/routes/leaves.routes');
const scheduleRoutes = require('./src/routes/schedule.routes');
const payrollRoutes  = require('./src/routes/payroll.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const shiftTemplatesRoutes = require('./src/routes/shiftTemplates.routes');

const app  = express();
const PORT = process.env.PORT || 3001;

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
app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves',    leavesRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/payroll',   payrollRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/shift-templates', shiftTemplatesRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur RH démarré sur le port ${PORT}`);
});
