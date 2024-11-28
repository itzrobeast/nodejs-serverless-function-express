import express from 'express';
import cors from 'cors';

const app = express();

// Global Middleware for JSON Parsing
app.use(express.json());

// CORS Configuration
app.use(
  cors({
    origin: 'https://mila-verse.vercel.app', // Allow requests from this origin
    methods: ['GET', 'POST', 'OPTIONS'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    credentials: true, // Allow cookies and credentials
  })
);

// Example Route
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
