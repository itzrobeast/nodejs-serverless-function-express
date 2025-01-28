/*****************************************************/
/** vonage.js -- COMPLETE MASTER CODE (No Omissions) **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';
import { logConversation } from './logConversation.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Initialize Vonage SDK with environment variables:
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

/**********************************************************************
 * 1) Answer URL - handleInboundCall
 *
 *   - Looks up the business by Vonage number (businessId, name).
 *   - Creates a conversationId for multi-turn logging.
 *   - Logs "conversation started."
 *   - Returns an NCCO with talk + input.
 **********************************************************************/
export const handleInboundCall = async (req, res) => {
  try {
    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;

    if (!to || !from) {
      console.error('[ERROR] Missing "to" or "from" in inbound call');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, we cannot process this call due to missing information.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    // 1a) Find businessId from vonage_numbers
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
          text: 'Sorry, we cannot process your call at this time.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }
    const businessId = businessData.business_id;

    // 1b) Fetch the business name
    const { data: businessInfo, error: businessInfoError } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    if (businessInfoError || !businessInfo) {
      console.error('[ERROR] Failed to fetch business name:', businessInfoError?.message || 'No data');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, we cannot process your call at this time.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }
    const businessName = businessInfo.name || 'our business';

    // 1c) Create a conversationId
    const conversationId = uuidv4();

    // 1d) Log conversation start
    await supabase.from('inbound_calls').insert([
      {
        conversation_id: conversationId,
        sender_phone: from,
        receiver_phone: to,
        business_id: businessId,
        message: 'Conversation started',
        message_type: 'system',
        role: 'system',
        timestamp: new Date().toISOString(),
      },
    ]);

    // 1e) Construct talk + input
    const eventUrlWithParams =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const ncco = [
      {
        action: 'talk',
        text: `Hello, this is Mila from ${businessName}. How can I assist you today?`,
        language: 'en-US',
        style: 14,
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [eventUrlWithParams],
        speech: {
          endOnSilence: 0.2,
          language: 'en-US',
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    return res.json(ncco);
  } catch (err) {
    console.error('[ERROR] handleInboundCall:', err.message);
    return res.json([
      {
        action: 'talk',
        text: 'We are unable to process your call at this time. Please try again later.',
        language: 'en-US',
        style: 14,
      },
    ]);
  }
};

/**********************************************************************
 * 2) Input Webhook - handleInputWebhook
 *
 *   - The user has spoken or pressed digits.
 *   - Log their input.
 *   - Return a typing sound (stream) + notify action calls /processing-webhook.
 **********************************************************************/
export const handleInputWebhook = async (req, res) => {
  try {
    const { businessId, conversationId } = req.query;
    if (!businessId) {
      console.error('[ERROR] Missing "businessId" in Input Webhook');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, something went wrong. Goodbye.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    // Extract speech or dtmf
    const from = req.body.from;
    const to = req.body.to;
    const userSpeech = req.body.speech?.results?.[0]?.text || '';
    const userDtmf = req.body.dtmf?.digits || '';
    const userText = userSpeech
      ? userSpeech.toLowerCase()
      : userDtmf
      ? `DTMF digit: ${userDtmf}`
      : '';

    console.log('[DEBUG] InputWebhook request:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] userText:', userText);

    // Log user message if it’s not empty
    if (userText.trim()) {
      await logConversation({
        businessId,
        senderPhone: from,
        receiverPhone: to,
        message: userText,
        messageType: userSpeech ? 'speech' : userDtmf ? 'dtmf' : 'other',
        role: 'customer',
        conversationId,
      });
    }

    // Return typing sound + notify
    const typingSoundUrl = 'https://f004.backblazeb2.com/file/typewriter-typing/typewriter.mp3';
    const processingWebhookUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/processing-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const typingNcco = [
      {
        // The user hears continuous typing until replaced by the next NCCO
        action: 'stream',
        streamUrl: [typingSoundUrl],
        loop: 0, // infinite
      },
      {
        // The notify action calls /processing-webhook asynchronously
        action: 'notify',
        payload: { userText },
        eventUrl: [processingWebhookUrl],
      },
    ];

    res.json(typingNcco);
  } catch (err) {
    console.error('[ERROR] handleInputWebhook:', err.message);
    return res.json([
      {
        action: 'talk',
        text: 'Sorry, something went wrong. Goodbye.',
        language: 'en-US',
        style: 14,
      },
    ]);
  }
};

/**********************************************************************
 * 3) Processing Webhook - handleProcessingWebhook
 *
 *   - Called by notify while typing is playing.
 *   - Immediately responds with a placeholder TTS so Vonage doesn't time out.
 *   - Asynchronously calls the AI -> logs -> updates the call with a new NCCO.
 **********************************************************************/
export const handleProcessingWebhook = async (req, res) => {
  try {
    console.log('[INFO] handleProcessingWebhook triggered');
    console.log('[DEBUG] Request body:', req.body);

    const { businessId, conversationId } = req.query;
    const userText = req.body?.payload?.userText || 'No input';

    // 1) Immediately send a minimal response to Vonage
    // so it doesn't retry or time out
    res.status(200).json([
      {
        action: 'talk',
        text: 'Processing your request. Please wait.',
        language: 'en-US',
        style: 14,
      },
    ]);

    // 2) Asynchronously process AI
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });

    const ttsMessage = assistantResponse.message || 'How else can I help you?';
    console.log(`[INFO] AI Response: ${ttsMessage}`);

    // 3) Log AI response
    await logConversation({
      businessId,
      senderPhone: 'AI',
      receiverPhone: 'Customer',
      message: ttsMessage,
      messageType: 'text',
      role: 'business',
      conversationId,
    });

    // 4) Build the new NCCO with talk + input for the next turn
    const nextEventUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const aiResponseNcco = [
      {
        action: 'talk',
        text: ttsMessage,
        language: 'en-US',
        style: 14,
        bargeIn: true, // Let user interrupt
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [nextEventUrl],
        speech: {
          endOnSilence: 0.2,
          language: 'en-US',
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    // 5) Transfer the live call to the new NCCO
    // conversationId = call's conversation_uuid from Vonage (must match)
    // If it doesn't match exactly, consider storing the real call UUID
    // or using the 'uuid' property from the inbound request to update the call.
    try {
      await vonage.voice.updateCall(conversationId, {
        action: 'transfer',
        destination: { type: 'ncco', ncco: aiResponseNcco },
      });
      console.log('[INFO] Successfully updated call with new NCCO');
    } catch (updateErr) {
      console.error('[ERROR] Failed to update call with new NCCO:', updateErr.message);
    }
  } catch (err) {
    console.error('[ERROR] handleProcessingWebhook:', err.message);
  }
};

/**********************************************************************
 * 4) Call Event - handleCallEvent
 *   - Logs call life-cycle events (answered, completed, etc.).
 **********************************************************************/
export const handleCallEvent = async (req, res) => {
  try {
    const { status, to, from } = req.query;
    console.log(`[INFO] Call event: ${status}, To: ${to}, From: ${from}`);

    await supabase.from('call_events').insert([
      { status, to, from, event_time: new Date() },
    ]);
    res.status(200).send('Event received');
  } catch (error) {
    console.error('[ERROR] handleCallEvent:', error.message);
    res.status(500).send('Failed to handle call event');
  }
};

/**********************************************************************
 * 5) Fallback - handleFallback
 *   - Called if Answer URL times out or fails. Simple TTS error.
 **********************************************************************/
export const handleFallback = async (req, res) => {
  try {
    console.error('[ERROR] Fallback triggered:', req.query || req.body);
    return res.json([
      {
        action: 'talk',
        text: 'We are unable to process your call at the moment. Please try again later.',
      },
    ]);
  } catch (error) {
    console.error('[ERROR] handleFallback:', error.message);
    return res.status(500).send('Failed to handle fallback');
  }
};

/**********************************************************************
 * 6) Inbound Message - handleInboundMessage
 *   - For inbound SMS or messages. Just pass to assistantHandler.
 **********************************************************************/
export const handleInboundMessage = async (req, res) => {
  try {
    const { text, msisdn } = req.body || req.query;
    console.log(`[INFO] Inbound message from ${msisdn}: ${text}`);

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

/**********************************************************************
 * 7) Call Status - handleCallStatus
 *   - Additional call progress or final statuses are posted here.
 **********************************************************************/
export const handleCallStatus = async (req, res) => {
  try {
    const { status, conversation_uuid } = req.body || req.query;
    console.log(`[INFO] Call status update: ${status}, Conversation UUID: ${conversation_uuid}`);

    await supabase.from('call_status_updates').insert([
      {
        status,
        conversation_uuid,
        status_time: new Date(),
      },
    ]);

    res.status(200).send('Status received');
  } catch (error) {
    console.error('[ERROR] handleCallStatus:', error.message);
    res.status(500).send('Failed to handle call status');
  }
};
