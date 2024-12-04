import { Vonage } from '@vonage/server-sdk';

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

export const handleInboundCall = (req, res) => {
  const { to, from } = req.body;
  console.log(`[INFO] Inbound call from ${from} to ${to}`);

  // Fetch the business associated with the number
  supabase
    .from('vonage_numbers')
    .select('business_id')
    .eq('vonage_number', to)
    .single()
    .then(({ data, error }) => {
      if (error || !data) {
        console.error('[ERROR] Business not found for inbound call:', error.message);
        return res.json([{ action: 'talk', text: 'Sorry, we could not handle your call at this time.' }]);
      }

      const businessId = data.business_id;

      // Pass the call to the assistant
      assistantHandler({
        userMessage: `Call from ${from}`,
        recipientId: businessId,
        platform: 'phone',
      }).then((response) => {
        res.json([{ action: 'talk', text: response.message || 'Thank you for calling.' }]);
      });
    });
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
