/*****************************************************/
/** vonage.js -- TALK + INPUT WITH BILINGUAL SUPPORT **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';

/**
 * Initialize Vonage SDK.
 * Ensure these env variables:
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
 *  - We greet the caller based on any immediate Spanish detection
 *    (optional—often you greet in English by default).
 *  - Then we do "input" so the user can speak or DTMF.
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
    console.log(`[INFO] Found businessId: ${businessId}`);

    // For the initial greeting, we might default to English
    // If you want immediate language detection from some param, you'd do that here
    let initialLanguage = 'en-US';
    let initialStyle = 14;

    // Construct an NCCO with talk + input
    const ncco = [
      {
        action: 'talk',
        text: 'Hello, this is Mila, your virtual assistant. Please say something or press a key.',
        language: initialLanguage,
        style: initialStyle,
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        // The separate input webhook where subsequent user input is posted:
        eventUrl: [
          'https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook'
        ],
        speech: {
          endOnSilence: 1, // seconds
          language: initialLanguage,
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
 *  - After user speaks or presses digits, Vonage posts here.
 *  - We detect Spanish or English from user input, pass text to the AI,
 *    then respond with talk + input for a multi-turn conversation.
 **********************************************************************/
export const handleInputWebhook = async (req, res) => {
  try {
    console.log('[DEBUG] InputWebhook Body:', req.body);

    // 2a) Check speech or DTMF
    let userText = '';
    if (req.body.speech && req.body.speech.results && req.body.speech.results.length > 0) {
      // Speech
      userText = req.body.speech.results[0].text;
    } else if (req.body.dtmf && req.body.dtmf.digits) {
      // DTMF
      userText = `DTMF digit: ${req.body.dtmf.digits}`;
    } else {
      console.warn('[WARN] No speech or dtmf input found');
    }
    console.log(`[INFO] User input: ${userText}`);

    // 2b) Basic Spanish detection: if user text has accented chars
    let detectedLanguage = 'en-US';
    let detectedStyle = 14;
    if (userText && /[áéíóúñ]/i.test(userText)) {
      detectedLanguage = 'es-US';
      detectedStyle = 3;
    }

    // 2c) For multi-tenancy, you'd want to know which businessId. 
    // For now, we just hardcode or store in a session.
    const businessId = 1; // or retrieve from query or session

    // 2d) Send user text to the AI
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });
    console.log('[DEBUG] Assistant says:', assistantResponse.message);

    // 2e) If user wants to "book appointment," handle that logic here if integrated
    // For demonstration, we just repeat AI's response in TTS
    const ttsMessage = assistantResponse.message || 'How else can I help you?';

    // 2f) Return new NCCO: talk + input again, using the detected language
    const ncco = [
      {
        action: 'talk',
        text: ttsMessage,
        language: detectedLanguage,
        style: detectedStyle,
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [
          'https://nodejs-serverless-function-express-two-wine.vercel.app/vonage/input-webhook'
        ],
        speech: {
          endOnSilence: 1,
          language: detectedLanguage,
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
      },
    ];

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
 * 3) Call Event
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
 * 4) Fallback
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
 * 5) Inbound SMS
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
 * 6) Call Status
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
