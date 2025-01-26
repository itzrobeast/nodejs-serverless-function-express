/*****************************************************/
/** vonage.js -- MASTER CODE WITH TALK+INPUT LOGIC   **/
/*****************************************************/
import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';

/**
 * Initialize Vonage SDK.
 * Ensure these environment variables are set:
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

/***********************************************************************
 * 1) Answer URL - Handle Inbound Calls
 * 
 *   - Vonage calls this endpoint when a new call arrives.
 *   - We fetch the "to" and "from" from req.body or req.query.
 *   - We do a DB lookup (vonage_numbers) to find the business.
 *   - We greet the caller with "talk".
 *   - We then add an "input" action so Vonage listens for speech/DTMF.
 *   - Once the user speaks/presses digits, Vonage POSTs to `eventUrl` 
 *     (which we define as /vonage/input-webhook).
 ***********************************************************************/
export const handleInboundCall = async (req, res) => {
  try {
    // 1a) Extract relevant fields
    const to = req.body.to || req.query.to;
    const from = req.body.from || req.query.from;
    console.log('[DEBUG] InboundCall Body:', req.body);
    console.log('[DEBUG] InboundCall Query:', req.query);
    console.log(`[INFO] Inbound call from ${from} to ${to}`);

    // Basic checks
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

    // 1b) Lookup the business associated with this Vonage number
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

    // 1c) Construct an NCCO (array of actions) with talk + input
    // The "eventUrl" is where Vonage will send the user's input
    const ncco = [
      {
        action: 'talk',
        text: 'Hello, this is Mila, your virtual assistant. Please say something or press a key.',
        language: 'en-US',
        style: 14,
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'], // we allow both speech and DTMF
        eventUrl: [
          // This should be your publicly accessible endpoint
          // for the input webhook:
          'https://your-domain.com/vonage/input-webhook'
        ],
        speech: {
          endOnSilence: 1, // how many seconds of silence until speech ends
          language: 'en-US',
        },
        dtmf: {
          maxDigits: 1,
          submitOnHash: false,
        },
        // Optional: You can store "businessId" in eventMethod's param or in some
        // param to track which business this call belongs to. Or track from.
        // For example:
        // "eventMethod": "POST",
        // "eventUrl": ["https://your-domain.com/vonage/input-webhook?businessId=" + businessId]
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

/***********************************************************************
 * 2) Input Webhook - Where user speech or DTMF arrives
 * 
 *   - After the "input" action in the Answer URL, Vonage posts here 
 *     once the user finishes speaking or pressing digits.
 *   - We parse the speech or dtmf.
 *   - We pass it to the assistantHandler for a response. 
 *   - We can do multi-step conversation: respond with talk + input again.
 ***********************************************************************/
export const handleInputWebhook = async (req, res) => {
  try {
    console.log('[DEBUG] InputWebhook Body:', req.body);

    // 2a) Check if user spoke or pressed DTMF
    let userText = '';
    if (req.body.speech && req.body.speech.results && req.body.speech.results.length > 0) {
      // Speech was used
      userText = req.body.speech.results[0].text; // The recognized speech
    } else if (req.body.dtmf && req.body.dtmf.digits) {
      // DTMF was used
      userText = `DTMF digit: ${req.body.dtmf.digits}`;
    } else {
      console.warn('[WARN] No speech or dtmf input found');
    }

    console.log(`[INFO] User input: ${userText}`);

    // 2b) For multi-tenancy, we might need "businessId" from call data
    // Since we didn't store it in the query, you might have a "conversation_uuid"
    // or "session_id" that you map to a business. For now, let's assume 1 or a placeholder:
    const businessId = 1; // <--- replace with logic to retrieve actual business

    // 2c) Pass userText to the AI assistant
    const assistantResponse = await assistantHandler({
      userMessage: userText,
      businessId,
      platform: 'phone',
    });

    console.log('[DEBUG] Assistant says:', assistantResponse.message);

    // 2d) For demonstration, if user says "book appointment", we do a placeholder:
    let ttsMessage = assistantResponse.message || 'How else can I help you?';

    // 2e) Return a new NCCO that TTS the AI response, 
    //     then re-invokes input for continuing conversation.
    //     This keeps the call active for multiple "turns."
    const ncco = [
      {
        action: 'talk',
        text: ttsMessage,
        language: 'en-US',
        style: 14,
      },
      {
        action: 'input',
        type: ['speech', 'dtmf'],
        eventUrl: [
          'https://your-domain.com/vonage/input-webhook'
        ],
        speech: {
          endOnSilence: 1,
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
    console.error('[ERROR] handleInputWebhook:', err.message);
    // If something goes wrong, we can end the call or play an error message
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

/***********************************************************************
 * 3) Call Events (Event URL)
 * 
 *   - Vonage will notify this endpoint for events like 'answered', 
 *     'completed', 'busy', etc. 
 ***********************************************************************/
export const handleCallEvent = async (req, res) => {
  try {
    const { status, to, from } = req.query;
    console.log(`[INFO] Call event: ${status}, To: ${to}, From: ${from}`);
    // Optionally log to DB
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

/***********************************************************************
 * 4) Fallback (Fallback URL)
 * 
 *   - If Vonage can't reach your Answer URL or an error occurs,
 *     it may call this fallback URL.
 ***********************************************************************/
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
    console.error('[ERROR] Failed to handle fallback:', error.message);
    return res.status(500).send('Failed to handle fallback');
  }
};

/***********************************************************************
 * 5) Inbound SMS or Messages (Inbound URL)
 * 
 *   - If using Vonage SMS or Messages APIs, inbound messages 
 *     may arrive here.
 ***********************************************************************/
export const handleInboundMessage = async (req, res) => {
  try {
    const { text, msisdn } = req.body || req.query;
    console.log(`[INFO] Inbound message from ${msisdn}: ${text}`);

    // Pass to AI
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

/***********************************************************************
 * 6) Call Status (Status URL)
 * 
 *   - Vonage may send call progress/final statuses here.
 ***********************************************************************/
export const handleCallStatus = async (req, res) => {
  try {
    const { status, conversation_uuid } = req.body || req.query;
    console.log(`[INFO] Call status: ${status}, Conversation UUID: ${conversation_uuid}`);

    // Optionally log to DB
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
