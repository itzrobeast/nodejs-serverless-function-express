import express from 'express';
import cors from 'cors';

const app = express();

// Minimal middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Debugging middleware
app.use((req, res, next) => {
  console.log('Incoming Request:', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers
  });
  next();
});

// Direct route handler without router
app.post('/setup-business', (req, res) => {
  try {
    const { platform, businessName, ownerName, contactEmail } = req.body || {};

    console.log('Received Business Setup:', req.body);

    if (!platform || !businessName || !ownerName || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        receivedData: req.body
      });
    }

    res.status(200).json({
      message: 'Business setup successful',
      data: { platform, businessName, ownerName, contactEmail }
    });
  } catch (error) {
    console.error('Business Setup Error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Root health check
app.get('/', (req, res) => {
  res.status(200).send('Server is running');
});

// Catch-all error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ 
    error: 'Unexpected server error', 
    details: err.message 
  });
});

export default app;
