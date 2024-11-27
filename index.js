import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import setupBusiness from './setup-business.js';
import assistant from './assistant.js';
// Environment Variable Validation
const requiredVars = [
  'FACEBOOK_ACCESS_TOKEN',
  'VONAGE_API_KEY',
  'INSTAGRAM_ACCESS_TOKEN',
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_VERIFY_TOKEN',
  'GOOGLE_SERVICE_ACCOUNT',
  'GOOGLE_CALENDAR_ID',
  'OPENAI_API_KEY',
];

requiredVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`[ERROR] Missing environment variable: ${varName}`);
    process.exit(1); // Exit the process if a required variable is missing
  }
});

console.log('[DEBUG] All required environment variables are set');

const app = express();

// Middleware to parse JSON
app.use((req, res, next) => {
  console.log('[DEBUG] Raw Request Body:', req.body);
  next();
});
app.use(express.json());
app.use((req, res, next) => {
  console.log('[DEBUG] Parsed Request Body:', req.body);
  next();
});

// Debugging middleware to log requests
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to ${req.url} - Method: ${req.method}`);
  next();
});
app.use((req, res, next) => {
  console.log(`[DEBUG] Middleware invoked: ${req.method} ${req.url}`);
  console.log(`[DEBUG] Headers:`, req.headers);
  console.log(`[DEBUG] Body:`, req.body);
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
