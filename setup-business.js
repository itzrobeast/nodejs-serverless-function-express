import express from 'express';
import cors from 'cors';
const app = express();
const router = express.Router();

// Middleware to parse JSON bodies
app.use(express.json());

// Global CORS Middleware
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.originalUrl} - Body:`, req.body);
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Single route handler for /setup-business
router.post('/setup-business', async (req, res) => {
  console.log('[DEBUG] Route handler for /setup-business started');
  try {
    const { platform, businessName, ownerName, contactEmail } = req.body;
    console.log('[DEBUG] Request body:', req.body);
    
    if (!platform || !businessName || !ownerName || !contactEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    res.status(200).json({
      message: 'Business setup completed successfully!',
      data: { platform, businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    console.log('[DEBUG] Route handler for /setup-business completed');
  }
});

// Health check route
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Server is healthy!' });
});

// Mount router on the app
app.use('/', router);

// Export the app (required for serverless environments like Vercel)
export default app;
