import express from 'express';

const router = express.Router();

// Simple POST endpoint
router.post('/', (req, res) => {
  console.log('[DEBUG] /setup-business Body:', req.body);
  res.status(200).json({ message: 'Success', body: req.body });
});

export default router;
