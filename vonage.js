/*****************************************************/
/** vonage.js -- TALK + INPUT WITH BUSINESS ID       **/
/** (No Omissions)                                   **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';
import { logConversation } from './logConversation.js';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs


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
 * 1) Answer URL - handleInboundCall
 *
 *   - Greet the caller with the business name.
 *   - Assign a consistent "conversation_id" for the call.
 *   - Include "businessId" in the eventUrl for tracking.
 **********************************************************************/

export const handleInboundCall = async (req, res) => {
  try {
    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;
    console.log('[DEBUG] InboundCall Body:', req.body);
    console.log('[DEBUG] InboundCall Query:', req.query);
    console.log(`[INFO] Inbound call from ${from} to ${to}`);

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

    // 1a) Lookup the business associated with this Vonage number
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
    console.log(`[INFO] Found businessId: ${businessId}`);

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

    const businessName = businessInfo.name;
    console.log(`[INFO] Business name: ${businessName}`);

    // 1c) Generate a unique "conversation_id" for this call
    const conversationId = uuidv4();

    // 1d) Log the start of the conversation in the database
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

    console.log(`[INFO] Logged new conversation: ${conversationId}`);

    // 1e) Construct the NCCO with "talk" and "input" actions
    const eventUrlWithParams = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;

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
          endOnSilence: 0.5, // seconds of silence to consider speech ended
          language: 'en-US',
          noiseCancellation: true, // Enable noise suppression (if supported by Vonage STT)
          vad: { enable: true }, // Enable Voice Activity Detection (if supported)
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
 *   - After the user speaks or presses digits, Vonage sends us a POST
 *     with the "businessId" param in req.query (thanks to the eventUrl above).
 *   - We detect Spanish vs. English from the recognized text and pass
 *     it to our AI assistant. Then we respond with talk + input again.
 **********************************************************************/
export const handleInputWebhook = async (req, res) => {
  try {
    console.time('Vonage InputWebhook Total Time');
    console.log('[DEBUG] InputWebhook Body:', req.body);

    const { businessId } = req.query;
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

    let userText = '';
    if (req.body.speech?.results?.length > 0 && req.body.speech.results[0]?.text) {
      userText = req.body.speech.results[0].text.toLowerCase();
    } else if (req.body.dtmf?.digits) {
      userText = `DTMF digit: ${req.body.dtmf.digits}`;
    } else {
      console.warn('[WARN] No valid speech or DTMF input found');
      userText = '';
    }

    console.log(`[INFO] User input: ${userText}`);

    // Log the conversation into the `inbound_calls` table
    await logConversation({
      businessId,
      senderPhone: req.body.from,
      receiverPhone: req.body.to,
      message: userText,
      messageType: req.body.speech ? 'speech' : req.body.dtmf ? 'dtmf' : 'other',
      role: 'customer',
    });

    // **First NCCO: Typing sound**
    const typingSoundUrl = 'https://drive.google.com/file/d/1V9sB8azco1aPqdah8S6JVN1YwEXufmOW/view?usp=sharing'; // Replace with your sound file URL
    const processingWebhookUrl = `https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/processing-webhook?businessId=${businessId}`;

    const typingNcco = [
      {
        action: 'stream',
        streamUrl: [typingSoundUrl],
        loop: 0, // Loops until the next NCCO is triggered
      },
      {
        action: 'notify',
        payload: { userText }, // Pass userText to the next webhook
        eventUrl: [processingWebhookUrl],
      },
    ];

    console.time('AssistantHandler Processing Time');
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });
    console.timeEnd('AssistantHandler Processing Time');

    const ttsMessage = assistantResponse.message || 'How else can I help you?';

    // **Log AI Response**
    await logConversation({
      businessId,
      senderPhone: req.body.to, // AI (business number)
      receiverPhone: req.body.from, // Customer number
      message: ttsMessage,
      messageType: 'text',
      role: 'business',
    });

    // **Second NCCO: AI Response**
    const aiResponseNcco = [
      {
        action: 'talk',
        text: ttsMessage,
        language: 'en-US',
        style: 14,
        bargeIn: true, // Allow interruption
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [`https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook?businessId=${businessId}`],
        speech: {
          endOnSilence: 0.5,
          language: 'en-US',
          noiseCancellation: true,
          vad: { enable: true },
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

    // Return typing sound first
    res.json(typingNcco);

    // Delayed execution of AI response
    setTimeout(() => {
      fetch(`https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/next-ncco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiResponseNcco, from: req.body.to, to: req.body.from }),
      });
    }, 3000); // Adjust delay time as needed
  } catch (err) {
    console.error('[ERROR] handleInputWebhook:', err.message);
    res.json([
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
 * 3) Call Event - handleCallEvent
 **********************************************************************/
export const handleCallEvent = async (req, res) => {
  try {
    const { status, to, from } = req.query;
    console.log(`[INFO] Call event: ${status}, To: ${to}, From: ${from}`);
    await supabase.from('call_events').insert([{ status, to, from, event_time: new Date() }]);
    return res.status(200).send('Event received');
  } catch (error) {
    console.error('[ERROR] handleCallEvent:', error.message);
    return res.status(500).send('Failed to handle call event');
  }
};

/**********************************************************************
 * 4) Fallback - handleFallback
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
 * 5) Inbound SMS - handleInboundMessage
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
    console.error('[ERROR] handleInboundMessage:', error.message);
    return res.status(500).send('Failed to handle inbound message');
  }
};

/**********************************************************************
 * 6) Call Status - handleCallStatus
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
