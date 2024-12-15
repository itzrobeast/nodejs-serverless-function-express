import assistantHandler from './assistant.js'; // Centralized logic
import fetch from 'node-fetch'; // For Instagram API
import supabase from './supabaseClient.js';

// Use your Page Access Token for Instagram Business Messaging
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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
        .insert([{ ig_id: igId, fb_id: null, name: null, email: null }]);

      if (insertError) {
        console.error('[ERROR] Failed to insert new user:', insertError.message);
        await sendInstagramMessage(
          senderId,
          'An error occurred while creating your user profile. Please contact support.'
        );
        return;
      }

      user = newUser[0];
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
 * Primary webhook handler (route).
 * - Verify webhook setup on GET
 * - Process incoming Instagram webhook events on POST
 */
export default async function handler(req, res) {
  console.log('Received request:', req.method);

  // Instagram webhook verification
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log('Verification successful. Returning challenge.');
      return res.status(200).send(challenge);
    } else {
      console.error('Verification failed.');
      return res.status(403).send('Verification failed.');
    }
  } 
  // Handle incoming messages/events
  else if (req.method === 'POST') {
    const body = req.body;

    if (!body || !body.object) {
      console.error('[ERROR] Invalid payload:', body);
      return res.status(400).json({ error: 'Invalid payload structure.' });
    }

    try {
      for (const entry of body.entry) {
        console.log('[DEBUG] Processing entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        } else {
          console.warn('[DEBUG] No messaging events found in entry.');
        }
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('[ERROR] Failed to process webhook entries:', error.message);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed.' });
  }
}
