import express from 'express';
import cors from 'cors';

const router = express.Router();

// Debug middleware
router.use((req, res, next) => {
  console.log(`[DEBUG] Setup Business middleware hit: ${req.method} ${req.url}`);
  next();
});

// CORS configuration
router.use(
  cors({
    origin: 'https://mila-verse.vercel.app',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

// Route handler
router.post('/', (req, res) => {
  const { businessName, ownerName, contactEmail } = req.body;

  if (!businessName || !ownerName || !contactEmail) {
    console.error('[DEBUG] Missing required fields:', req.body);
    return res.status(400).json({
      error: 'Missing required fields: businessName, ownerName, or contactEmail',
    });
  }

  console.log('[DEBUG] Setting up business:', { businessName, ownerName, contactEmail });

  res.status(200).json({
    message: 'Business setup completed successfully!',
    data: { businessName, ownerName, contactEmail },
  });
});

export default router;
