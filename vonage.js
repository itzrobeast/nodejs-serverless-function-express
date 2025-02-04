/*******************************************************
 * vonage.js
 * 
 * This file contains all functions to handle Vonage telephony 
 * events, including inbound calls, input webhooks, call events,
 * fallback responses, inbound messages, and call status updates.
 * 
 * responses. Ensure that your environment variables for Vonage 
 * (VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_APPLICATION_ID, 
 * VONAGE_PRIVATE_KEY) are correctly set.
 *******************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';
import { logConversation } from './logConversation.js';

// Initialize Vonage SDK
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: process.env.VONAGE_PRIVATE_KEY,
});

/**
 * Utility: Extract the conversation ID from the request
 */
function getConversationId(req) {
  const conversationId =
    req.body?.conversation_uuid ||
    req.query?.conversation_uuid ||
    req.body?.uuid ||
    req.query?.uuid ||
    null;

  if (!conversationId) {
    console.error('[ERROR] Missing conversationId from Vonage');
  }
  return conversationId;
}

/**
 * 1) handleInboundCall (Answer URL)
 *
 * - Logs "Conversation started"
 * - Looks up business details
 * - Returns a talk + connect (WebSocket) NCCO
 */
export const handleInboundCall = async (req, res) => {
  try {
    console.log('[DEBUG] handleInboundCall Payload:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] handleInboundCall Query:', JSON.stringify(req.query, null, 2));

    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;
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

    // Fetch business name for the greeting
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

    // Log "Conversation started"
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

    // Define the input webhook URL for further interaction
    const inputWebhook = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;

    // Build the NCCO response with talk and connect (WebSocket) actions
const ncco = [
  {
    action: "talk",
    // Keep the message simple while troubleshooting
    text: `Hello from ${businessName}`
  },
  {
    action: "connect",
    endpoint: [
      {
        type: "websocket",
        uri: `wss://milaverse-websocket.onrender.com?business_id=${businessId}&conversation_id=${conversationId}`,
        "content-type": "audio/l16;rate=16000"
      }
    ]
  }
];



    
    console.log("[INFO] handleInboundCall -> Returning WebSocket NCCO");
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

/**
 * 2) handleInputWebhook (Input URL)
 *
 * - Logs user input (speech/DTMF)
 * - Filters out filler words/noise
 * - Generates an AI response via the assistant handler
 * - Logs the conversation and returns a new NCCO
 */
export const handleInputWebhook = async (req, res) => {
  try {
    console.log('[DEBUG] InputWebhook Body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] InputWebhook Query:', JSON.stringify(req.query, null, 2));

    const { businessId, conversationId } = req.query;
    const from = req.body?.from || 'Unknown';
    const to = req.body?.to || 'Unknown';

    if (!businessId || !conversationId) {
      console.error(`[ERROR] Missing businessId or conversationId in Input Webhook. From: ${from}, To: ${to}`);
      return res.json([
        {
          action: 'talk',
          text: 'Sorry, something went wrong. Goodbye.',
          language: 'en-US',
          style: 14,
        },
      ]);
    }

    const userText = req.body?.speech?.results?.[0]?.text || '';
    const dtmfDigits = req.body?.dtmf?.digits || '';
    let inputText = userText
      ? userText.trim().toLowerCase()
      : (dtmfDigits ? `dtmf digit: ${dtmfDigits}` : 'No input');
    console.log(`[DEBUG] Input from: ${from} -> ${to}, User Text: "${inputText}"`);

    // Filter out background noise or filler words
    const fillerRegex = /^(uh|um|ah|hm|hmm|noise|silent|background|end_on_silence)$/i;
    if (fillerRegex.test(inputText) || inputText.length < 3) {
      console.log('[INFO] Detected noise/filler input. Ignoring...');
      return res.json([
        {
          action: 'talk',
          text: 'I didn’t catch that. Could you repeat that, please?',
          language: 'en-US',
          style: 14,
        },
        {
          action: 'input',
          type: ['speech', 'dtmf'],
          eventUrl: [
            `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`,
          ],
          speech: {
            endOnSilence: 0.3,
            language: 'en-US',
          },
          dtmf: {
            maxDigits: 1,
            submitOnHash: false,
          },
        },
      ]);
    }

    // Generate AI response via the assistant handler
    const assistantResponse = await assistantHandler({
      userMessage: inputText,
      businessId,
      platform: 'phone',
    });

    const ttsMessage = assistantResponse.message || 'How else can I help you?';
    console.log(`[INFO] AI Response to ${from}: ${ttsMessage}`);

    // Log conversation: Customer input
    await logConversation({
      businessId,
      senderPhone: from,
      receiverPhone: to,
      message: inputText,
      messageType: 'speech',
      role: 'customer',
      conversationId,
    }).catch((err) => {
      console.error('[ERROR] Failed to log customer input:', err);
    });

    // Log conversation: AI response
    await logConversation({
      businessId,
      senderPhone: 'AI',
      receiverPhone: from,
      message: ttsMessage,
      messageType: 'text',
      role: 'business',
      conversationId,
    }).catch((err) => {
      console.error('[ERROR] Failed to log AI response:', err);
    });

    // Build the NCCO for AI response and new user input
    const nextUrl = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;
    const ncco = [
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
          endOnSilence: 0.3,
          language: 'en-US',
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    console.log('[INFO] Returning AI response NCCO');
    return res.json(ncco);
  } catch (err) {
    console.error(
      `[ERROR] handleInputWebhook for call from ${req.body?.from || 'Unknown'} to ${req.body?.to || 'Unknown'}: ${err.message}`
    );
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

/**
 * 3) handleCallEvent (Event URL)
 *
 * - Logs call lifecycle events (answered, completed, etc.)
 */
export const handleCallEvent = async (req, res) => {
  try {
    console.log('[DEBUG] handleCallEvent Query:', JSON.stringify(req.query, null, 2));

    const { status, conversation_uuid, to, from } = req.query;
    console.log(`[INFO] Call event: status=${status}, conversation_uuid=${conversation_uuid}, to=${to}, from=${from}`);

    await supabase.from('call_events').insert([
      { status, conversation_uuid, to, from, event_time: new Date().toISOString() },
    ]);

    res.status(200).send('Event received');
  } catch (err) {
    console.error('[ERROR] handleCallEvent:', err.message);
    res.status(500).send('Failed to handle call event');
  }
};

/**
 * 4) handleFallback (Fallback URL)
 *
 * - Called if the Answer URL fails or times out.
 */
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

/**
 * 5) handleInboundMessage (Inbound SMS/Message)
 *
 * - Processes inbound SMS or messages and responds via the AI.
 */
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

/**
 * 6) handleCallStatus (Status URL)
 *
 * - Logs additional call progress or final statuses.
 */
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
        status_time: new Date().toISOString(),
      },
    ]);

    res.status(200).send('Status received');
  } catch (err) {
    console.error('[ERROR] handleCallStatus:', err.message);
    res.status(500).send('Failed to handle call status');
  }
};
