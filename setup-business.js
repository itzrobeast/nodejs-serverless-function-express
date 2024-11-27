import express from 'express';
import cors from 'cors';

const router = express.Router();

// CORS Configuration
const corsMiddleware = cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
});

router.use(corsMiddleware);

router.post('/', (req, res) => {
  const { businessName, ownerName, contactEmail } = req.body;

  if (!businessName || !ownerName || !contactEmail) {
    return res.status(400).json({
      error: 'Missing required fields: businessName, ownerName, or contactEmail',
    });
  }

  console.log('Setting up business:', { businessName, ownerName, contactEmail });

  res.status(200).json({
    message: 'Business setup completed successfully!',
    data: { businessName, ownerName, contactEmail },
  });
});

export default router;
