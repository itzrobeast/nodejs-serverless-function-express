import express from 'express';
import cors from 'cors';
import setupBusinessRouter from './setup-business.js';

const app = express();

// Middleware for JSON parsing and CORS
app.use(express.json());
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app', // Replace with your frontend domain
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length) {
    console.log('[DEBUG] Request Body:', req.body);
  }
  next();
});

// Root route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root route hit');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Use the /setup-business router
app.use('/setup-business', setupBusinessRouter);

// Global error handling
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error Handler:', err.message);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

export default app;
