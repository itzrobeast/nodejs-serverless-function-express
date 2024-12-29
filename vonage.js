import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: process.env.VONAGE_PRIVATE_KEY,
});

// Function to dynamically assign Vonage number
export const assignVonageNumberDynamically = async (businessId) => {
  try {
    const availableNumbers = await vonage.number.search({ country: 'US' });
    if (availableNumbers.numbers.length === 0) throw new Error('No available numbers found');
    const selectedNumber = availableNumbers.numbers[0].msisdn;
    await vonage.number.buy({ country: 'US', msisdn: selectedNumber });

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

// Function to handle inbound calls
export const handleInboundCall = async (req, res) => {
  try {
    const { to, from } = req.body;
    const { data: businessData, error: businessError } = await supabase
      .from('vonage_numbers')
      .select('business_id')
      .eq('vonage_number', to)
      .single();
    if (businessError || !businessData) {
      return res.json([{ action: 'talk', text: 'Sorry, we cannot process your call at this time.' }]);
    }
    const assistantResponse = await assistantHandler({
      userMessage: `Inbound call received from ${from}. How should I assist?`,
      businessId: businessData.business_id,
      platform: 'phone',
    });
    return res.json([{ action: 'talk', text: assistantResponse.message || 'Thank you for calling.' }]);
  } catch (error) {
    return res.json([{ action: 'talk', text: 'Unable to process your call.' }]);
  }
};

// Function to make outbound calls
export const makeOutboundCall = async (to, from, text) => {
  try {
    await vonage.calls.create({
      to: [{ type: 'phone', number: to }],
      from: { type: 'phone', number: from },
      ncco: [{ action: 'talk', text }],
    });
  } catch (error) {
    console.error('[ERROR] Failed to make outbound call:', error.message);
  }
};

// Function to send SMS
export const sendSMS = async (to, text) => {
  try {
    const response = await vonage.sms.send({ to, from: process.env.VONAGE_PHONE_NUMBER, text });
    return response;
  } catch (error) {
    console.error('[ERROR] Failed to send SMS:', error.message);
    throw error;
  }
};

// Function to make voice call
export const makeCall = async (to, message) => {
  try {
    const response = await vonage.voice.createCall({
      to: [{ type: 'phone', number: to }],
      from: { type: 'phone', number: process.env.VONAGE_PHONE_NUMBER },
      ncco: [{ action: 'talk', text: message }],
    });
    return response;
  } catch (error) {
    console.error('[ERROR] Failed to make call:', error.message);
    throw error;
  }
};
