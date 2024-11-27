import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import setupBusiness from './setup-business.js';
import assistant from './assistant.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const app = express();

// Middleware
app.use(express.json());

// CORS Configuration
const allowedOrigin = 'https://mila-verse.vercel.app';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));

// Routes
app.use('/instagram-webhook', instagramWebhook);
app.use('/setup-business', setupBusiness);
app.use('/assistant', assistant);

// Add Google Calendar Routes
app.post('/google-calendar/event', async (req, res) => {
  try {
    const event = await createGoogleCalendarEvent(req.body);
    res.status(200).json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/google-calendar/events', async (req, res) => {
  try {
    const events = await getUpcomingEvents(req.query.maxResults || 10);
    res.status(200).json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
