import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Verify session handler
router.get('/verify-session', (req, res) => {
  console.log('[DEBUG] Request received at /verify-session');
  console.log('[DEBUG] Request headers:', req.headers);

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[ERROR] No token provided or malformed Authorization header');
    return res.status(400).json({ error: 'No token provided or invalid format' });
  }

  const token = authHeader.split(' ')[1]; // Extract Bearer token
  console.log('[DEBUG] Extracted token:', token);

  try {
    // Verify the token
    const user = jwt.verify(token, process.env.MILA_SECRET); // Use MILA_SECRET instead of JWT_SECRET

    console.log('[DEBUG] Token verified successfully:', user);

    // Return user data (customize as per your needs)
    res.status(200).json({ user });
  } catch (error) {
    console.error('[ERROR] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
