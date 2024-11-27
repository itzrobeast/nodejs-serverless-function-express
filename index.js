import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Use JSON parsing middleware
app.use(express.json());
app.use(cors());

// Use the cors package
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mila-verse.vercel.app';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true, // Adjust if cookies are needed
}));

// Mount the Instagram webhook router
app.use('/instagram-webhook', instagramWebhook);

// Root route
app.get('/', (req, res) => {
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Fallback for unknown routes
app.use((req, res) => {
  res.status(404).send('Route not found');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

export default app;
