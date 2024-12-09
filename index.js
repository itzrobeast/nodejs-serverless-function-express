import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import supabase from './supabaseClient.js';

// Import route handlers
import setupBusinessRouter from './setup-business.js';
import assistantRouter from './assistant.js';
import instagramWebhookRouter from './instagram-webhook.js';
import getBusinessRouter from './get-business.js';
import getVonageNumberRouter from './get-vonage-number.js';
import retrieveLeadsRouter from './retrieve-leads.js';
import verifySessionRouter from './verify-session.js';
import refreshTokenRouter from './refresh-token.js';
import authRouter from './auth.js';

const app = express();

// Security Enhancements
app.use(helmet());

// CORS Configuration
const allowedOrigins = ['https://mila-verse.vercel.app'];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Middleware for parsing JSON requests
app.use(express.json());

// Middleware to ensure Supabase is initialized
if (!supabase) {
  throw new Error('[CRITICAL] Supabase client failed to initialize.');
}
app.use((req, res, next) => {
  req.supabase = supabase;
  next();
});

// Request Timing Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[DEBUG] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Request received: ${req.method} ${req.url}`);
  next();
});

// Route Handlers
const routes = [
  { path: '/setup-business', router: setupBusinessRouter },
  { path: '/assistant', router: assistantRouter },
  { path: '/instagram-webhook', router: instagramWebhookRouter },
  { path: '/get-business', router: getBusinessRouter },
  { path: '/get-vonage-number', router: getVonageNumberRouter },
  { path: '/retrieve-leads', router: retrieveLeadsRouter },
  { path: '/verify-session', router: verifySessionRouter },
  { path: '/refresh-token', router: refreshTokenRouter },
  { path: '/auth', router: authRouter },
];

routes.forEach(({ path, router }) => {
  console.log(`[DEBUG] Initializing route: ${path}`);
  app.use(path, router);
});

// Root Route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root route hit');
  res.status(200).send('Welcome to the Node.js Serverless App!');
});

// 404 Handler
app.use((req, res) => {
  console.warn('[WARN] 404 - Route Not Found:', req.originalUrl);
  res.status(404).json({ error: 'Route Not Found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('[INFO] SIGINT signal received: closing server...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[INFO] SIGTERM signal received: closing server...');
  process.exit(0);
});

export default app;
