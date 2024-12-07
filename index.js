import express from 'express';
import setupBusinessRouter from './setup-business.js'; // Express Router
import assistantRouter from './assistant.js'; // Express Router
import instagramWebhookRouter from './instagram-webhook.js'; // Express Router
import cors from 'cors';
import getBusinessRouter from './get-business.js'; // Express Router
import getVonageNumberRouter from './get-vonage-number.js'; // Express Router
import retrieveLeadsRouter from './retrieve-leads.js'; // Express Router
import verifySessionRouter from './verify-session.js'; // Express Router
import refreshTokenRouter from './refresh-token.js'; // Express Router
import authRouter from './auth.js'; // Express Router


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
// Apply them consistently
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
