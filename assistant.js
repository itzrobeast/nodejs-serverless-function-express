import OpenAI from 'openai';
import supabase from './supabaseClient.js'; // Supabase client for secure backend operations

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const getBusinessConfig = async (businessId) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', businessId)
      .single();

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

export const assistantHandler = async ({ userMessage, recipientId, platform, businessId }) => {
  try {
    console.log(`[DEBUG] Processing message from platform: ${platform}`);
    console.log(`[DEBUG] User message: "${userMessage}"`);

    if (!userMessage || typeof userMessage !== 'string') {
      console.error('[ERROR] Invalid user message:', userMessage);
      return { message: 'I couldn’t understand your message. Could you please rephrase it?' };
    }

    // Fetch business-specific configuration
    const businessConfig = await getBusinessConfig(businessId);

    if (!businessConfig) {
      return { message: 'Could not retrieve business configuration. Please try again later.' };
    }

    // Generate response using OpenAI
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an AI receptionist for ${businessConfig.name}. Your role is to assist users with appointments, provide accurate responses, and ensure professionalism. Business-specific knowledge: ${businessConfig.ai_knowledge}.`,
        },
        { role: 'user', content: userMessage },
      ],
    });

    const responseMessage = openaiResponse.choices[0]?.message?.content || "I'm here to help!";
    console.log(`[DEBUG] OpenAI response: "${responseMessage}"`);

    return { message: responseMessage };
  } catch (error) {
    console.error('[ERROR] Failed to process assistant request:', error);
    return { message: 'Something went wrong. Please try again later.' };
  }
};
