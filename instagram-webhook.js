import express from 'express';
import fetch from 'node-fetch'; // For Instagram API
import axios from 'axios'; // For Leadgen API
import supabase from './supabaseClient.js'; // Your Supabase client
import assistantHandler from './assistant.js'; // Centralized assistant logic

const router = express.Router();

// Load environment variables
const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN; // Webhook verify token
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // Facebook Page Access Token

/**
 * Send a direct reply to an Instagram user using your Page Access Token.
 */
async function sendInstagramMessage(recipientId, message) {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message content. Cannot send empty or undefined message.');
    }

    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);

    if (!PAGE_ACCESS_TOKEN) {
      throw new Error('Missing PAGE_ACCESS_TOKEN environment variable.');
    }

    const response = await fetch(
      `https://graph.facebook.com/v14.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error sending message to Instagram:', errorText);
      throw new Error(`Failed to send Instagram message: ${response.statusText}`);
    }

    console.log('Message sent to Instagram user successfully.');
    return await response.json();
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error);
    throw error;
  }
}

/**
 * Process individual messaging events from the Instagram webhook callback.
 * This version includes checks for non-text events (reactions, read receipts, unsend, etc.).
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    // 1. Handle special event types early
    if (message?.reaction) {
      // Reaction event: user reacted with a heart, etc.
      console.log('[INFO] Received a reaction event:', message.reaction);
      return;
    }
    if (message?.delivery) {
      // Delivery receipt: Facebook acknowledging message(s) delivered
      console.log('[INFO] Delivery receipt event:', message.delivery);
      return;
    }
    if (message?.read) {
      // Read receipt: user opened/seen the message
      console.log('[INFO] Read receipt event:', message.read);
      return;
    }
    if (message?.message?.is_unsent) {
      // User unsent/deleted their message
      console.log('[INFO] User unsent a message:', message);
      return;
    }
    if (message?.message?.attachments) {
      // Attachments event: user sent images, videos, or other media
      console.log('[INFO] Received an attachment event:', message.message.attachments);
      // Optionally handle attachments or skip
      return;
    }

    // 2. Now handle standard text messages
    const userMessage = message?.message?.text;  // Extract text
    const igId = message?.recipient?.id;         // Our Instagram business account ID
    const senderId = message?.sender?.id;        // The user interacting with the bot
    const platform = 'instagram';

    console.log('[DEBUG] Extracted user message:', userMessage);
    console.log('[DEBUG] Extracted Instagram User ID (ig_id):', igId);
    console.log('[DEBUG] Extracted sender ID (customer):', senderId);

    if (!userMessage || !igId || !senderId) {
      console.error('[ERROR] Missing message, ig_id, or senderId:', {
        userMessage,
        igId,
        senderId,
      });
      return; // Skip processing if it's not a valid text event
    }

    // 3. Find or create user in Supabase
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('ig_id', igId)
      .maybeSingle();

    if (!user && !userError) {
      console.log('[INFO] User not found by ig_id. Creating new user.');
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ ig_id: igId, fb_id: null, name: null, email: null }])
        .single();

      if (insertError) {
        console.error('[ERROR] Failed to insert new user:', insertError.message);
        await sendInstagramMessage(
          senderId,
          'An error occurred while creating your user profile. Please contact support.'
        );
        return;
      }

      user = newUser;
    } else if (userError) {
      console.error('[ERROR] Failed to query users table:', userError.message);
      await sendInstagramMessage(
        senderId,
        'An error occurred while retrieving your user information. Please contact support.'
      );
      return;
    }

    console.log('[DEBUG] Found or created user:', user);

    // 4. Pass data to the assistant for a response
    console.log('[DEBUG] Sending user message to assistant for processing.');
    const assistantResponse = await assistantHandler({
      userMessage,
      recipientId: senderId,
      platform,
      businessId: user.fb_id, // If you need the user's fb_id for any reason
    });

    // 5. Send the assistant's response back to the user (if any)
    if (assistantResponse && assistantResponse.message) {
      console.log('[DEBUG] Assistant response:', assistantResponse.message);
      await sendInstagramMessage(senderId, assistantResponse.message);
    } else {
      console.warn('[WARN] Assistant response is missing or invalid.');
    }
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
    throw error;
  }
}

/**
 * Process individual leadgen events from the Facebook webhook callback.
 */
async function processLeadgenEvent(change) {
  const leadgenId = change.value.leadgen_id;
  const formId = change.value.form_id;

  console.log(`[DEBUG] New lead received! Lead ID: ${leadgenId}, Form ID: ${formId}`);

  try {
    // 1. Fetch lead data from Graph API
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${PAGE_ACCESS_TOKEN}`
    );

    const leadData = response.data;
    console.log("[DEBUG] Lead Data fetched:", JSON.stringify(leadData, null, 2));

    // 2. Fetch business_id using form_id from the 'forms' table
    let { data: form, error: formError } = await supabase
      .from('forms')
      .select('business_id')
      .eq('form_id', formId)
      .maybeSingle();

    let businessId;

    if (formError) {
      console.error("[ERROR] Fetching business_id from forms table failed:", formError.message);
      // Depending on your application's requirements, you might choose to throw here or attempt to resolve dynamically
      // For this solution, we'll attempt to resolve dynamically
    }

    if (!form || !form.business_id) {
      console.log(`[INFO] Form ID ${formId} not found. Attempting to resolve business_id dynamically.`);

      // Attempt to resolve business_id dynamically
      // This requires that you have a way to associate the leadgen event with a business
      // For example, if the leadgen form is associated with a specific page or user

      // Step 1: Extract page_id or another identifier from leadData
      // Note: Adjust the path based on the actual structure of leadData
      const pageId = leadData?.page_id || leadData?.pageID || null;

      if (!pageId) {
        console.error("[ERROR] Unable to extract page_id from lead data. Cannot resolve business_id.");
        return; // Exit the function as business_id is essential
      }

      // Step 2: Fetch business_id from 'businesses' table using page_id
      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .select('id')
        .eq('page_id', pageId) // Assuming 'page_id' is a column in your 'businesses' table
        .single();

      if (businessError || !businessData) {
        console.error('[ERROR] Failed to fetch business for page_id:', businessError?.message || 'No business found');
        return; // Exit the function as business_id is essential
      }

      businessId = businessData.id;
      console.log(`[DEBUG] Resolved business_id: ${businessId} for page_id: ${pageId}`);

      // Step 3: Upsert the form into the 'forms' table with the resolved business_id
      const { data: formData, error: upsertError } = await supabase
        .from('forms')
        .upsert([
          {
            form_id: formId,
            business_id: businessId,
            name: 'Auto-added Form', // You can customize this as needed
            platform: 'Facebook',     // Assuming platform info is relevant
          },
        ])
        .select()
        .single();

      if (upsertError) {
        console.error('[ERROR] Failed to upsert form:', upsertError.message);
        return; // Exit the function as form insertion failed
      }

      console.log('[DEBUG] Auto-inserted or updated form:', formData);

      // Now, set businessId for saving the lead
      businessId = formData.business_id;
    } else {
      // Form exists and has a business_id
      businessId = form.business_id;
      console.log(`[DEBUG] Retrieved business_id: ${businessId} for form_id: ${formId}`);
    }

    // 3. Save lead data to the database with business_id
    const { data, error } = await supabase.from("leads").insert([
      {
        leadgen_id: leadgenId,
        form_id: formId,
        business_id: businessId, // Include business_id here
        lead_data: leadData,
      },
    ]);

    if (error) {
      console.error("[ERROR] Saving lead to database failed:", error.message);
    } else {
      console.log("[DEBUG] Lead saved successfully to database:", data);
    }
  } catch (error) {
    console.error(
      "[ERROR] Fetching lead data failed:",
      error.response ? error.response.data : error.message
    );
  }
}

// Webhook verification endpoint (GET)
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Instagram Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    console.log("Instagram Webhook verification failed.");
    res.sendStatus(403);
  }
});

// Webhook event handler (POST)
router.post("/", async (req, res) => {
  const body = req.body;

  if (!body) {
    console.error('[ERROR] Received empty body.');
    return res.status(400).send('Invalid request body.');
  }

  try {
    // Handle Leadgen Events (object === 'page')
    if (body.object === "page") {
      for (const entry of body.entry) {
        console.log('[DEBUG] Processing page entry:', entry);

        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === "leadgen") {
              await processLeadgenEvent(change);
            }
          }
        } else {
          console.warn('[WARN] No changes found in page entry.');
        }
      }
    }

    // Handle Messaging Events (object === 'instagram')
    else if (body.object === "instagram") {
      for (const entry of body.entry) {
        console.log('[DEBUG] Processing instagram entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        } else {
          console.warn('[WARN] No messaging events found in instagram entry.');
        }
      }
    }

    // Handle other objects if necessary
    else {
      console.log("Unhandled webhook event type:", body.object);
    }

    // Respond with 200 OK to acknowledge receipt of the event
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('[ERROR] Failed to process webhook events:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
