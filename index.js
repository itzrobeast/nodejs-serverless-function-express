import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import setupBusiness from './setup-business.js';
import assistant from './assistant.js';
import googleCalendar from './google-calendar.js';

const app = express();

// Middleware
app.use(express.json()); // Parse JSON

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to ${req.url} - Method: ${req.method}`);
  next();
});

// CORS Configuration
const allowedOrigin = 'https://mila-verse.vercel.app'; // Your frontend URL
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

// Routes
app.use('/instagram-webhook', instagramWebhook);
app.use('/setup-business', setupBusiness);
app.use('/assistant', assistant);
app.use('/google-calendar', googleCalendar);

// Root Route
app.get('/', (req, res) => {
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Fallback Route
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Error occurred:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
