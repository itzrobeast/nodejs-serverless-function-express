import supabase from './supabaseClient.js';

/**
 * Log a conversation entry into the inbound_calls table.
 * @param {Object} conversationData - Data for logging the conversation.
 * @param {number} conversationData.businessId - ID of the business.
 * @param {string} conversationData.senderPhone - Phone number of the sender.
 * @param {string} conversationData.receiverPhone - Phone number of the receiver.
 * @param {string} conversationData.message - Message content.
 * @param {string} conversationData.messageType - Type of message (text, dtmf, speech, etc.).
 * @param {string} conversationData.role - Role of the sender (customer or business).
 * @param {string} [conversationData.callerName] - Name of the caller (optional).
 * @param {string} [conversationData.email] - Email address (optional).
 * @param {string} [conversationData.location] - Location (optional).
 */
export const logConversation = async ({
  businessId,
  senderPhone,
  receiverPhone,
  message,
  messageType,
  role,
  callerName = null,
  email = null,
  location = null,
}) => {
  const { error } = await supabase.from('inbound_calls').insert({
    business_id: businessId,
    sender_phone: senderPhone,
    receiver_phone: receiverPhone,
    message,
    message_type: messageType,
    role,
    caller_name: callerName,
    email,
    location,
  });

  if (error) {
    console.error('[ERROR] Failed to log conversation:', error.message);
  } else {
    console.log('[INFO] Conversation logged successfully.');
  }
};
