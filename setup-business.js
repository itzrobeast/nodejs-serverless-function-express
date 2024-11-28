import express from 'express';
import cors from 'cors';

const app = express(); // Initialize the app
const router = express.Router(); // Initialize the router

// Middleware to parse JSON for all routes
app.use(express.json());

// Enable CORS globally for the app
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} request to ${req.originalUrl} with body:`, req.body);
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Health-check route for debugging
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Setup-Business is healthy!' });
});

// Main POST route
router.post('/setup-business', async (req, res) => {
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

// Mount the router on the app
app.use('/', router);

// Export the app (if needed for serverless frameworks like Vercel)
export default app;
