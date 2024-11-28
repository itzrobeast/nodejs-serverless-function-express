import express from 'express';
import cors from 'cors';
import setupBusinessRouter from './setup-business.js';

const app = express();



// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`, {
    headers: req.headers,
    body: req.body,
  });
  next();
});
// Middleware
export default async function cors(req, res) {
  const origin = 'https://mila-verse.vercel.app';

  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
}


// Routes
app.use('/setup-business', setupBusinessRouter);

// Root Route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root route accessed');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error Handler:', err.stack);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

export default app;
