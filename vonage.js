/*****************************************************/
/** vonage.js -- TALK + INPUT WITH BUSINESS ID       **/
/** (Complete, No Omissions, with Perf Tweaks)      **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';
import { logConversation } from './logConversation.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Initialize Vonage SDK.
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
 * 1) handleInboundCall (Answer URL)
 *
 *   - Greets the caller with the business name.
 *   - Creates a unique conversation_id for multi-turn tracking.
 *   - Logs the start in the 'inbound_calls' table.
 *   - Returns an NCCO (talk + input) with businessId & conversationId in query.
 **********************************************************************/
export const handleInboundCall = async (req, res) => {
  console.time('[PERF] handleInboundCall total');
  try {
    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;

    if (!to || !from) {
      console.error('[ERROR] Missing "to" or "from" in inbound call');
      console.timeEnd('[PERF] handleInboundCall total');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, we cannot process this call due to missing information.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    // 1a) Lookup businessId by Vonage number
    console.time('[PERF] DB: Lookup businessId in vonage_numbers');
    const { data: businessData, error: businessError } = await supabase
      .from('vonage_numbers')
      .select('business_id')
      .eq('vonage_number', to)
      .single();
    console.timeEnd('[PERF] DB: Lookup businessId in vonage_numbers');

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found for number:', to);
      console.timeEnd('[PERF] handleInboundCall total');
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

    // 1b) Fetch the business name for a personalized greeting
    console.time('[PERF] DB: Fetch business name');
    const { data: businessInfo, error: businessInfoError } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();
    console.timeEnd('[PERF] DB: Fetch business name');

    if (businessInfoError || !businessInfo) {
      console.error('[ERROR] Failed to fetch business name:', businessInfoError?.message || 'No data');
      console.timeEnd('[PERF] handleInboundCall total');
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, we cannot process your call at this time.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }
    const businessName = businessInfo.name;

    // 1c) Generate conversationId & log conversation start
    const conversationId = uuidv4();
    console.time('[PERF] DB: Insert conversation start');
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
    console.timeEnd('[PERF] DB: Insert conversation start');

    // 1d) Construct NCCO: talk + input
    const eventUrlWithParams =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const ncco = [
      {
        action: 'talk',
        text: `Hello, this is Mila from ${businessName}. How can I assist you today?`,
        language: 'en-US',
        style: 14,
        bargeIn: false, // The user can't interrupt the greeting
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [eventUrlWithParams],
        speech: {
          endOnSilence: 0.5, // Short silence threshold for faster calls
          language: 'en-US',
          // noiseCancellation & vad can be toggled for STT improvements if supported:
          // noiseCancellation: true,
          // vad: { enable: true },
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    console.timeEnd('[PERF] handleInboundCall total');
    return res.json(ncco);
  } catch (err) {
    console.error('[ERROR] handleInboundCall:', err.message);
    console.timeEnd('[PERF] handleInboundCall total');
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
 *   - The user has spoken or pressed digits, so we:
 *     1) Log their input,
 *     2) Return an NCCO that streams "typing" + notifies handleProcessingWebhook
 *        so the user hears typing while the AI processes the input.
 **********************************************************************/
export const handleInputWebhook = async (req, res) => {
  console.time('[PERF] handleInputWebhook total');
  try {
    const { businessId, conversationId } = req.query;
    if (!businessId) {
      console.error('[ERROR] Missing "businessId" in Input Webhook');
      console.timeEnd('[PERF] handleInputWebhook total');
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
    const userSpeech = req.body.speech?.results?.[0]?.text || '';
    const userDtmf = req.body.dtmf?.digits || '';
    const userText = userSpeech
      ? userSpeech.toLowerCase()
      : userDtmf
      ? `DTMF digit: ${userDtmf}`
      : '';

    console.log('[DEBUG] InputWebhook Body:', JSON.stringify(req.body, null, 2));
    console.log(`[INFO] handleInputWebhook userText="${userText}"`);

    // 2a) Log user input if it's not empty
    if (userText.trim()) {
      console.time('[PERF] DB: Log user speech/dtmf');
      await logConversation({
        businessId,
        senderPhone: from,
        receiverPhone: to,
        message: userText,
        messageType: userSpeech ? 'speech' : userDtmf ? 'dtmf' : 'other',
        role: 'customer',
        conversationId,
      });
      console.timeEnd('[PERF] DB: Log user speech/dtmf');
    }

    // 2b) Return an NCCO that streams a typing sound & calls handleProcessingWebhook
    const typingSoundUrl = 'https://f004.backblazeb2.com/file/typewriter-typing/typewriter.mp3';
    const processingWebhookUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/processing-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const ncco = [
      {
        action: 'stream',
        streamUrl: [typingSoundUrl],
        loop: 0, // Loop indefinitely until next action triggers
      },
      {
        action: 'notify',
        payload: { userText },
        eventUrl: [processingWebhookUrl],
      },
    ];

    console.timeEnd('[PERF] handleInputWebhook total');
    return res.json(ncco);
  } catch (err) {
    console.error('[ERROR] handleInputWebhook:', err.message);
    console.timeEnd('[PERF] handleInputWebhook total');
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
 *   - Called via the "notify" action while the typing sound is playing.
 *   - We run the AI logic in assistantHandler to get a response.
 *   - Then we return talk + input for multi-turn conversation.
 **********************************************************************/
export const handleProcessingWebhook = async (req, res) => {
  console.time('[PERF] handleProcessingWebhook total');
  try {
    const { businessId, conversationId } = req.query;
    const userText = req.body?.payload?.userText || 'No input';

    console.log(`[INFO] handleProcessingWebhook -> userText="${userText}" businessId=${businessId}`);

    // 3a) Call the AI assistant
    console.time('[PERF] AI assistantHandler');
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });
    console.timeEnd('[PERF] AI assistantHandler');

    const ttsMessage = assistantResponse.message || 'How else can I help you?';

    // 3b) Log the AI response
    console.time('[PERF] DB: Log AI response');
    await logConversation({
      businessId,
      senderPhone: 'AI',
      receiverPhone: 'Customer',
      message: ttsMessage,
      messageType: 'text',
      role: 'business',
      conversationId,
    });
    console.timeEnd('[PERF] DB: Log AI response');

    // 3c) Return talk + input again to allow the user to continue
    const nextEventUrl =
      `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook` +
      `?businessId=${businessId}&conversationId=${conversationId}`;

    const aiResponseNcco = [
      {
        action: 'talk',
        text: ttsMessage,
        language: 'en-US',
        style: 14,
        bargeIn: true, // Let user interrupt if they speak mid-response
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [nextEventUrl],
        speech: {
          endOnSilence: 0.5,
          language: 'en-US',
          // noiseCancellation: true,
          // vad: { enable: true },
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    console.timeEnd('[PERF] handleProcessingWebhook total');
    return res.json(aiResponseNcco);
  } catch (err) {
    console.error('[ERROR] handleProcessingWebhook:', err.message);
    console.timeEnd('[PERF] handleProcessingWebhook total');
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
 * 4) handleCallEvent (Event URL)
 *   - Vonage calls this for call events like "answered", "completed", etc.
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
 *   - Called if the Answer URL fails or is unreachable.
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
 *   - For inbound SMS or messages. We'll call assistantHandler directly.
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
