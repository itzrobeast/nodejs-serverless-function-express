import express from 'express';
import setupBusinessRouter from './setup-business.js';

const app = express();

app.use(express.json()); // Core middleware for JSON payloads

// Minimal setup to test `/setup-business`
app.use('/setup-business', setupBusinessRouter);

// Root route for sanity check
app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

// Export the app
export default app;
