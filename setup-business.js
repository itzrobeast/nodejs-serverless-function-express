import express from 'express';
import cors from 'cors';

const router = express.Router();

// Enable CORS for this route
router.use(
  cors({
    origin: 'https://mila-verse.vercel.app',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Handle OPTIONS requests
router.options('/', (req, res) => {
  res.sendStatus(204);
});

// Main POST route
router.post('/', (req, res) => {
  console.log('[DEBUG] Setup-Business POST route hit');
  console.log('[DEBUG] Request Headers:', req.headers);
  console.log('[DEBUG] Request Body:', req.body);

  const { businessName, ownerName, contactEmail } = req.body;

  if (!businessName || !ownerName || !contactEmail) {
    console.error('[DEBUG] Missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  res.status(200).json({
    message: 'Business setup completed successfully!',
    data: { businessName, ownerName, contactEmail },
  });
});


export default router;
