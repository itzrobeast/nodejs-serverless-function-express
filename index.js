import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';
import assistant from './assistant.js';
import setupBusiness from './setup-business.js';
import vonageRoutes from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const app = express();

// Middleware for JSON parsing
app.use(express.json());

// Debugging middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`[DEBUG] Request to ${req.url} - Method: ${req.method}`);
  next();
});

// CORS middleware configuration
const allowedOrigins = ['https://mila-verse.vercel.app'];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
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
app.use('/vonage', vonageRoutes);

// Assistant API for handling AI-driven tasks
app.use('/assistant', assistant);

// Business setup API for customer data handling
app.use('/setup-business', setupBusiness);

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
    console.error('[ERROR] Failed to fetch Google Calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Fallback route for undefined paths
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error-handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR] Uncaught exception:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Export the app for serverless deployment
export default app;
