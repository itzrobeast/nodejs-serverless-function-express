import express from 'express';

const router = express.Router();

// Define the setup-business POST route
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

export default router; // Export the router
