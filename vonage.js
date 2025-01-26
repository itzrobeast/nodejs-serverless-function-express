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
 * Assign a Vonage number dynamically to a business.
 */
export const assignVonageNumberDynamically = async (businessId) => {
  try {
    const availableNumbers = await vonage.number.search({ country: 'US' });
    if (!availableNumbers.numbers || availableNumbers.numbers.length === 0) {
      throw new Error('No available numbers found');
    }

    const selectedNumber = availableNumbers.numbers[0].msisdn;

    // Purchase the number
    await vonage.number.buy({ country: 'US', msisdn: selectedNumber });

    // Save to database
    const { error } = await supabase
      .from('vonage_numbers')
      .insert([{ business_id: businessId, vonage_number: selectedNumber }]);
    if (error) throw new Error(`Database error: ${error.message}`);

    return selectedNumber;
  } catch (error) {
    console.error('[ERROR] Failed to assign Vonage number:', error.message);
    throw error;
  }
};

/**
 * Handle inbound calls and pass them to Mila for processing.
 */
export const handleInboundCall = async (req, res) => {
  try {
    const { to, from } = req.body;

    // Find the business associated with the called number
    const { data: businessData, error: businessError } = await supabase
      .from('vonage_numbers')
      .select('business_id')
      .eq('vonage_number', to)
      .single();

    if (businessError || !businessData) {
      return res.json([{ action: 'talk', text: 'Sorry, we cannot process your call at this time.' }]);
    }

    // Use assistantHandler to process the inbound call
    const assistantResponse = await assistantHandler({
      userMessage: `Inbound call received from ${from}. How should I assist?`,
      businessId: businessData.business_id,
      platform: 'phone',
    });

    return res.json([
      {
        action: 'talk',
        text: assistantResponse.message || 'Thank you for calling. How can I help you today?',
      },
    ]);
  } catch (error) {
    console.error('[ERROR] Failed to process inbound call:', error.message);
    return res.json([{ action: 'talk', text: 'Unable to process your call. Please try again later.' }]);
  }
};

/**
 * Make an outbound call to a lead.
 */
export const makeOutboundCall = async (to, from, text) => {
  try {
    await vonage.calls.create({
      to: [{ type: 'phone', number: to }],
      from: { type: 'phone', number: from },
      ncco: [{ action: 'talk', text }],
    });
    console.log(`[INFO] Outbound call placed to ${to}`);
  } catch (error) {
    console.error('[ERROR] Failed to make outbound call:', error.message);
  }
};

/**
 * Send an SMS to a lead.
 */
export const sendSMS = async (to, text) => {
  try {
    const response = await vonage.sms.send({
      to,
      from: process.env.VONAGE_PHONE_NUMBER,
      text,
    });
    console.log(`[INFO] SMS sent to ${to}`);
    return response;
  } catch (error) {
    console.error('[ERROR] Failed to send SMS:', error.message);
    throw error;
  }
};

/**
 * Place a voice call with Mila speaking a message.
 */
export const makeCall = async (to, message) => {
  try {
    const response = await vonage.voice.createCall({
      to: [{ type: 'phone', number: to }],
      from: { type: 'phone', number: process.env.VONAGE_PHONE_NUMBER },
      ncco: [{ action: 'talk', text: message }],
    });
    console.log(`[INFO] Call initiated to ${to}`);
    return response;
  } catch (error) {
    console.error('[ERROR] Failed to make call:', error.message);
    throw error;
  }
};
