import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import assistant from './assistant.js';
import setupBusiness from './setup-business.js';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const app = express();

// Middleware for JSON parsing
app.use(express.json());

// Debugging middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to ${req.url} - Method: ${req.method}`);
  next();
});

// CORS middleware configuration
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app', // Allow requests from this origin
    methods: ['GET', 'POST', 'OPTIONS'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    credentials: true, // Allow cookies and credentials
  })
);

// Root route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root Route Hit');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Instagram webhook integration
app.use('/instagram-webhook', instagramWebhook);

// Vonage routes for SMS and calls
app.post('/vonage/send-sms', async (req, res) => {
  const { to, text } = req.body;
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

// Business setup API for customer data handling
app.use('/setup-business', setupBusiness);

app.post('/setup-business', (req, res) => {
  const { businessName, ownerName, contactEmail } = req.body;

  if (!businessName || !ownerName || !contactEmail) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  res.status(200).json({
    message: 'Business setup completed successfully!',
    data: { businessName, ownerName, contactEmail },
  });
});

// Google Calendar API routes
app.post('/google-calendar/event', async (req, res) => {
  try {
    const event = await createGoogleCalendarEvent(req.body);
    res.status(200).json({ success: true, event });
  } catch (error) {
    console.error('[ERROR] Google Calendar event creation failed:', error);
    res.status(500).json({ error: 'Failed to create Google Calendar event' });
  }
});

app.get('/google-calendar/events', async (req, res) => {
  try {
    const events = await getUpcomingEvents(req.query.maxResults || 10);
    res.status(200).json({ success: true, events });
  } catch (error) {
    console.error('[ERROR] Google Calendar fetch failed:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR] An error occurred:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
