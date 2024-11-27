import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Apply JSON parsing middleware
app.use(express.json());

app.use(cors());

// Centralized CORS configuration (if needed)
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mila-verse.vercel.app';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Default route for root path
app.get('/', (req, res) => {
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Mount the Instagram webhook route
app.use('/instagram-webhook', instagramWebhook);

// Handle favicon requests to avoid 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // No Content
});

// Fallback for unknown routes
app.use((req, res) => {
  res.status(404).send('Route not found');
});

// Export the app for serverless deployment
export default app;
