const express = require('express');
const setupBusinessRouter = require('./setup-business');
const assistantHandler = require('./assistant');
const instagramWebhookHandler = require('./instagram-webhook');
const cors = require('cors');
const getBusinessRoute = require('./get-business');
const getVonageNumberRoute = require('./get-vonage-number');
const retrieveLeadsRoute = require('./retrieve-leads');
const verifySessionRouter = require('./verify-session');
const refreshTokenRouter = require('./refresh-token');
const authRoutes = require('./auth');

const app = express();

// CORS Configuration
app.use(cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Middleware for parsing JSON requests
app.use(express.json());

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Request received: ${req.method} ${req.url}`);
  next();
});

// Route Handlers
app.use('/setup-business', setupBusinessRouter);
app.use('/assistant', assistantHandler);
app.use('/instagram-webhook', instagramWebhookHandler);
app.use('/get-business', getBusinessRoute);
app.use('/get-vonage-number', getVonageNumberRoute);
app.use('/retrieve-leads', retrieveLeadsRoute);
app.use('/verify-session', verifySessionRouter); // Attach /verify-session route
app.use('/refresh-token', refreshTokenRouter);
app.use('/auth', authRoutes);

// Root Route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root route hit');
  res.status(200).send('Welcome to the Node.js Serverless App!');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
