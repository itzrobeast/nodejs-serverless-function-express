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
    const { to, from, speech } = req.body;

    console.log(`[INFO] Inbound call received: From ${from}, To ${to}`);
    if (speech?.text) console.log(`[INFO] Transcription: ${speech.text}`);

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

    // Step 2: Detect language from transcription (simple example)
    let detectedLanguage = 'en-US'; // Default to English
    if (speech?.text?.match(/[áéíóúñ]/i)) {
      detectedLanguage = 'es-US'; // Switch to Spanish if specific characters are detected
    }

    console.log(`[INFO] Detected language: ${detectedLanguage}`);

    // Step 3: Process AI response if transcription is available
    if (speech?.text) {
      const assistantResponse = await assistantHandler({
        userMessage: speech.text,
        businessId,
        platform: 'phone',
      });

      console.log('[DEBUG] Assistant response:', assistantResponse.message);

      // Step 4: Respond in the detected language
      const responseText =
        detectedLanguage === 'es-US'
          ? `Respuesta en español: ${assistantResponse.message || '¿Cómo puedo ayudarle?'}`
          : assistantResponse.message || 'How can I assist you?';

      return res.json([
        {
          action: 'talk',
          language: detectedLanguage,
          style: detectedLanguage === 'es-US' ? 3 : 14, // Use different styles for Spanish/English
          text: responseText,
        },
      ]);
    }

    // Step 5: Prompt the user for input in their language
    const promptText =
      detectedLanguage === 'es-US'
        ? '¡Hola! Este es el recepcionista de inteligencia artificial. ¿Cómo puedo ayudarle hoy?'
        : 'Hello! This is the AI receptionist. How can I assist you today?';

    return res.json([
      {
        action: 'talk',
        language: detectedLanguage,
        style: detectedLanguage === 'es-US' ? 3 : 14, // Use Spanish or English style
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
