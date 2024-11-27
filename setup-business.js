import cors from 'cors';

// Configure CORS middleware
const corsMiddleware = cors({
  origin: 'https://mila-verse.vercel.app', // Replace with your actual frontend URL
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
});

export default async function handler(req, res) {
  // Apply CORS middleware
  return new Promise((resolve) => {
    corsMiddleware(req, res, async () => {
      try {
        // Handle OPTIONS (preflight) requests
        if (req.method === 'OPTIONS') {
          return res.status(204).end(); // Return a successful no-content response
        }

        // Handle POST requests
        if (req.method === 'POST') {
          // Parse the incoming request body
          const { businessName, ownerName, contactEmail } = req.body;

          // Validate the required fields
          if (!businessName || !ownerName || !contactEmail) {
            return res.status(400).json({
              error: 'Missing required fields: businessName, ownerName, or contactEmail',
            });
          }

          // Log the request body for debugging
          console.log('Received data:', { businessName, ownerName, contactEmail });

          // Perform your setup logic here (e.g., save to a database, invoke other APIs, etc.)
          // For this example, we're just echoing the received data
          console.log('Setting up business:', { businessName, ownerName, contactEmail });

          // Respond with success
          return res.status(200).json({
            message: 'Setup business completed successfully!',
            data: { businessName, ownerName, contactEmail },
          });
        }

        // Respond with "Method Not Allowed" for unsupported methods
        return res.status(405).json({
          error: 'Method Not Allowed. Only POST is supported.',
        });
      } catch (error) {
        console.error('Error in setup-business handler:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
      } finally {
        resolve(); // Ensure the promise is resolved to complete the middleware chain
      }
    });
  });
}
