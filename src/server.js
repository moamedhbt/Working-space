const express = require('express');
const path = require('path');
const { initDB, UPLOADS_DIR } = require('./db/database');
const authRoutes = require('./routes/auth.routes');
const piecesRoutes = require('./routes/pieces.routes');
const planningRoutes = require('./routes/planning.routes');
const adminRoutes = require('./routes/admin.routes');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, '../client/dist')));

app.use('/api', authRoutes);
app.use('/api', piecesRoutes);
app.use('/api', planningRoutes);
app.use('/api', adminRoutes);

// Global JSON error handler for API routes
app.use('/api', (err, req, res, next) => {
  console.error('API Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur interne du serveur' });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Atelier Manager Pro (Express + better-sqlite3 WAL) running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('Échec initialisation DB:', err);
  process.exit(1);
});
