import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import supabase from './supabaseClient.js';

// Import route handlers
import setupBusinessRouter from './setup-business.js';
import assistantRouter from './assistant.js';
import instagramWebhookRouter from './instagram-webhook.js';
import getBusinessRouter from './get-business.js';
import getVonageNumberRouter from './get-vonage-number.js';
import retrieveLeadsRouter from './retrieve-leads.js';
import verifySessionRouter from './auth/verify-session.js';
import refreshTokenRouter from './auth/refresh-token.js';
import loginRouter from './auth/login.js';
import { getAuthToken } from './utils/authHelpers.js';


const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json());
app.use(
  app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'https://mila-verse.vercel.app',
        'https://mila-verse-7ftxkl9b0-bears-projects-464726ee.vercel.app',
      ];

      if (!origin) {
        // Allow server-to-server or direct requests without origin
        console.log('[DEBUG] CORS Origin: undefined (server-to-server or direct request)');
        return callback(null, true);
      }

      console.log(`[DEBUG] CORS Origin: ${origin}`);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        console.error(`[ERROR] CORS Rejected Origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);


// Global middleware to extract auth token
app.use((req, res, next) => {
  const token = getAuthToken(req);
  if (token) {
    console.log('[DEBUG] Auth Token:', token);
    req.authToken = token;
  } else {
    console.warn('[WARN] No Auth Token Found');
  }
  next();
});


// Supabase Validation
if (!supabase) {
  console.error('[CRITICAL] Supabase client failed to initialize.');
  process.exit(1);
}

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Request: ${req.method} ${req.url}`);
  console.log(`[DEBUG] Headers:`, req.headers);
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
  { path: '/auth/verify-session', router: verifySessionRouter },
  { path: '/auth/refresh-token', router: refreshTokenRouter },
  { path: '/auth/login', router: loginRouter },
];

routes.forEach(({ path, router }) => {
  console.log(`[DEBUG] Initializing route: ${path}`);
  app.use(path, router);
});

// Health Check Route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
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
  console.error('[ERROR] Global Error Handler:', {
    message: err.message,
    stack: err.stack,
    route: req.originalUrl,
  });
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
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
