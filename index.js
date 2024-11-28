import express from 'express';
import setupBusinessRouter from './setup-business.js';

const app = express();

// Middleware
app.use(express.json());

// Root Route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root Route Hit');
  res.send('Root Route Active');
});

// Setup Business Route
app.use('/setup-business', setupBusinessRouter);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
