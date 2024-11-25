export const applyCors = (res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://mila-verse.vercel.app'); // Replace with your frontend domain
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allowed methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Allowed headers
};
