// Simplified instagram-webhook.js
export default async function handler(req, res) {
  console.log("Received request:", req.method);

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log("Verification successful, returning challenge:", challenge);
      return res.status(200).send(challenge); // Respond with only the challenge
    } else {
      console.error("Verification failed");
      return res.status(403).send("Verification failed");
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
