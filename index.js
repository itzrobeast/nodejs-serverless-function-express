import express from 'express';
import setupBusinessRouter from './setup-business.js';
import assistantRouter from './assistant.js';
import instagramWebhookRouter from './instagram-webhook.js';
import cors from 'cors';
import getBusinessRouter from './get-business.js';
import getVonageNumberRouter from './get-vonage-number.js';
import retrieveLeadsRouter from './retrieve-leads.js';
import verifySessionRouter from './verify-session.js';
import refreshTokenRouter from './refresh-token.js';
import authRouter from './auth.js';

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
app.use('/assistant', assistantRouter);
app.use('/instagram-webhook', instagramWebhookRouter);
app.use('/get-business', getBusinessRouter);
app.use('/get-vonage-number', getVonageNumberRouter);
app.use('/retrieve-leads', retrieveLeadsRouter);
app.use('/verify-session', verifySessionRouter);
app.use('/refresh-token', refreshTokenRouter);
app.use('/auth', authRouter);

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

export default app;
