import express from 'express';
import { applyCors } from './cors'; // Import the centralized CORS utility

const app = express();
app.use(express.json()); // Middleware to parse JSON payloads

// Middleware to apply CORS for all routes
app.use((req, res, next) => {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    // Handle preflight requests
    return res.status(200).end();
  }
  next();
});

// Root route for quick testing
app.get('/', (req, res) => {
  res.send('Welcome to the Application');
});

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`Received token: ${token}`); // Log the incoming token
  console.log(`Expected token: ${process.env.VERIFY_TOKEN}`); // Log the environment variable

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    return res.sendStatus(403); // Forbidden if the token doesn't match
  }
});

// Webhook event handling (POST)
app.post('/webhook', (req, res) => {
  // Log the incoming event for debugging
  console.log('Received webhook event:', req.body);

  // Acknowledge receipt of the webhook event
  res.status(200).send('Webhook received');
});

// Start the server (for local testing)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
