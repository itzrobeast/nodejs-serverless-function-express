import express from 'express';
import instagramWebhook from './instagram-webhook.js';
import assistant from './assistant.js';
import setupBusinessRouter from './setup-business.js';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const app = express();

// Middleware for JSON parsing
app.use(express.json());

// Custom CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://mila-verse.vercel.app'); // Allow requests from MilaVerse
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Specify allowed headers
  res.setHeader('Access-Control-Allow-Credentials', true); // Allow credentials (cookies, authorization headers, etc.)
  next();
});

// Debugging middleware for logging requests
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to ${req.url} - Method: ${req.method}`);
  next();
});

// Root route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root Route Hit');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Instagram webhook integration
app.use('/instagram-webhook', instagramWebhook);

// Vonage API routes for SMS and calls
app.post('/vonage/send-sms', async (req, res) => {
  const { to, text } = req.body;

  if (!to || !text) {
    return res.status(400).json({ error: 'Missing required fields: to and text' });
  }

  try {
    const response = await sendSMS(to, text);
    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('[ERROR] Failed to send SMS:', error.message);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

app.post('/vonage/make-call', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to and message' });
  }

  try {
    const response = await makeCall(to, message);
    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('[ERROR] Failed to make call:', error.message);
    res.status(500).json({ error: 'Failed to make call' });
  }
});

// Assistant API for handling AI-driven tasks
app.use('/assistant', assistant);

// Business setup API
app.use('/setup-business', setupBusinessRouter); // Ensure setupBusinessRouter is an Express router

// Google Calendar API routes
app.post('/google-calendar/event', async (req, res) => {
  const eventDetails = req.body;

  if (!eventDetails) {
    return res.status(400).json({ error: 'Event details are required' });
  }

  try {
    const event = await createGoogleCalendarEvent(eventDetails);
    res.status(200).json({ success: true, event });
  } catch (error) {
    console.error('[ERROR] Google Calendar event creation failed:', error.message);
    res.status(500).json({ error: 'Failed to create Google Calendar event' });
  }
});

app.get('/google-calendar/events', async (req, res) => {
  const maxResults = req.query.maxResults || 10;

  try {
    const events = await getUpcomingEvents(maxResults);
    res.status(200).json({ success: true, events });
  } catch (error) {
    console.error('[ERROR] Google Calendar fetch failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR] An error occurred:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
