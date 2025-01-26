import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: process.env.VONAGE_PRIVATE_KEY,
});

/**
 * Handle inbound calls (Answer URL).
 */
export const handleInboundCall = async (req, res) => {
  try {
    console.log('[DEBUG] Inbound Call Request Body:', req.body); // Log the full request body

    const { to, from } = req.body;

    if (!to || !from) {
      console.error('[ERROR] Missing "to" or "from" in the request payload:', req.body);
      return res.json([{ action: 'talk', text: 'Sorry, we cannot process your call due to missing information.' }]);
    }

    console.log(`[INFO] Inbound call received: From ${from}, To ${to}`);

    // Fetch the business associated with the called number
    const { data: businessData, error: businessError } = await supabase
      .from('vonage_numbers')
      .select('business_id')
      .eq('vonage_number', to)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found for number:', to);
      return res.json([{ action: 'talk', text: 'Sorry, we cannot process your call at this time.' }]);
    }

    // Use assistantHandler to generate Mila's response
    const assistantResponse = await assistantHandler({
      userMessage: `Inbound call received from ${from}. How should I assist?`,
      businessId: businessData.business_id,
      platform: 'phone',
    });

    return res.json([
      {
        action: 'talk',
        text: assistantResponse.message || 'Thank you for calling. How can I help you today?',
      },
    ]);
  } catch (error) {
    console.error('[ERROR] Failed to process inbound call:', error.message);
    return res.json([{ action: 'talk', text: 'Unable to process your call. Please try again later.' }]);
  }
};

/**
 * Handle call events (Event URL).
 */
export const handleCallEvent = async (req, res) => {
  try {
    const { status, to, from } = req.query; // Handle query parameters for GET
    console.log(`[INFO] Call event: ${status}, To: ${to}, From: ${from}`);

    // Optional: Log the event to the database
    await supabase.from('call_events').insert([
      {
        status,
        to,
        from,
        event_time: new Date(),
      },
    ]);

    res.status(200).send('Event received');
  } catch (error) {
    console.error('[ERROR] Failed to handle call event:', error.message);
    res.status(500).send('Failed to handle call event');
  }
};

/**
 * Handle fallback for Answer URL (Fallback URL).
 */
export const handleFallback = async (req, res) => {
  try {
    console.error('[ERROR] Fallback URL triggered:', req.query || req.body);
    return res.json([{ action: 'talk', text: 'We are unable to process your call at the moment. Please try again later.' }]);
  } catch (error) {
    console.error('[ERROR] Failed to handle fallback:', error.message);
    return res.status(500).send('Failed to handle fallback');
  }
};

/**
 * Handle inbound messages or events (Inbound URL).
 */
export const handleInboundMessage = async (req, res) => {
  try {
    const { text, msisdn } = req.body || req.query;
    console.log(`[INFO] Inbound message from ${msisdn}: ${text}`);

    // Respond to the inbound message using Mila's assistant
    const assistantResponse = await assistantHandler({
      userMessage: text,
      platform: 'sms',
    });

    return res.status(200).json({
      message: assistantResponse.message || 'Thank you for your message!',
    });
  } catch (error) {
    console.error('[ERROR] Failed to handle inbound message:', error.message);
    return res.status(500).send('Failed to handle inbound message');
  }
};

/**
 * Handle call status updates (Status URL).
 */
export const handleCallStatus = async (req, res) => {
  try {
    const { status, conversation_uuid } = req.body || req.query;
    console.log(`[INFO] Call status update: ${status}, Conversation UUID: ${conversation_uuid}`);

    // Optional: Log the status to the database
    await supabase.from('call_status_updates').insert([
      {
        status,
        conversation_uuid,
        status_time: new Date(),
      },
    ]);

    res.status(200).send('Status received');
  } catch (error) {
    console.error('[ERROR] Failed to handle call status:', error.message);
    res.status(500).send('Failed to handle call status');
  }
};
