// index.js
import express from 'express';

const app = express();

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

export default app;

{
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  }
}
