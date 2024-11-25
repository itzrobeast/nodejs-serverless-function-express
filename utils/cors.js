
export const applyCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://mila-verse.vercel.app'); // Allow only your frontend domain
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allow methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Allow specific headers
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // Allow cookies if needed
};
