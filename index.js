import express from 'express';

const app = express();

// Test Middleware
app.use((req, res, next) => {
  console.log('[DEBUG] Middleware working:', req.method, req.url);
  next();
});

// Test Route
app.post('/instagram-webhook', (req, res) => {
  console.log('[DEBUG] Test Route Hit');
  res.status(200).send('Test route working');
});

// Root Test Route
app.get('/', (req, res) => {
  console.log('[DEBUG] Root Route Hit');
  res.status(200).send('Root route working');
});

// Export App
export default app;
