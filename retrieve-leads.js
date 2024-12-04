import fetch from 'node-fetch';

export const getLeadsFromMeta = async (accessToken, pageId) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${accessToken}`
    );
    if (!response.ok) throw new Error('Failed to retrieve leads');
    const data = await response.json();
    return data.data; // Array of leads
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads from Meta:', error.message);
    return [];
  }
};
