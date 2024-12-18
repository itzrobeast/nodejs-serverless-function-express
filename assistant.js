// assistant.js

import OpenAI from 'openai';
import supabase from './supabaseClient.js'; // Ensure this path is correct
import { sendInstagramMessage } from './instagramWebhook.js'; // Correct relative path

// Initialize OpenAI with your API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Fetches the business configuration based on the provided business ID.
 * @param {number} businessId - The internal ID of the business.
 * @returns {object|null} - The business configuration object or null if not found.
 */
const getBusinessConfig = async (businessId) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single(); // Expects exactly one row

    if (error) {
      console.error('[ERROR] Fetching business configuration failed:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[ERROR] Unexpected error fetching business config:', err.message);
    return null;
  }
};

/**
 * Generates a response using OpenAI's GPT-4 based on the user's message and business configuration.
 * @param {string} userMessage - The message sent by the user.
 * @param {object} businessConfig - The business configuration object.
 * @returns {string} - The generated response message.
 */
const generateAssistantResponse = (userMessage, businessConfig) => {
  // Customize the system prompt as needed
  const systemPrompt = `You are an AI receptionist for ${businessConfig.name}. Your role is to assist users with appointments, provide accurate responses, and ensure professionalism. Business-specific knowledge: ${businessConfig.ai_knowledge}.`;

  return `${systemPrompt}\nUser: ${userMessage}\nAI:`;
};

/**
 * Handles the assistant's response to a user message.
 * @param {object} params - Parameters for the assistant.
 * @param {string} params.userMessage - The user's message.
 * @param {string} params.recipientId - The Instagram user's ID to send the response to.
 * @param {string} params.platform - The platform (e.g., 'instagram').
 * @param {number} params.businessId - The internal business ID.
 * @returns {object} - An object containing the message to send.
 */
export const assistantHandler = async ({ userMessage, recipientId, platform, businessId }) => {
  try {
    console.log(`[DEBUG] Processing message from platform: ${platform}`);
    console.log(`[DEBUG] User message: "${userMessage}"`);
    console.log(`[DEBUG] Recipient ID: ${recipientId}`);
    console.log(`[DEBUG] Business ID: ${businessId}`);

    // Validate user message
    if (!userMessage || typeof userMessage !== 'string') {
      console.error('[ERROR] Invalid user message:', userMessage);
      return { message: 'I couldn’t understand your message. Could you please rephrase it?' };
    }

    // Fetch business-specific configuration
    const businessConfig = await getBusinessConfig(businessId);

    if (!businessConfig) {
      console.error('[ERROR] Business configuration not found for businessId:', businessId);
      return { message: 'Could not retrieve business configuration. Please try again later.' };
    }

    // Generate the assistant's response using OpenAI
    const prompt = generateAssistantResponse(userMessage, businessConfig);

    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an AI receptionist for ${businessConfig.name}. Your role is to assist users with appointments, provide accurate responses, and ensure professionalism.`,
        },
        { role: 'user', content: userMessage },
      ],
      // You can adjust other parameters like temperature, max_tokens, etc., as needed
    });

    const responseMessage = openaiResponse.choices[0]?.message?.content?.trim() || "I'm here to help!";
    console.log(`[DEBUG] OpenAI response: "${responseMessage}"`);

    return { message: responseMessage };
  } catch (error) {
    console.error('[ERROR] Failed to process assistant request:', error);
    return { message: 'Something went wrong. Please try again later.' };
  }
};

export default assistantHandler;
