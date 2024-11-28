// index.js
import express from 'express';
import cors from 'cors';
import setupBusinessRouter from './setup-business.js'; // Import the setup-business router

const app = express();

// Middleware
app.use(express.json()); // Middleware to parse JSON bodies
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app', // Allowed origin
    methods: ['GET', 'POST', 'OPTIONS'], // Allowed methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    credentials: true, // Allow credentials
  })
);

// Debugging Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
  if (Object.keys(req.body).length) {
    console.log('[DEBUG] Request Body:', req.body);
  }
  next();
});

// Routes
app.use('/setup-business', setupBusinessRouter); // Use the setup-business router

// Root Route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root route hit');
  res.status(200).send('Welcome to the Node.js Serverless Function!');
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[ERROR] Global Error Handler:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[INFO] Server is running on http://localhost:${PORT}`);
});

export default app;
