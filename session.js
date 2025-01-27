import express from 'express';

const router = express.Router();

/**
 * GET /api/session
 * Fetch the businessId from HTTP-only cookies.
 */
router.get('/', (req, res) => {
  try {
    const businessId = req.cookies.businessId;

    if (!businessId) {
      console.error('[ERROR] No businessId found in cookies.');
      return res.status(401).json({ error: 'Unauthorized: No business ID found.' });
    }

    console.log('[DEBUG] Business ID retrieved:', businessId);
    res.status(200).json({ businessId });
  } catch (error) {
    console.error('[ERROR] Failed to fetch session:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

export default router;
