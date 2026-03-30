const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const authRoutes = require('./src/routes/auth.routes');

const app  = express();
const PORT = process.env.PORT || 3001;

// Middlewares globaux
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Sanity check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Serveur RH démarré sur le port ${PORT}`);
});
