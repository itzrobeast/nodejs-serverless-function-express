import express from 'express';
import cors from 'cors';

const router = express.Router();

// Enable CORS for this route
router.use(
  cors({
    origin: 'https://mila-verse.vercel.app',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Handle OPTIONS requests
router.options('/', (req, res) => {
  res.sendStatus(204); // Respond with "No Content" for preflight
});

// Main POST route
router.post('/', (req, res) => {
  const { businessName, ownerName, contactEmail } = req.body;

  if (!businessName || !ownerName || !contactEmail) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  res.status(200).json({
    message: 'Business setup completed successfully!',
    data: { businessName, ownerName, contactEmail },
  });
});

export default router;
