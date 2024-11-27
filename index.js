import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import setupBusiness from './setup-business.js';
import assistant from './assistant.js';

const app = express();

// Middleware to parse JSON
app.use(express.json());

// Debugging middleware to log requests
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to ${req.url} - Method: ${req.method}`);
  next();
});

// CORS configuration
const allowedOrigin = 'https://mila-verse.vercel.app'; // Frontend URL
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

// Debugging: Log incoming payload for POST requests
app.post('/', (req, res, next) => {
  console.log('[DEBUG] Incoming payload:', JSON.stringify(req.body, null, 2));
  next();
});

// Routes
app.use('/instagram-webhook', instagramWebhook);
app.use('/setup-business', setupBusiness);
app.use('/assistant', assistant);

// Root route
app.get('/', (req, res) => {
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Fallback route for 404 errors
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error-handling middleware
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  console.error(`[ERROR] Stack trace: ${err.stack}`);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

export default app;
