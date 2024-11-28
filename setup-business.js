import express from 'express';

const router = express.Router();

router.get('/health', (req, res) => {
  console.log('[DEBUG] Health Check Route Hit');
  res.json({ status: 'Healthy' });
});

router.post('/', (req, res) => {
  console.log('[DEBUG] POST /setup-business Hit', req.body);
  if (!req.body) {
    return res.status(400).json({ error: 'No body received' });
  }
  res.json({ message: 'Business setup successful', data: req.body });
});

export default router;
