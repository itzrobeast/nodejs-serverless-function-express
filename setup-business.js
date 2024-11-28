import express from 'express';
import cors from 'cors';

const app = express();

// Explicitly configure body parsing
app.use(express.json({
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      console.error('[PARSE ERROR]', e);
      throw new Error('Invalid JSON');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// Detailed CORS with debugging
app.use(cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Super verbose logging middleware
app.use((req, res, next) => {
  console.log('[DEBUG] Full Request Details:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    query: req.query
  });
  next();
});

// Single route handler with extensive error handling
app.post('/setup-business', async (req, res, next) => {
  try {
    console.log('[DEBUG] Raw Request Body:', req.body);
    
    const { platform, businessName, ownerName, contactEmail } = req.body || {};
    
    if (!platform || !businessName || !ownerName || !contactEmail) {
      console.error('[VALIDATION ERROR] Missing fields');
      return res.status(400).json({ 
        error: 'Missing required fields',
        receivedBody: req.body 
      });
    }

    res.status(200).json({
      message: 'Business setup completed successfully!',
      data: { platform, businessName, ownerName, contactEmail }
    });
  } catch (error) {
    console.error('[ROUTE ERROR]', error);
    next(error);
  }
});

// Comprehensive error handling middleware
app.use((err, req, res, next) => {
  console.error('[CRITICAL ERROR]', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    requestBody: req.body,
    requestHeaders: req.headers
  });

  res.status(500).json({
    error: 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
});

// Health check route
app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

export default app;
