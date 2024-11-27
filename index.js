import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Use JSON parsing middleware
app.use(express.json());

// Use the cors package
const allowedOrigin = 'https://mila-verse.vercel.app';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));

// Mount the Instagram webhook router
app.use('/instagram-webhook', instagramWebhook);

// Root route
app.get('/', (req, res) => {
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

export default app;
