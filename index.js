import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Middleware
app.use(express.json()); // JSON parsing middleware
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app', // Allow only your frontend domain
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

// Routes
app.use('/instagram-webhook', instagramWebhook);

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
