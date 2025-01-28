/**********************************************************/
/** assistant.js -- Master Code with Redis + Setmore + AI **/
/**********************************************************/
import OpenAI from 'openai';
import axios from 'axios';
import supabase from './supabaseClient.js';
import { createClient } from 'redis'; // For Upstash or other cloud Redis

/**********************************************************
 * 0) Redis (Upstash) Setup
 **********************************************************/
const redis = createClient({
  url: process.env.KV_URL,
  password: process.env.KV_REST_API_TOKEN,
  socket: {
    tls: true,
    rejectUnauthorized: false, // Accept self-signed cert in Upstash
  },
});

redis
  .connect()
  .then(() => console.log('[INFO] Connected to Redis successfully via Upstash'))
  .catch((err) => console.error('[ERROR] Redis connection failed:', err.message));

export { redis };

/**********************************************************
 * 1) Initialize OpenAI
 **********************************************************/
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // must be set in your environment
});

/**********************************************************
 * 2) Preprocess User Message
 **********************************************************/
const preprocessMessage = (message) => {
  return message.replace(/\b(uh|um|like|you know|so)\b/gi, '').trim();
};

/**********************************************************
 * 3) Fetch Business Config with Redis Caching
 **********************************************************/
const getBusinessConfig = async (businessId) => {
  try {
    console.time(`Fetch BusinessConfig for Business ${businessId}`);

    // 1. Attempt to fetch from Redis cache
    const cacheKey = `business:${businessId}`;
    const cachedConfig = await redis.get(cacheKey);
    if (cachedConfig) {
      console.timeEnd(`Fetch BusinessConfig for Business ${businessId}`);
      console.log(`[INFO] Cache hit for businessId=${businessId}`);
      return JSON.parse(cachedConfig);
    }

    // 2. If not in cache, query Supabase
    const { data, error } = await supabase
      .from('businesses')
      .select(`
        name,
        locations,
        insurance_policies,
        objections,
        ai_knowledge_base,
        contact_email,
        financing_link,
        appointment_booking_link,
        custom_links
      `)
      .eq('id', businessId)
      .single();

    if (error) {
      console.error(`[ERROR] Fetching business config failed: ${error.message}`);
      return null;
    }
    if (!data) {
      console.warn(`[WARN] No data returned for businessId=${businessId}`);
      return null;
    }

    // 3. Store the result in Redis with a 1-hour TTL
    await redis.set(cacheKey, JSON.stringify(data), { EX: 3600 });
    console.timeEnd(`Fetch BusinessConfig for Business ${businessId}`);
    return data;
  } catch (err) {
    console.error(`[ERROR] Unexpected error in getBusinessConfig: ${err.message}`);
    return null;
  }
};

/**********************************************************
 * 4) Create System Message
 **********************************************************/
const createSystemMessage = (businessConfig) => {
  const {
    name,
    locations,
    insurance_policies,
    objections,
    ai_knowledge_base,
    contact_email,
    financing_link,
    appointment_booking_link,
    custom_links,
  } = businessConfig || {};

  const locationsStr = locations ? JSON.stringify(locations) : 'Not provided';
  const customLinksStr = custom_links ? JSON.stringify(custom_links) : 'Not provided';

  return `
You are an AI receptionist for "${name}". Your role is to:
1. Assist customers with professionalism, empathy, and accuracy.
2. Provide business-specific details like hours, location, links, and policies.
3. Help with appointment scheduling (via Setmore).
4. Respond specifically to queries about services, pricing, or appointments.
5. Reach out to new leads, encourage them to book appointments, address their objections with empathy, provide assurance about the process, and ensure timely follow-ups for successful engagement.
6. When reaching out to leads and making the phone call. introduce yourself and the business and explain that you are there to help book their appointment and answer any questions they have.

Business-specific details:
- Locations: ${locationsStr}
- Insurance Policies: ${insurance_policies || 'Not provided'}
- Common Objections: ${objections || 'Not provided'}
- Contact Email: ${contact_email || 'Not provided'}
- Financing Link: ${financing_link || 'Not provided'}
- Appointment Booking Link: ${appointment_booking_link || 'Not provided'}
- Custom Links: ${customLinksStr}
- AI Knowledge Base: ${ai_knowledge_base || 'Not provided'}

Examples of user queries:
- "What services do you offer?"
- "Can you help me book an appointment?"
- "Do you have financing options?"

When unsure of an answer, politely acknowledge and suggest following up via email or phone.
Keep responses concise and relevant to user queries.
`;
};

/**********************************************************
 * 5) Setmore Token Management
 **********************************************************/
const refreshSetmoreToken = async (businessId) => {
  try {
    const { data, error } = await supabase
      .from('setmore_integrations')
      .select('id, refresh_token')
      .eq('business_id', businessId)
      .single();

    if (error || !data?.refresh_token) {
      console.error('[ERROR] Missing Setmore refresh token or Supabase error:', error?.message);
      return null;
    }
    const { id: integrationId, refresh_token } = data;

    const url = `https://developer.setmore.com/api/v1/o/oauth2/token?refreshToken=${refresh_token}`;
    const response = await axios.get(url);

    if (!response.data?.response || !response.data?.data?.token) {
      console.error('[ERROR] Unexpected response from Setmore refresh:', response.data);
      return null;
    }

    const { access_token, expires_in } = response.data.data.token;

    const now = new Date();
    const bufferMs = 60 * 60 * 1000;
    const expirationDate = new Date(now.getTime() + expires_in * 1000 - bufferMs);

    const { error: updateError } = await supabase
      .from('setmore_integrations')
      .update({ access_token, token_expires_at: expirationDate.toISOString() })
      .eq('id', integrationId);

    if (updateError) {
      console.error('[ERROR] Failed to update new token in DB:', updateError.message);
      return null;
    }

    console.log(`[INFO] Refreshed Setmore token for businessId=${businessId}`);
    return access_token;
  } catch (err) {
    console.error('[ERROR] refreshSetmoreToken:', err.message);
    return null;
  }
};

const getSetmoreAccessToken = async (businessId) => {
  try {
    const { data, error } = await supabase
      .from('setmore_integrations')
      .select('id, access_token, token_expires_at')
      .eq('business_id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Could not load Setmore integration for business=${businessId}`, error?.message);
      return null;
    }

    const { access_token, token_expires_at } = data;
    if (!access_token) {
      console.warn(`[WARN] No access_token found for business=${businessId}`);
      return null;
    }

    const now = new Date();
    if (token_expires_at) {
      const expiresAt = new Date(token_expires_at);
      if (expiresAt < now) {
        console.log('[INFO] Setmore token expired. Refreshing...');
        return await refreshSetmoreToken(businessId);
      }
    }

    return access_token;
  } catch (err) {
    console.error('[ERROR] getSetmoreAccessToken:', err.message);
    return null;
  }
};

/**********************************************************
 * 6) Assistant Handler
 **********************************************************/
export const assistantHandler = async ({ userMessage, businessId }) => {
  try {
    console.log(`[DEBUG] Processing for businessId=${businessId}, userMessage="${userMessage}"`);

    const cleanMessage = preprocessMessage(userMessage);

    const businessConfig = await getBusinessConfig(businessId);
    if (!businessConfig) {
      return { message: 'Unable to retrieve business details. Please try again later.' };
    }

    const systemMessage = createSystemMessage(businessConfig);

    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: cleanMessage },
      ],
      max_tokens: 300,
      temperature: 0.6,
    });

    const choice = openaiResponse.choices?.[0];
    return { message: choice?.message?.content || 'I’m here to help!' };
  } catch (err) {
    console.error('[ERROR] assistantHandler:', err.message);
    return { message: 'Something went wrong. Please try again later.' };
  }
};

export default assistantHandler;
