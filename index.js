import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Apply JSON parsing middleware
app.use(express.json());

// Centralized CORS configuration
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mila-verse.vercel.app';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Mount the Instagram webhook route
app.use('/instagram-webhook', instagramWebhook);

// Export the app for serverless deployment
export default app;
