/*****************************************************/
/** vonage.js -- COMPLETE MASTER CODE (No Omissions) **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';
import { logConversation } from './logConversation.js'; // Your custom DB logging
// import { v4 as uuidv4 } from 'uuid'; // No longer needed for conversation_id

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
 *   - Uses the REAL Vonage conversation_uuid from req.body.conversation_uuid
 *   - Logs the conversation start in inbound_calls with that ID.
 *   - Returns talk + input with business info.
 **********************************************************************/
export const handleInboundCall = async (req, res) => {
  try {
    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;

    // The real conversation UUID from Vonage
    const conversationId = req.body.conversation_uuid; 
    // If it's not present, fallback or handle error
    if (!conversationId) {
      console.error('[ERROR] Missing conversation_uuid from Vonage');
    }

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

    // 1a) Find the business for the called Vonage number
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

    // 1b) Fetch the business name for greeting
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

    // 1c) Log "conversation started" in inbound_calls
    await supabase.from('inbound_calls').insert([
      {
        conversation_id: conversationId,   // Use REAL conversation_uuid
        sender_phone: from,
        receiver_phone: to,
        business_id: businessId,
        message: 'Conversation started',
        message_type: 'system',
        role: 'system',
        timestamp: new Date().toISOString(),
      },
    ]);

    // 1d) Build talk + input
    // Pass the REAL conversationId in the eventUrl
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
          endOnSilence: 0.5,
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
 * 2) handleInputWebhook
 *
 *   - Called after user speaks or presses digits.
 *   - We filter out short/irrelevant noise or filler words (like "um", "uh").
 *   - If valid input, we play a typing sound + notify the processing webhook.
 *   - If invalid, we prompt user to repeat, up to max retries.
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

    const from = req.body.from;
    const to = req.body.to;

    // Vonage speech + dtmf
    const userSpeech = req.body.speech?.results?.[0]?.text || '';
    const userDtmf = req.body.dtmf?.digits || '';
    let userText = userSpeech
      ? userSpeech.toLowerCase().trim()
      : userDtmf
      ? `dtmf digit: ${userDtmf}`
      : '';

    console.log('[DEBUG] InputWebhook body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] userText before filter:', userText);

    // 2a) Filter out short or filler words
    // e.g. if userText < 3 chars or matches "um", "uh", "hmm" etc.
    const fillerRegex = /^[uhm]+$/i;
    const minLength = 3;

    let retryCount = parseInt(req.query.retryCount || '0', 10);

    if (
      userText.length < minLength ||
      fillerRegex.test(userText)
    ) {
      // we handle "invalid / noise"
      if (retryCount < 3) {
        // Prompt user again
        retryCount += 1;
        const nextEventUrl =
          `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook` +
          `?businessId=${businessId}&conversationId=${conversationId}&retryCount=${retryCount}`;

        console.log(`[DEBUG] Noise or short input detected. Retry #${retryCount}`);

        return res.json([
          {
            action: 'talk',
            text: 'I didn’t catch that. Please say your request clearly.',
            language: 'en-US',
            style: 14,
          },
          {
            action: 'input',
            type: ['speech', 'dtmf'],
            eventUrl: [nextEventUrl],
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
        // Exceeded max retries
        console.log('[INFO] Exceeded max noise retries, ending call.');
        return res.json([
          {
            action: 'talk',
            text: 'Sorry, I’m still not able to understand. Please call back later.',
            language: 'en-US',
            style: 14,
          },
        ]);
      }
    }

    // 2b) Log user input since it's valid
    if (userText) {
      await logConversation({
        businessId,
        senderPhone: from,
        receiverPhone: to,
        message: userText,
        messageType: userSpeech ? 'speech' : 'dtmf',
        role: 'customer',
        conversationId,
      });
    }

    // 2c) Return an NCCO: Stream typing + notify to processing-webhook
    const typingSoundUrl = 'https://f004.backblazeb2.com/file/typewriter-typing/typewriter.mp3';
    const processingWebhookUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/processing-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const typingNcco = [
      {
        action: 'stream',
        streamUrl: [typingSoundUrl],
        loop: 0, // indefinite
      },
      {
        action: 'notify',
        payload: { userText },
        eventUrl: [processingWebhookUrl],
      },
    ];

    return res.json(typingNcco);
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
 * 3) handleProcessingWebhook
 *
 *   - Immediately responds with a placeholder so Vonage doesn't retry.
 *   - Asynchronously calls AI -> logs -> uses real conversationId
 *     with vonage.voice.updateCall(...) to switch the call to the new NCCO.
 **********************************************************************/
export const handleProcessingWebhook = async (req, res) => {
  try {
    const { businessId, conversationId } = req.query;
    const userText = req.body?.payload?.userText || 'No input';

    console.log(`[INFO] handleProcessingWebhook triggered for conversationId=${conversationId}`);
    console.log(`[DEBUG] userText="${userText}"`);

    // Acknowledge immediately
    // This frees Vonage from waiting for a final NCCO here
    res.status(200).json([
      {
        action: 'talk',
        text: 'Processing your request. Please wait.',
        language: 'en-US',
        style: 14,
      },
    ]);

    // Now do AI logic asynchronously
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });

    const ttsMessage = assistantResponse.message || 'How else can I help you?';
    console.log(`[INFO] AI says: ${ttsMessage}`);

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

    // Build new NCCO
    const nextEventUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

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
        eventUrl: [nextEventUrl],
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

    // Transfer the call to the new NCCO using the REAL conversationId from Vonage
    await vonage.voice.updateCall(conversationId, {
      action: 'transfer',
      destination: { type: 'ncco', ncco: aiResponseNcco },
    });
    console.log('[INFO] Successfully updated call with new NCCO');
  } catch (err) {
    console.error('[ERROR] handleProcessingWebhook:', err.message);
  }
};

/**********************************************************************
 * 4) handleCallEvent (Event URL)
 *   - Logs events like answered, completed, etc.
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
 * 5) handleFallback (Fallback URL)
 *   - Called if Answer URL fails or times out.
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
 * 6) handleInboundMessage (Inbound URL)
 *   - For inbound SMS or messages. We pass it to the AI and respond.
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
 * 7) handleCallStatus (Status URL)
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
