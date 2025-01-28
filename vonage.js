/*****************************************************/
/** vonage.js -- TALK + INPUT WITH BUSINESS ID       **/
/** (Complete, No Omissions)                        **/
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

    // Lookup the business associated with this Vonage number
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

    // Fetch the business name
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

    // Generate a unique "conversation_id" for this call
    const conversationId = uuidv4();

    // Log the start of the conversation in the database
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

    // Construct the NCCO with "talk" and "input" actions
    const eventUrlWithParams = `https://your-server-url/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;

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
 * 2) Input Webhook - handleInputWebhook
 *
 *   - Handle input from speech or DTMF.
 *   - Play a typing sound during AI processing.
 *   - Respond with AI-generated output.
 **********************************************************************/
export const handleInputWebhook = async (req, res) => {
  try {
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

    const userText = req.body.speech?.results?.[0]?.text.toLowerCase() || req.body.dtmf?.digits || '';

    // Log the user input
    await logConversation({
      businessId,
      senderPhone: req.body.from,
      receiverPhone: req.body.to,
      message: userText,
      messageType: req.body.speech ? 'speech' : 'dtmf',
      role: 'customer',
    });

    // Typing sound NCCO
    const typingSoundUrl = 'https://f004.backblazeb2.com/file/typewriter-typing/typewriter-typing-68696.mp3';
    const processingWebhookUrl = `https://your-server-url/vonage/processing-webhook?businessId=${businessId}`;

    const typingNcco = [
      {
        action: 'stream',
        streamUrl: [typingSoundUrl],
        loop: 0,
      },
      {
        action: 'notify',
        payload: { userText },
        eventUrl: [processingWebhookUrl],
      },
    ];

    res.json(typingNcco);
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
 * 3) Processing Webhook - handleProcessingWebhook
 *
 *   - Process AI response and send back the next NCCO.
 **********************************************************************/
export const handleProcessingWebhook = async (req, res) => {
  try {
    const { businessId } = req.query;
    const userText = req.body?.payload?.userText || 'No input';

    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });

    const ttsMessage = assistantResponse.message || 'How else can I help you?';

    // Log AI response
    await logConversation({
      businessId,
      senderPhone: 'AI',
      receiverPhone: 'Customer',
      message: ttsMessage,
      messageType: 'text',
      role: 'business',
    });

    const nextEventUrl = `https://your-server-url/vonage/input-webhook?businessId=${businessId}`;

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

    res.json(aiResponseNcco);
  } catch (err) {
    console.error('[ERROR] handleProcessingWebhook:', err.message);
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
 * 4) Call Event - handleCallEvent
 **********************************************************************/
export const handleCallEvent = async (req, res) => {
  try {
    const { status, to, from } = req.query;

    await supabase.from('call_events').insert([{ status, to, from, event_time: new Date() }]);
    return res.status(200).send('Event received');
  } catch (error) {
    console.error('[ERROR] handleCallEvent:', error.message);
    return res.status(500).send('Failed to handle call event');
  }
};

/**********************************************************************
 * 5) Fallback - handleFallback
 **********************************************************************/
export const handleFallback = async (req, res) => {
  console.error('[ERROR] Fallback triggered:', req.query || req.body);
  res.json([
    {
      action: 'talk',
      text: 'We are unable to process your call at the moment. Please try again later.',
    },
  ]);
};

/**********************************************************************
 * 6) Call Status - handleCallStatus
 **********************************************************************/
export const handleCallStatus = async (req, res) => {
  try {
    const { status, conversation_uuid } = req.body || req.query;

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
