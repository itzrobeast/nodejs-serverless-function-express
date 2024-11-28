import express from 'express';
import setupBusinessRouter from './setup-business.js';

const app = express();

app.use(express.json());

// Route registration
app.use('/setup-business', setupBusinessRouter);

// Root health check
app.get('/', (req, res) => {
  res.status(200).send('Root Route is Working!');
});

export default app;
