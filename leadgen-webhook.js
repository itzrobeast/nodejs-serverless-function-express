const express = require("express");
const axios = require("axios");
const router = express.Router();

// Load environment variables
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Your webhook verify token
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // Your Facebook page access token

// Webhook verification endpoint
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed.");
    res.sendStatus(403);
  }
});

// Webhook event handler
router.post("/", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      const changes = entry.changes;

      for (const change of changes) {
        if (change.field === "leadgen") {
          const leadgenId = change.value.leadgen_id;
          const formId = change.value.form_id;

          console.log(`New lead received! Lead ID: ${leadgenId}, Form ID: ${formId}`);

          try {
            // Fetch the lead data
            const response = await axios.get(
              `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${PAGE_ACCESS_TOKEN}`
            );

            const leadData = response.data;
            console.log("Lead Data:", leadData);

            // Store lead data or send it to the frontend
            // e.g., Save to DB, or integrate with a third-party CRM
          } catch (error) {
            console.error("Error fetching lead:", error.response ? error.response.data : error.message);
          }
        }
      }
    });

    res.status(200).send("EVENT_RECEIVED");
  } else {
    console.log("Unhandled webhook event:", body);
    res.sendStatus(404);
  }
});

module.exports = router;
