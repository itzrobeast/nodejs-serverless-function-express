import express from 'express';
import cors from 'cors';
import setupBusinessRouter from './setup-business.js';

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/setup-business', setupBusinessRouter);

app.get('/', (req, res) => {
  console.log('[DEBUG] Root route hit');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Global Error Handling
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error Handler:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
