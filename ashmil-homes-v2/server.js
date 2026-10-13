require('dotenv').config();
const express = require('express');
const path = require('path');

const adminRoutes = require('./routes/admin');
const propertyRoutes = require('./routes/properties');
const contactRoutes = require('./routes/contact');

const app = express();

/* ============================================================
   MIDDLEWARE
   ============================================================ */

// Parse JSON bodies with a size cap to prevent payload abuse.
app.use(express.json({ limit: '1mb' }));

// Parse URL-encoded bodies (form submissions from older clients).
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Trust Vercel's proxy so req.ip returns the real client IP.
// Needed for rate limiting in routes/contact.js and routes/admin.js.
app.set('trust proxy', 1);

// Disable the X-Powered-By header (small security hygiene win).
app.disable('x-powered-by');

/* ============================================================
   STATIC FILES
   Serves everything in /public directly:
     /                      → public/index.html
     /styles.css            → public/styles.css
     /admin/login.html      → public/admin/login.html
   ============================================================ */

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],       // allow /about to serve about.html
  maxAge: '1h'                // cache static assets for 1 hour
}));

/* ============================================================
   API ROUTES
   ============================================================ */

app.use('/api/admin', adminRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/contact', contactRoutes);

/* ============================================================
   CLEAN URLS (no .html extension)
   These serve the HTML file directly when the user hits the
   pretty URL. The static middleware above already handles
   /about → about.html via the `extensions` option, but these
   explicit routes make intent clear and cover edge cases.
   ============================================================ */

const page = (file) => (req, res, next) =>
  res.sendFile(path.join(__dirname, 'public', file), (err) => {
    if (err) next();
  });

app.get('/', page('index.html'));
app.get('/properties', page('properties.html'));
app.get('/about', page('about.html'));
app.get('/contact', page('contact.html'));
app.get('/property-details', page('property-details.html'));
app.get('/admin/login', page(path.join('admin', 'login.html')));
app.get('/admin/dashboard', page(path.join('admin', 'dashboard.html')));

/* ============================================================
   HEALTH CHECK
   Useful for debugging — open /api/health in a browser to
   confirm the server is alive and env vars are loaded.
   ============================================================ */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    env: {
      supabaseUrl: Boolean(process.env.SUPABASE_URL),
      supabaseAnon: Boolean(process.env.SUPABASE_ANON_KEY),
      supabaseService: Boolean(process.env.SUPABASE_SERVICE_KEY),
      jwtSecret: Boolean(process.env.JWT_SECRET),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    }
  });
});

/* ============================================================
   404 FALLBACK
   Any unmatched route returns the styled 404 page.
   ============================================================ */

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

/* ============================================================
   ERROR HANDLER
   Catches anything that throws. Logs server-side, returns
   a clean JSON error for API routes and a 500 for pages.
   ============================================================ */

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Something went wrong.' });
  }
  res.status(500).send('Something went wrong.');
});

/* ============================================================
   LISTEN
   On Vercel, the app is exported as a handler and there is
   no long-running server. Locally, we still want to listen
   so `npm start` works for development.
   ============================================================ */

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
