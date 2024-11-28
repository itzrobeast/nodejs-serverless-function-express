import express from 'express';
import cors from 'cors';
import setupBusinessRouter from './setup-business.js';

const app = express();





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
