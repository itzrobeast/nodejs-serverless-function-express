import express from 'express';

const app = express();

// Enable JSON body parsing
app.use(express.json());

// Temporary route to directly handle POST requests to `/setup-business`
app.post('/setup-business', (req, res) => {
  try {
    // Extracting data from the request body
    const { platform, businessName, ownerName, contactEmail } = req.body;

    // Log the received data for debugging
    console.log('[DEBUG] Received POST data:', req.body);

    // Validate input fields
    if (!platform || !businessName || !ownerName || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields: platform, businessName, ownerName, or contactEmail',
        receivedData: req.body,
      });
    }

    // Simulate success response
    return res.status(200).json({
      message: 'Business setup successful!',
      data: { platform, businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error('[ERROR] Error handling /setup-business:', error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Root health check for testing server
app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

// Start the server locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[DEBUG] Server running on http://localhost:${PORT}`);
});
