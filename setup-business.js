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

// Middleware to log all incoming requests
router.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} request to ${req.originalUrl} with body:`, req.body);
  next();
});

// Handle OPTIONS requests
router.options('/', (req, res) => {
  res.sendStatus(204); // Respond with no content for preflight
});

// Main POST route
router.post('/', async (req, res) => {
  try {
    const { platform, businessName, ownerName, contactEmail } = req.body;

    console.log('[DEBUG] Received Payload:', req.body); // Log incoming data

    if (!platform) {
      throw new Error('Platform is required but not provided!');
    }

    if (!businessName || !ownerName || !contactEmail) {
      throw new Error('Missing required fields: businessName, ownerName, or contactEmail');
    }

    console.log('[DEBUG] Processing business setup for platform:', platform);

    res.status(200).json({
      message: 'Business setup completed successfully!',
      data: { platform, businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error('[ERROR] Setup-Business:', error.message);
    res.status(500).json({
      error: error.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});


// Temporary health-check route for debugging
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Setup-Business is healthy!' });
});

export default router;
