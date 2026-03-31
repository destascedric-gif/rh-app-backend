const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const authRoutes     = require('./src/routes/auth.routes');
const employeeRoutes = require('./src/routes/employees.routes');
const leavesRoutes   = require('./src/routes/leaves.routes');
const scheduleRoutes = require('./src/routes/schedule.routes');
const payrollRoutes  = require('./src/routes/payroll.routes');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves',    leavesRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/payroll',   payrollRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur RH démarré sur le port ${PORT}`);
});
