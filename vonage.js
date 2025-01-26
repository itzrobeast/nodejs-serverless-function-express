/**************************************************/
/** vonage.js -- COMPLETE MASTER CODE (No omissions) */
/**************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';

/**
 * Initialize Vonage SDK.
 * Make sure these environment variables are set:
 *  - VONAGE_API_KEY
 *  - VONAGE_API_SECRET
 *  - VONAGE_APPLICATION_ID
 *  - VONAGE_PRIVATE_KEY
 */
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: process.env.VONAGE_PRIVATE_KEY,
});

/**
 * ---------------------------------------------------------------------------
 * Handle inbound calls (Answer URL).
 * ---------------------------------------------------------------------------
 * Vonage will make a request to this endpoint when a call first arrives.
 * We fetch the "to" and "from" fields from either the request body (POST)
 * or the query string (GET), handle language detection, query the business,
 * then optionally call the AI assistant.
 */
export const handleInboundCall = async (req, res) => {
  try {
    // Retrieve fields from body or query
    // Some Vonage configurations send query params on GET, others JSON on POST.
    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;

    // speech can also come from body if you have a speech-to-text event
    // If you do not receive speech at this point, it will simply be undefined
    const speech = req.body.speech || req.query.speech;

    console.log('[DEBUG] Request Body:', req.body);
    console.log('[DEBUG] Request Query:', req.query);
    console.log(`[INFO] Inbound call received: From ${from}, To ${to}`);

    if (!to || !from) {
      console.error('[ERROR] Missing "to" or "from" in the request payload/query.');
      return res.json([
        {
          action: 'talk',
          language: 'en-US',
          style: 14,
          text: 'Sorry, we cannot process your call due to missing information.',
        },
      ]);
    }

    // Step 1: Fetch the business associated with the called number
    const { data: businessData, error: businessError } = await supabase
      .from('vonage_numbers')
      .select('business_id')
      .eq('vonage_number', to)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found for number:', to);
      return res.json([
        {
          action: 'talk',
          language: 'en-US',
          style: 14,
          text: 'Sorry, we cannot process your call at this time. Please try again later.',
        },
      ]);
    }

    const businessId = businessData.business_id;
    console.log(`[INFO] Matched businessId: ${businessId}`);

    // Step 2: Detect language from transcription (if provided)
    // This is a simple example that checks for Spanish characters
    let detectedLanguage = 'en-US'; // Default to English
    if (speech?.text?.match(/[áéíóúñ]/i)) {
      detectedLanguage = 'es-US'; // Switch to Spanish if we detect these chars
    }

    console.log(`[INFO] Detected language: ${detectedLanguage}`);

    // Step 3: If we have a speech transcription, send it to the assistant
    if (speech?.text) {
      const assistantResponse = await assistantHandler({
        userMessage: speech.text,
        businessId,
        platform: 'phone',
      });

      console.log('[DEBUG] Assistant response:', assistantResponse.message);

      // Step 4: Construct the TTS response in the detected language
      const responseText =
        detectedLanguage === 'es-US'
          ? `Respuesta en español: ${assistantResponse.message || '¿Cómo puedo ayudarle?'}`
          : assistantResponse.message || 'How can I assist you?';

      return res.json([
        {
          action: 'talk',
          language: detectedLanguage,
          style: detectedLanguage === 'es-US' ? 3 : 14, // Different TTS style for Spanish
          text: responseText,
        },
      ]);
    }

    // Step 5: If we do NOT have speech yet, greet the user
    // Typically you'd prompt them to say something
    const promptText =
      detectedLanguage === 'es-US'
        ? '¡Hola! Este es Mila. ¿Cómo puedo ayudarle hoy?'
        : 'Hello! This is Mila. How can I assist you today?';

    return res.json([
      {
        action: 'talk',
        language: detectedLanguage,
        style: detectedLanguage === 'es-US' ? 3 : 14,
        text: promptText,
      },
    ]);
  } catch (error) {
    console.error('[ERROR] Failed to process inbound call:', error.message);
    return res.json([
      {
        action: 'talk',
        language: 'en-US',
        style: 14,
        text: 'We are unable to process your call at this time. Please try again later.',
      },
    ]);
  }
};

/**
 * ---------------------------------------------------------------------------
 * Handle call events (Event URL).
 * ---------------------------------------------------------------------------
 * Vonage will make requests to this endpoint for events like 'answered',
 * 'completed', 'busy', etc.
 */
export const handleCallEvent = async (req, res) => {
  try {
    // Typically Vonage events are sent as query parameters in a GET request
    // e.g. ?status=answered&to=123456789&from=987654321
    const { status, to, from } = req.query;
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
 * ---------------------------------------------------------------------------
 * Handle fallback for Answer URL (Fallback URL).
 * ---------------------------------------------------------------------------
 * If Vonage can't reach your Answer URL or an error occurs,
 * it may call this fallback URL.
 */
export const handleFallback = async (req, res) => {
  try {
    console.error('[ERROR] Fallback URL triggered:', req.query || req.body);
    return res.json([
      {
        action: 'talk',
        text: 'We are unable to process your call at the moment. Please try again later.',
      },
    ]);
  } catch (error) {
    console.error('[ERROR] Failed to handle fallback:', error.message);
    return res.status(500).send('Failed to handle fallback');
  }
};

/**
 * ---------------------------------------------------------------------------
 * Handle inbound SMS or messages (Inbound URL).
 * ---------------------------------------------------------------------------
 * If you're using the Vonage SMS API or messages API,
 * inbound messages may arrive here.
 */
export const handleInboundMessage = async (req, res) => {
  try {
    // Check both body and query for text + msisdn
    const { text, msisdn } = req.body || req.query;
    console.log(`[INFO] Inbound message from ${msisdn}: ${text}`);

    // Respond using the assistant
    const assistantResponse = await assistantHandler({
      userMessage: text,
      platform: 'sms',
    });

    // Return a JSON response or a Nexmo-style response as needed
    return res.status(200).json({
      message: assistantResponse.message || 'Thank you for your message!',
    });
  } catch (error) {
    console.error('[ERROR] Failed to handle inbound message:', error.message);
    return res.status(500).send('Failed to handle inbound message');
  }
};

/**
 * ---------------------------------------------------------------------------
 * Handle call status updates (Status URL).
 * ---------------------------------------------------------------------------
 * Vonage may send call progress or final statuses to this URL.
 */
export const handleCallStatus = async (req, res) => {
  try {
    // Could be body or query
    const { status, conversation_uuid } = req.body || req.query;
    console.log(`[INFO] Call status update: ${status}, Conversation UUID: ${conversation_uuid}`);

    // Optional: Log the status to your DB
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
