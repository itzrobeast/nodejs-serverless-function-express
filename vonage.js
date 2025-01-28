/*****************************************************/
/** vonage.js -- COMPLETE MASTER CODE (No Omissions) **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';
import { logConversation } from './logConversation.js';

/**
 * Initialize Vonage SDK
 * Ensure these environment variables:
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
 * Utility: Extract real conversationId from body or query
 * Some Vonage setups might send 'uuid' instead of 'conversation_uuid'.
 * We handle both, plus check GET or POST.
 **********************************************************************/
function getConversationId(req) {
  // Typically 'conversation_uuid' is correct, but let's fallback to 'uuid'
  return (
    req.body.conversation_uuid ||
    req.query.conversation_uuid ||
    req.body.uuid ||
    req.query.uuid ||
    null
  );
}

/**********************************************************************
 * 1) handleInboundCall (Answer URL)
 *
 *   - We fetch the real conversationId via getConversationId().
 *   - We log "Conversation started" in 'inbound_calls'.
 *   - We respond with talk+input NCCO for the initial greeting.
 **********************************************************************/
export const handleInboundCall = async (req, res) => {
  try {
    console.log('[DEBUG] handleInboundCall Payload:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] handleInboundCall Query:', JSON.stringify(req.query, null, 2));

    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;

    // Check both body + query for conversation_uuid or fallback to 'uuid'
    const conversationId = getConversationId(req);

    if (!conversationId) {
      console.error('[ERROR] Missing conversation_uuid (or uuid) from Vonage');
      return res.json([
        {
          action: 'talk',
          text: 'We cannot process your call at this time. Missing conversation details.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    if (!to || !from) {
      console.error('[ERROR] Missing "to" or "from" in inbound call');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, we cannot process your call due to missing information.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    // Lookup the business by the Vonage "to" number
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

    // Fetch business name for greeting
    const { data: bizInfo, error: bizError } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    if (bizError || !bizInfo) {
      console.error('[ERROR] Failed to fetch business name:', bizError?.message || 'No data');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, we cannot process your call at this time.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }
    const businessName = bizInfo.name || 'our business';

    // Log "conversation started"
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

    // Return talk+input
    const inputWebhook = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;

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
        eventUrl: [inputWebhook],
        speech: {
          endOnSilence: 0.5,
          language: 'en-US',
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    console.log('[INFO] handleInboundCall -> Returning talk+input NCCO');
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
 * 2) handleInputWebhook (Input URL)
 *
 *   - Logs user input (speech/DTMF).
 *   - Filters out short/filler words (like "um", "uh").
 *   - If valid, streams typing sound + notify -> processingWebhook.
 **********************************************************************/
export const handleInputWebhook = async (req, res) => {
  try {
    console.log('[DEBUG] InputWebhook Body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] InputWebhook Query:', JSON.stringify(req.query, null, 2));

    const { businessId, conversationId, retryCount = '0' } = req.query;
    if (!businessId || !conversationId) {
      console.error('[ERROR] Missing businessId or conversationId in Input Webhook');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, something went wrong. Goodbye.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    const from = req.body.from || req.query.from;
    const to = req.body.to || req.query.to;
    const speechText = req.body.speech?.results?.[0]?.text || '';
    const dtmfDigits = req.body.dtmf?.digits || '';
    let userText = speechText ? speechText.toLowerCase().trim() : (dtmfDigits ? `dtmf digit: ${dtmfDigits}` : '');

    console.log('[DEBUG] userText (raw):', userText);

    // Filtering short/filler input
    let retries = parseInt(retryCount, 10);
    const fillerRegex = /^[uhm]+$/i;
    const minLength = 3;

    if (!userText || userText.length < minLength || fillerRegex.test(userText)) {
      // If invalid input, prompt user again up to 3 times
      if (retries < 3) {
        retries += 1;
        console.log(`[INFO] Filler/noise. Retrying #${retries}`);
        const nextUrl = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}&retryCount=${retries}`;

        return res.json([
          {
            action: 'talk',
            text: 'I didn’t catch that. Please speak clearly.',
            language: 'en-US',
            style: 14,
          },
          {
            action: 'input',
            type: ['speech', 'dtmf'],
            eventUrl: [nextUrl],
            speech: {
              endOnSilence: 0.5,
              language: 'en-US',
            },
            dtmf: {
              maxDigits: 1,
              submitOnHash: false,
            },
          },
        ]);
      } else {
        console.log('[INFO] Exceeded max retries. Ending call.');
        return res.json([
          {
            action: 'talk',
            text: 'Sorry, I’m still not able to understand you. Please call back later. Goodbye.',
            language: 'en-US',
            style: 14,
          },
        ]);
      }
    }

    // Valid input => log it
    await logConversation({
      businessId,
      senderPhone: from,
      receiverPhone: to,
      message: userText,
      messageType: speechText ? 'speech' : (dtmfDigits ? 'dtmf' : 'other'),
      role: 'customer',
      conversationId,
    });

    // Return typing sound + notify
    const typingSoundUrl = 'https://f004.backblazeb2.com/file/typewriter-typing/typewriter.mp3';
    const processingUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/processing-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const ncco = [
      {
        action: 'stream',
        streamUrl: [typingSoundUrl],
        loop: 1, 
      },
      {
        action: 'notify',
        payload: { userText },
        eventUrl: [processingUrl],
        eventMethod: 'POST'
      },
    ];

    console.log('[INFO] handleInputWebhook -> Returning typing + notify');
    return res.json(ncco);
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
 * 3) handleProcessingWebhook (Processing URL)
 *
 *   - Immediately returns a minimal response so Vonage doesn't retry.
 *   - Asynchronously calls AI -> logs -> updateCall with new NCCO.
 **********************************************************************/
export const handleProcessingWebhook = async (req, res) => {
  try {
    console.log('[DEBUG] handleProcessingWebhook Body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] handleProcessingWebhook Query:', JSON.stringify(req.query, null, 2));

    const { businessId, conversationId } = req.query;
    const userText = req.body?.payload?.userText || 'No input';

    if (!conversationId) {
      console.error('[ERROR] Missing conversationId in ProcessingWebhook');
      return;
    }

    // Respond immediately to avoid Vonage timeout
    res.status(200).json({ status: 'ok' });

    // Asynchronously handle AI response
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });

    const ttsMessage = assistantResponse.message || 'How else can I help you?';
    console.log('[INFO] AI says:', ttsMessage);

    // Log AI response
    await logConversation({
      businessId,
      senderPhone: 'AI',
      receiverPhone: 'Customer',
      message: ttsMessage,
      messageType: 'text',
      role: 'business',
      conversationId,
    });

    // Build the next NCCO
    const nextUrl = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;
    const aiResponseNcco = [
      {
        action: 'talk',
        text: ttsMessage,
        language: 'en-US',
        style: 14,
        bargeIn: true,
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [nextUrl],
        speech: {
          endOnSilence: 0.5,
          language: 'en-US',
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    // Update the call with the new NCCO
    console.log('[DEBUG] Attempting to update call with new NCCO');
    await vonage.voice.updateCall(conversationId, {
      action: 'transfer',
      destination: { type: 'ncco', ncco: aiResponseNcco },
    });
    console.log('[INFO] Call successfully updated.');
  } catch (err) {
    console.error('[ERROR] handleProcessingWebhook:', err.message);
  }
};


/**********************************************************************
 * 4) handleCallEvent (Event URL)
 *   - Logs call lifecycle events (answered, completed, etc.).
 **********************************************************************/
export const handleCallEvent = async (req, res) => {
  try {
    console.log('[DEBUG] handleCallEvent Query:', JSON.stringify(req.query, null, 2));

    const { status, conversation_uuid, to, from } = req.query;

    console.log(`[INFO] Call event: status=${status}, conversation_uuid=${conversation_uuid}, to=${to}, from=${from}`);

    await supabase.from('call_events').insert([
      { status, conversation_uuid, to, from, event_time: new Date() },
    ]);

    res.status(200).send('Event received');
  } catch (err) {
    console.error('[ERROR] handleCallEvent:', err.message);
    res.status(500).send('Failed to handle call event');
  }
};

/**********************************************************************
 * 5) handleFallback (Fallback URL)
 *   - Called if Answer URL fails or times out.
 **********************************************************************/
export const handleFallback = async (req, res) => {
  try {
    console.error('[ERROR] Fallback triggered:', JSON.stringify(req.body || req.query, null, 2));
    return res.json([
      {
        action: 'talk',
        text: 'We are unable to process your call at the moment. Please try again later.',
        language: 'en-US',
      },
    ]);
  } catch (err) {
    console.error('[ERROR] handleFallback:', err.message);
    return res.status(500).send('Failed to handle fallback');
  }
};

/**********************************************************************
 * 6) handleInboundMessage (Inbound URL)
 *   - For inbound SMS or messages. We pass it to the AI and respond.
 **********************************************************************/
export const handleInboundMessage = async (req, res) => {
  try {
    console.log('[DEBUG] handleInboundMessage Body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] handleInboundMessage Query:', JSON.stringify(req.query, null, 2));

    const { text, msisdn } = req.body || req.query;
    console.log(`[INFO] Inbound message from ${msisdn}: "${text}"`);

    const assistantResponse = await assistantHandler({
      userMessage: text,
      platform: 'sms',
    });

    return res.status(200).json({
      message: assistantResponse.message || 'Thank you for your message!',
    });
  } catch (err) {
    console.error('[ERROR] Failed to handle inbound message:', err.message);
    return res.status(500).send('Failed to handle inbound message');
  }
};

/**********************************************************************
 * 7) handleCallStatus (Status URL)
 *   - Additional call progress or final statuses are posted here.
 **********************************************************************/
export const handleCallStatus = async (req, res) => {
  try {
    console.log('[DEBUG] handleCallStatus Body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] handleCallStatus Query:', JSON.stringify(req.query, null, 2));

    const { status, conversation_uuid } = req.body || req.query;
    console.log(`[INFO] Call status update: ${status}, conversation_uuid=${conversation_uuid}`);

    await supabase.from('call_status_updates').insert([
      {
        status,
        conversation_uuid,
        status_time: new Date(),
      },
    ]);

    res.status(200).send('Status received');
  } catch (err) {
    console.error('[ERROR] handleCallStatus:', err.message);
    res.status(500).send('Failed to handle call status');
  }
};
