import { Vonage } from '@vonage/server-sdk';

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID, // Optional for advanced features
  privateKey: process.env.VONAGE_PRIVATE_KEY, // Optional for advanced features
});

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
