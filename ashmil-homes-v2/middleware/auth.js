const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. All authenticated requests will be rejected.');
}

/* ============================================================
   requireAuth
   Verifies the Authorization: Bearer <token> header.
   On success: attaches req.admin = { id, email, iat, exp }
   On failure: 401 with a JSON error message.
   ============================================================ */

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || req.headers.Authorization || '';

  // Expect exactly "Bearer <token>"
  const parts = String(header).trim().split(/\s+/);
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0]) || !parts[1]) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = parts[1];

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = verified; // { id, email, iat, exp }
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid session.' });
  }
};
