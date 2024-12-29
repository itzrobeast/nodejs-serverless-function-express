import { Vonage } from '@vonage/server-sdk';
import supabase from './supabaseClient.js';
import { assistantHandler } from './assistant.js';


const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID, // Optional for advanced features
  privateKey: process.env.VONAGE_PRIVATE_KEY, // Optional for advanced features
});


const assignVonageNumberDynamically = async (businessId) => {
  try {
    // Search for available numbers
    const availableNumbers = await vonage.number.search({ country: 'US' });

    if (availableNumbers.numbers.length === 0) {
      throw new Error('No available numbers found');
    }

    const selectedNumber = availableNumbers.numbers[0].msisdn;

    // Buy the selected number
    await vonage.number.buy({ country: 'US', msisdn: selectedNumber });

    // Insert the number into the database
    const { error } = await supabase
      .from('vonage_numbers')
      .insert([{ business_id: businessId, vonage_number: selectedNumber }]);

    if (error) {
      throw new Error(`Failed to insert Vonage number into database: ${error.message}`);
    }

    console.log(`[INFO] Dynamically assigned Vonage number ${selectedNumber} to business ID ${businessId}`);
    return selectedNumber;
  } catch (error) {
    console.error('[ERROR] Failed to dynamically assign Vonage number:', error.message);
    throw error;
  }
};


export const makeOutboundCall = async (to, from, text) => {
  try {
    await vonage.calls.create({
      to: [{ type: 'phone', number: to }],
      from: { type: 'phone', number: from },
      ncco: [
        {
          action: 'talk',
          text,
        },
      ],
    });
    console.log(`[INFO] Outbound call made to ${to}`);
  } catch (error) {
    console.error('[ERROR] Failed to make outbound call:', error.message);
  }
};

export const handleInboundCall = async (req, res) => {
  try {
    const { to, from } = req.body;

    console.log(`[INFO] Received inbound call from ${from} to ${to}`);

    // Fetch the business associated with the called number
    const { data: businessData, error: businessError } = await supabase
      .from('vonage_numbers')
      .select('business_id')
      .eq('vonage_number', to)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Failed to find business for the Vonage number:', businessError?.message || 'No business found');
      return res.json([{ action: 'talk', text: 'Sorry, we could not handle your call at this time. Please try again later.' }]);
    }

    const businessId = businessData.business_id;

    console.log(`[INFO] Matched Vonage number ${to} to business ID: ${businessId}`);

    // Fetch assistant's response based on the call context
    const assistantResponse = await assistantHandler({
      userMessage: `Inbound call received from ${from}. How should I assist?`,
      businessId,
      platform: 'phone', // Specify the interaction platform for context
    });

    const responseMessage = assistantResponse.message || 'Thank you for calling. How can I assist you today?';

    console.log(`[INFO] Assistant response for ${from}: ${responseMessage}`);

    // Send NCCO response to Vonage
    return res.json([{ action: 'talk', text: responseMessage }]);
  } catch (error) {
    console.error('[ERROR] Failed to handle inbound call:', error.message);

    // Return fallback response in case of unexpected errors
    return res.json([{ action: 'talk', text: 'We are currently unable to process your call. Please try again later.' }]);
  }
};



// Function to send SMS
export const sendSMS = async (to, text) => {
  try {
    const response = await vonage.sms.send({
      to,
      from: process.env.VONAGE_PHONE_NUMBER,
      text,
    });
    console.log('[INFO] SMS sent successfully:', response);
    return { success: true, response };
  } catch (error) {
    console.error('[ERROR] Failed to send SMS:', error.response || error.message);
    throw new Error(`Failed to send SMS: ${error.response?.messages[0]?.['error-text'] || error.message}`);
  }
};

// Function to make a voice call
export const makeCall = async (to, message) => {
  try {
    const response = await vonage.voice.createCall({
      to: [{ type: 'phone', number: to }],
      from: { type: 'phone', number: process.env.VONAGE_PHONE_NUMBER },
      ncco: [
        {
          action: 'talk',
          text: message,
        },
      ],
    });
    console.log('[INFO] Call initiated successfully:', response);
    return { success: true, response };
  } catch (error) {
    console.error('[ERROR] Failed to make call:', error.response || error.message);
    throw new Error(`Failed to make call: ${error.response?.messages[0]?.['error-text'] || error.message}`);
  }
};
