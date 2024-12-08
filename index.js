import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// Debugging route to list files
app.get('/debug/files', (req, res) => {
  const currentDir = path.resolve();
  fs.readdir(currentDir, (err, files) => {
    if (err) {
      res.status(500).send({ error: err.message });
    } else {
      res.send({ files });
    }
  });
});

export default app;
