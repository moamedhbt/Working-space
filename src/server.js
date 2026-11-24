const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { initDB, UPLOADS_DIR } = require('./db/database');
const authRoutes = require('./routes/auth.routes');
const piecesRoutes = require('./routes/pieces.routes');
const planningRoutes = require('./routes/planning.routes');
const adminRoutes = require('./routes/admin.routes');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve OpenCASCADE WASM gzip-compressed (7.3 MB instead of 22.9 MB!) with immutable cache headers
let cachedWasmGzPath = null;
app.get('/occt/replicad_single.wasm', (req, res) => {
  const wasmPath = path.join(__dirname, '../client/node_modules/replicad-opencascadejs/dist/replicad_single.wasm');
  if (!fs.existsSync(wasmPath)) {
    return res.status(404).send('OCCT WASM not installed locally');
  }
  res.setHeader('Content-Type', 'application/wasm');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('Vary', 'Accept-Encoding');

  const acceptsGzip = /\bgzip\b/i.test(req.headers['accept-encoding'] || '');
  if (acceptsGzip && req.method === 'GET') {
    try {
      const gzTarget = path.join('/tmp', 'replicad_single.wasm.gz');
      if (!cachedWasmGzPath || !fs.existsSync(gzTarget)) {
        const raw = fs.readFileSync(wasmPath);
        fs.writeFileSync(gzTarget, zlib.gzipSync(raw, { level: 6 }));
        cachedWasmGzPath = gzTarget;
      }
      res.setHeader('Content-Encoding', 'gzip');
      return res.sendFile(cachedWasmGzPath);
    } catch {
      // Fallback to raw file if /tmp write fails
    }
  }
  res.sendFile(wasmPath);
});

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
