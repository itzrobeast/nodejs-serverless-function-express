import { Vonage } from '@vonage/server-sdk';

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  // Optionally include applicationId and privateKey for advanced features
});

export const sendSMS = async (to, text) => {
  try {
    const response = await vonage.sms.send({
      to,
      from: process.env.VONAGE_PHONE_NUMBER,
      text,
    });
    console.log("SMS sent successfully:", response);
    return { success: true, response };
  } catch (error) {
    console.error("Error sending SMS:", error);
    throw new Error("Failed to send SMS");
  }
};

export const makeCall = async (to, message) => {
  try {
    const response = await vonage.voice.createCall({
      to: [{ type: "phone", number: to }],
      from: { type: "phone", number: process.env.VONAGE_PHONE_NUMBER },
      ncco: [
        {
          action: "talk",
          text: message,
        },
      ],
    });
    console.log("Call initiated successfully:", response);
    return { success: true, response };
  } catch (error) {
    console.error("Error making call:", error);
    throw new Error("Failed to make call");
  }
};
