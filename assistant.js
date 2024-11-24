import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const { messages } = req.body; // Input messages (e.g., from user queries)

    try {
        const response = await openai.createChatCompletion({
            model: "gpt-4",
            messages: messages,
            functions: [
                {
                    name: "bookAppointment",
                    description: "Book an appointment on Google Calendar",
                    parameters: { type: "object", properties: { title: { type: "string" }, time: { type: "string" } } },
                },
                {
                    name: "replyToComment",
                    description: "Reply to a social media comment",
                    parameters: { type: "object", properties: { text: { type: "string" }, postId: { type: "string" } } },
                },
                {
                    name: "makeCall",
                    description: "Make a call via Vodafone",
                    parameters: { type: "object", properties: { number: { type: "string" }, message: { type: "string" } } },
                },
            ],
        });

        const functionCall = response.data.choices[0].message.function_call;
        res.status(200).json(functionCall); // Return the function call response
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}
