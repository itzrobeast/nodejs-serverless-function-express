import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import setupBusiness from './setup-business.js';
import assistant from './assistant.js';
import googleCalendar from './google-calendar.js';

const app = express();

// Apply Middleware
app.use(express.json()); // Parse JSON
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app', // Allow your frontend
    methods: ['GET', 'POST', 'OPTIONS'], // Allowed methods
    allowedHeaders: ['Content-Type'], // Allowed headers
    credentials: true, // Include credentials
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
