const { auth } = require('../firebase');

const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email) {
  if (adminEmails.length === 0) return true;
  return adminEmails.includes(String(email || '').toLowerCase());
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    if (!isAdmin(decoded.email)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { requireAuth };
