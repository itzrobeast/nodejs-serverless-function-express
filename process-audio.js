import axios from "axios";

/*******************************************************
 * process-audio.js
 * 
 * This endpoint receives audio (POST requests), sends the
 * audio to Deepgram for transcription, and then generates
 * an AI response based on the transcription.
 *******************************************************/
const processAudioHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: "No audio data received" });
    }

    // 🔹 Send audio to Deepgram for transcription
    const deepgramResponse = await axios.post(
      "https://api.deepgram.com/v1/listen",
      audio,
      {
        headers: {
          "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": "audio/wav",
        },
      }
    );

    const userText =
      deepgramResponse.data.results.channels[0].alternatives[0].transcript;
    console.log(`🎤 Deepgram Transcription: ${userText}`);

    // 🔹 Generate AI Response (Replace with your Mila AI integration)
    const assistantResponse = await generateAIResponse(userText);

    return res.json({ message: assistantResponse });
  } catch (error) {
    console.error("❌ Error processing audio:", error.message);
    return res.status(500).json({ error: "Failed to process audio" });
  }
};

// 🔹 Mock AI Response Function (Replace with your Mila AI integration)
async function generateAIResponse(userText) {
  return `You said: ${userText}. How can I assist you further?`;
}

export default processAudioHandler;
