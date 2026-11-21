const express = require('express');
const path = require('path');
const { initDB } = require('./db/database');
const authRoutes = require('./routes/auth.routes');
const piecesRoutes = require('./routes/pieces.routes');
const planningRoutes = require('./routes/planning.routes');
const adminRoutes = require('./routes/admin.routes');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../client/dist')));

app.use('/api', authRoutes);
app.use('/api', piecesRoutes);
app.use('/api', planningRoutes);
app.use('/api', adminRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Atelier Manager Pro (Modular Express + SQLite) running on http://0.0.0.0:${PORT}`);
  });
});
