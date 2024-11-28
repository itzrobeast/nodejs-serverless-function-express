import express from 'express';

const router = express.Router();

router.post('/', (req, res) => {
  console.log('[DEBUG] Request Body:', req.body);
  res.status(200).json({ message: 'Test Successful' });
});

export default router;
