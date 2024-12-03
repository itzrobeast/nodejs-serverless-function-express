import { assistantHandler } from './assistant.js'; // Centralized logic
import fetch from 'node-fetch'; // For Instagram API
import supabase from './supabaseClient.js';


// Function to send a direct reply to an Instagram user
async function sendInstagramMessage(recipientId, message) {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message content. Cannot send empty or undefined message.');
    }

    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);

    const response = await fetch(
      `https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`,
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


// Process individual messaging events
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    const userMessage = message?.message?.text; // Extract user message text
    const recipientId = message?.sender?.id;   // Extract sender/recipient ID
    const platform = 'instagram';             // Define the platform as Instagram

    console.log('[DEBUG] Extracted user message:', userMessage);
    console.log('[DEBUG] Extracted recipient ID:', recipientId);

    if (!userMessage || !recipientId) {
      console.error('[ERROR] Missing message or recipient ID:', { userMessage, recipientId });
      return; // Skip processing this message
    }

    // Step 1: Find or insert the user by Instagram ID
let { data: user, error: userError } = await supabase
  .from('users')
  .select('*')
  .eq('ig_id', recipientId)
  .single();

if (userError && userError.code === 'PGRST116') {
  // User not found using Instagram ID, fallback to Facebook ID
  console.log('[INFO] User not found by ig_id, checking fb_id.');
  const { data: fbUser, error: fbUserError } = await supabase
    .from('users')
    .select('*')
    .eq('fb_id', recipientId) // Check if the Instagram ID was mistakenly used in fb_id
    .single();

  if (fbUserError || !fbUser) {
    console.log('[INFO] User not found by fb_id. Creating new user.');
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([{ ig_id: recipientId, name: null, email: null }]); // Add new user

    if (insertError) {
      console.error('[ERROR] Failed to insert new user:', insertError.message);
      await sendInstagramMessage(
        recipientId,
        'An error occurred while creating your user profile. Please contact support.'
      );
      return;
    }

    user = newUser[0]; // Assign the new user to the `user` variable
  } else {
    // Found user by Facebook ID, update Instagram ID
    console.log('[INFO] Found user by fb_id, updating ig_id.');
    const { error: updateError } = await supabase
      .from('users')
      .update({ ig_id: recipientId })
      .eq('id', fbUser.id);

    if (updateError) {
      console.error('[ERROR] Failed to update user with ig_id:', updateError.message);
      await sendInstagramMessage(
        recipientId,
        'An error occurred while linking your Instagram ID. Please contact support.'
      );
      return;
    }

    user = fbUser; // Use the existing Facebook user
    user.ig_id = recipientId; // Add the Instagram ID to the user object
  }
} else if (userError) {
  console.error('[ERROR] Failed to query users table:', userError.message);
  await sendInstagramMessage(
    recipientId,
    'An error occurred while retrieving your user information. Please contact support.'
  );
  return;
}

console.log('[DEBUG] Found or created user:', user);


    // Step 2: Find the business by `owner_id`
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.fb_id)
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Business not found for user:', user.fb_id);
      await sendInstagramMessage(recipientId, 'Could not retrieve business configuration. Please try again later.');
      return;
    }

    console.log('[DEBUG] Found business:', business);
    

    // Pass the extracted data to the assistant


    console.log('[DEBUG] Sending user message to assistant for processing.');
    const assistantResponse = await assistantHandler({ userMessage, recipientId, platform, business, });

    // Send the assistant's response back to Instagram
    if (assistantResponse && assistantResponse.message) {
      console.log('[DEBUG] Assistant response:', assistantResponse.message);
      await sendInstagramMessage(recipientId, assistantResponse.message);
    } else {
      console.warn('[WARN] Assistant response is missing or invalid.');
    }
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
    throw error;
  }
}


// Primary webhook handler
export default async function handler(req, res) {
  console.log('Received request:', req.method);

  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log('Verification successful. Returning challenge.');
      return res.status(200).send(challenge);
    } else {
      console.error('Verification failed.');
      return res.status(403).send('Verification failed.');
    }
  } else if (req.method === 'POST') {
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
      console.error('[ERROR] Failed to process webhook entries:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed.' });
  }
}
