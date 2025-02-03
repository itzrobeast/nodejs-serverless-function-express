import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
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
import assistantRouter from './assistant.js';
import instagramWebhookRouter from './instagram-webhook.js';
import leadgenWebhookRouter from './leadgen-webhook.js';
import getBusinessRouter from './get-business.js';
import getVonageNumberRouter from './get-vonage-number.js';
import retrieveLeadsRouter from './retrieve-leads.js';
import verifySessionRouter from './auth/verify-session.js';
import refreshTokenRouter from './auth/refresh-token.js';
import loginRouter from './auth/login.js';
import logoutRouter from './auth/logout.js';
import {
  handleInboundCall,
  handleCallEvent,
  handleFallback,
  handleInboundMessage,
  handleCallStatus,
  handleInputWebhook,
} from './vonage.js';
import inboundCallsRouter from './inbound-calls.js';
import sessionRouter from './session.js';
import processAudioHandler from "./process-audio.js";

const app = express();


// Trust proxy settings for Vercel and other platforms
app.set('trust proxy', 1); // Trust first proxy (necessary for X-Forwarded-For)

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP
  message: 'Too many login attempts, try again later.',
});

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For URL-encoded form data

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP to allow inline styles/scripts if needed
  })
);

app.use(cookieParser());


// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      console.log(`[DEBUG] CORS Origin Header: ${origin}`);
      const allowedOrigins = ['https://mila-verse.vercel.app'];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`[ERROR] CORS Rejected Origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
  })
);

app.use('/session', sessionRouter);

app.post("/process-audio", processAudioHandler);


// Validate Supabase initialization
if (!supabase) {
  console.error('[CRITICAL] Supabase client failed to initialize.');
  process.exit(1);
}

// Debugging middleware for development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[DEBUG] Request: ${req.method} ${req.url}`);
    console.log(`[DEBUG] Headers:`, req.headers);
    next();
  });
}


const inboundCallRouter = express.Router();
inboundCallRouter.get('/', handleInboundCall);
inboundCallRouter.post('/', handleInboundCall);

const callEventRouter = express.Router();
callEventRouter.get('/', handleCallEvent);
callEventRouter.post('/', handleCallEvent);

const fallbackRouter = express.Router();
fallbackRouter.get('/', handleFallback);
fallbackRouter.post('/', handleFallback);

const inboundMessageRouter = express.Router();
inboundMessageRouter.get('/', handleInboundMessage);
inboundMessageRouter.post('/', handleInboundMessage);

const callStatusRouter = express.Router();
callStatusRouter.get('/', handleCallStatus);
callStatusRouter.post('/', handleCallStatus);

const inputWebhookRouter = express.Router();
inputWebhookRouter.post('/', handleInputWebhook);
inputWebhookRouter.get('/', handleInputWebhook);



// Route Handlers
const routes = [
  { path: '/assistant', router: assistantRouter },
  { path: '/instagram-webhook', router: instagramWebhookRouter },
  { path: '/leadgen-webhook', router: leadgenWebhookRouter },
  { path: '/get-business', router: getBusinessRouter },
  { path: '/get-vonage-number', router: getVonageNumberRouter },
  { path: '/retrieve-leads', router: retrieveLeadsRouter },
  { path: '/auth/verify-session', router: verifySessionRouter },
  { path: '/auth/refresh-token', router: refreshTokenRouter },
  { path: '/auth/login', router: loginRouter },
  { path: '/auth/logout', router: logoutRouter },
  { path: '/vonage/inbound-call', router: inboundCallRouter },
  { path: '/vonage/event', router: callEventRouter },
  { path: '/vonage/fallback', router: fallbackRouter },
  { path: '/vonage/inbound', router: inboundMessageRouter },
  { path: '/vonage/status', router: callStatusRouter },
  { path: '/vonage/input-webhook', router: inputWebhookRouter },

  { path: '/inbound-calls', router: inboundCallsRouter },
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
  res.status(200).send('MilaVerse Backend is running!');
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
  process.exit(0);
});


export default app;
