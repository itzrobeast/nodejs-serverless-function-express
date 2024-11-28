import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import assistant from './assistant.js';
import setupBusinessRouter from './setup-business.js';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const app = express();

app.use((req, res, next) => {
  console.log(`[DEBUG] Middleware reached for ${req.method} ${req.url}`);
  next();
});

// Global middleware
app.use(express.json()); // Parse JSON
app.use(cors({
  origin: 'https://mila-verse.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Debugging middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
  console.log(`[DEBUG] Request Body:`, req.body);
  next();
});

// Root route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root Route Hit');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Instagram webhook integration
app.use('/instagram-webhook', instagramWebhook);

// Business setup router
app.use('/setup-business', setupBusinessRouter);

// Vonage routes
app.post('/vonage/send-sms', async (req, res) => {
  try {
    const { to, text } = req.body;
    if (!to || !text) throw new Error('Missing required fields: to and text');

    const response = await sendSMS(to, text);
    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('[ERROR] Failed to send SMS:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/vonage/make-call', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) throw new Error('Missing required fields: to and message');

    const response = await makeCall(to, message);
    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('[ERROR] Failed to make call:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Assistant integration
app.use('/assistant', assistant);

// Google Calendar routes
app.post('/google-calendar/event', async (req, res) => {
  try {
    const eventDetails = req.body;
    if (!eventDetails) throw new Error('Event details are required');

    const event = await createGoogleCalendarEvent(eventDetails);
    res.status(200).json({ success: true, event });
  } catch (error) {
    console.error('[ERROR] Google Calendar event creation failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/google-calendar/events', async (req, res) => {
  try {
    const maxResults = req.query.maxResults || 10;
    const events = await getUpcomingEvents(maxResults);
    res.status(200).json({ success: true, events });
  } catch (error) {
    console.error('[ERROR] Failed to fetch events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error Handler:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
