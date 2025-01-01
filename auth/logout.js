// backend/auth/logout.js

import express from 'express';

const router = express.Router();

/**
 * Logout user by clearing cookies.
 * POST /auth/logout
 */
router.post('/', (req, res) => {
  res.clearCookie('authToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });
  res.clearCookie('businessOwnerId', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });
  res.clearCookie('businessId', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });
  res.status(200).json({ message: 'Logged out successfully.' });
});

export default router;
