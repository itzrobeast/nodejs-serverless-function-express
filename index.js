import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import supabase from './supabaseClient.js';

// Validate Critical Environment Variables
if (
  !process.env.FACEBOOK_APP_ID || 
  !process.env.FACEBOOK_APP_SECRET || 
  !process.env.SUPABASE_URL || 
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  console.error('[CRITICAL] Missing environment variables. Ensure FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are set.');
  process.exit(1); // Exit the process if variables are missing
}

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

const app = express();

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://example.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    } : false,
  })
);
app.use(cookieParser());
app.use(express.json());



app.use(
  cors({
    origin: (origin, callback) => {
      console.log(`[DEBUG] CORS Origin Header: ${origin}`);
      const allowedOrigins = [
        'https://mila-verse.vercel.app',
        'https://mila-verse-7ftxkl9b0-bears-projects-464726ee.vercel.app',
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`[ERROR] CORS Rejected Origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);



// Validate Supabase initialization
if (!supabase) {
  console.error('[CRITICAL] Supabase client failed to initialize.');
  process.exit(1);
}

// Debugging middleware
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[DEBUG] Request: ${req.method} ${req.url}`);
    console.log(`[DEBUG] Headers:`, req.headers);
    next();
  });
}

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
process.on('SIGINT', async () => {
  console.log('[INFO] SIGINT signal received: closing server...');
  // Add async cleanup tasks if needed
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[INFO] SIGTERM signal received: closing server...');
  // Add async cleanup tasks if needed
  process.exit(0);
});

export default app;
