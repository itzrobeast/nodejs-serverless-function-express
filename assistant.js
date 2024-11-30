import OpenAI from 'openai';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';
import supabase from './supabaseClient.js'; // Supabase client for secure backend operations

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function handlers for various actions
const functionHandlers = {
  fetchEvents: async (args) => {
    const maxResults = args.maxResults || 10;
    const events = await getUpcomingEvents(maxResults);
    return { text: `Here are your upcoming events: ${JSON.stringify(events)}` };
  },
  sendSMS: async (args) => {
    const { to, text } = args;
    await sendSMS(to, text);
    return { text: 'SMS sent successfully!' };
  },
  makeCall: async (args) => {
    const { to, message } = args;
    await makeCall(to, message);
    return { text: 'Call placed successfully!' };
  },
  createGoogleCalendarEvent: async (args) => {
    const { summary, startDateTime, endDateTime } = args;
    await createGoogleCalendarEvent({ summary, startDateTime, endDateTime });
    return { text: 'Appointment created successfully on Google Calendar!' };
  },
};

// Objection handler
const handleObjections = (userMessage, businessConfig) => {
  const objections = businessConfig.objections || {
    financial: "We have financing options. If you'd like, I can forward you the link.",
    insurance: {
      general: "We only take Medical in San Diego, not at the Los Angeles office in Burbank.",
      exclusions: "Medical does not cover any implants or advanced surgery procedures.",
    },
  };

  if (userMessage.includes('money') || userMessage.includes('finance')) {
    return objections.financial;
  }

  if (userMessage.includes('Medical')) {
    return `${objections.insurance.general} ${objections.insurance.exclusions}`;
  }

  return null; // No objections found
};

// Fetch business configuration securely using Supabase
const getBusinessConfig = async (owner_id) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', owner_id)
      .single();

    if (error) {
      console.error('Error fetching business configuration:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Unexpected error fetching business config:', err.message);
    return null;
  }
};

// Assistant handler to process user messages
export const assistantHandler = async ({ userMessage, recipientId, platform }) => {
  try {
    console.log(`[DEBUG] Processing message from platform: ${platform}`);
    console.log(`[DEBUG] User message: "${userMessage}"`);

    if (!userMessage || typeof userMessage !== 'string') {
      console.error('[ERROR] Invalid user message:', userMessage);
      return { text: 'I couldn’t understand your message. Could you please rephrase it?' };
    }

    // Fetch business-specific configuration
    const businessConfig = await getBusinessConfig(recipientId);

    if (!businessConfig) {
      return { message: 'Could not retrieve business configuration. Please try again later.' };
    }

    // Handle objections dynamically
    const objectionResponse = handleObjections(userMessage, businessConfig);
    if (objectionResponse) {
      console.log('[DEBUG] Objection response triggered:', objectionResponse);
      return { message: objectionResponse };
    }

    // Generate response using OpenAI
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an AI receptionist for ${businessConfig.name}. Your role is to manage appointments, answer user questions, and provide information based on ${businessConfig.name}'s website and guidelines. You operate for the following locations: ${businessConfig.locations.join(
            ', '
          )}. Stay professional and to the point.`,
        },
        { role: 'user', content: userMessage },
      ],
      functions: Object.keys(functionHandlers).map((name) => ({
        name,
        description: `Executes the ${name} function.`,
        parameters: { type: 'object', properties: {} },
      })),
    });

    const functionCall = openaiResponse.choices[0]?.message?.function_call;

    // Handle OpenAI function calls if requested
    if (functionCall) {
      const { name, arguments: args } = functionCall;
      console.log(`[DEBUG] OpenAI requested function call: ${name}`, args);

      try {
        const parsedArgs = JSON.parse(args);
        if (functionHandlers[name]) {
          return await functionHandlers[name](parsedArgs);
        } else {
          console.warn(`[DEBUG] No handler found for function: ${name}`);
        }
      } catch (err) {
        console.error(`[ERROR] Error processing function call for ${name}:`, err);
      }
    }

    // Default OpenAI response
    const responseMessage = openaiResponse.choices[0]?.message?.content || "I'm here to help!";
    console.log(`[DEBUG] Generated response from OpenAI: "${responseMessage}"`);

    return { message: responseMessage };
  } catch (error) {
    console.error('[ERROR] Failed to process assistant request:', error);
    return { message: 'Something went wrong. Please try again later.' };
  }
};

// Default API handler for external requests
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { userMessage, recipientId, platform } = req.body;

      if (!userMessage || !recipientId || !platform) {
        return res.status(400).json({ error: 'Missing required fields: userMessage, recipientId, or platform.' });
      }

      const assistantResponse = await assistantHandler({ userMessage, recipientId, platform });
      return res.status(200).json({ success: true, assistantResponse });
    }

    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Assistant endpoint is live. Use POST to interact with the assistant.' });
    }

    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  } catch (error) {
    console.error('[ERROR] Assistant API handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
