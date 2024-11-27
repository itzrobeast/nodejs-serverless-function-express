import express from 'express';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Debug Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to: ${req.method} ${req.url}`);
  next();
});

// Middleware for JSON Parsing
app.use(express.json());

// Register Test Route
app.use('/instagram-webhook', instagramWebhook);

// Root Route for Testing
app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

// Global Error Handling
app.use((err, req, res, next) => {
  console.error('[ERROR] Uncaught Exception:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Export App
export default app;
