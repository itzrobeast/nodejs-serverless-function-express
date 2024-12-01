import express from 'express';
import setupBusinessRouter from './setup-business.js';
import assistantHandler from './assistant.js';
import instagramWebhookHandler from './instagram-webhook.js';
import cors from 'cors';
import getBusinessRoute from './get-business.js';


const app = express();



app.use((req, res, next) => {
  console.log('[DEBUG] Applying CORS for route:', req.url);
  next();
});

// CORS Configuration
app.use(cors({
  origin: 'https://mila-verse.vercel.app', // Allow requests only from this origin
  methods: ['GET', 'POST', 'OPTIONS'], // Specify allowed methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Specify allowed headers
  credentials: true, // Allow credentials to be sent
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
