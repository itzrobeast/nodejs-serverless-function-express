import express from 'express';
import cors from 'cors';
import setupBusinessRouter from './setup-business.js';

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`, {
    headers: req.headers,
    body: req.body,
  });
  next();
});

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
