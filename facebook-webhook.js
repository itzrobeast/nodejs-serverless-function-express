export default async function handler(req, res) {
  if (req.method === "GET") {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;

    // Verify the token
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("Webhook verification successful.");
      return res.status(200).send(challenge); // Respond with the challenge to complete verification
    } else {
      console.error("Webhook verification failed.");
      return res.status(403).send("Forbidden"); // Respond with an error if the token doesn't match
    }
  }

  if (req.method === "POST") {
    // Handle webhook events here (e.g., leadgen, messages)
    console.log("Webhook event received:", req.body);
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(405).send("Method Not Allowed");
}
