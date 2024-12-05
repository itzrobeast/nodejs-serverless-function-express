import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Verify session handler
router.get('/verify-session', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]; // Extract Bearer token

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Verify the token
    const user = jwt.verify(token, process.env.JWT_SECRET);

    // Return user data (you can customize this based on your app's needs)
    res.status(200).json({ user });
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
