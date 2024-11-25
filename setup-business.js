import { applyCors } from './utils/cors'; // Adjust the path as necessary

export default async function handler(req, res) {
  try {
    // Apply CORS headers
    applyCors(res);

    // Handle OPTIONS (preflight) requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Handle POST requests
    if (req.method === 'POST') {
      // Extract and validate the request body (if needed)
      const { businessName, ownerName, contactEmail } = req.body;

      if (!businessName || !ownerName || !contactEmail) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Perform your setup logic here (e.g., saving to a database, calling other APIs)
      console.log('Setting up business:', { businessName, ownerName, contactEmail });

      // Respond with success
      return res.status(200).json({ message: 'Setup business completed successfully!' });
    }

    // If method is not allowed
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Error in setup-business handler:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
