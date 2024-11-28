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
router.post('/', async (req, res) => {
  try {
    const { businessName, ownerName, contactEmail } = req.body;

    if (!businessName || !ownerName || !contactEmail) {
      throw new Error('Missing required fields');
    }

    // Simulate some processing logic
    console.log(`[DEBUG] Processing business setup:`, { businessName, ownerName, contactEmail });

    res.status(200).json({
      message: 'Business setup completed successfully!',
      data: { businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error(`[ERROR] Setup-Business:`, error);
    res.status(500).json({
      error: error.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});



export default router;
