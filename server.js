import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Nifiso backend with AI is running");
});

app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;
  const reply = await getAIReply(userMessage);
  res.json({ reply });
});

async function getAIReply(message) {
  const apiKey = process.env.OPENAI_API_KEY;

  const prompt = `
You are Nifiso, a professional medical intake assistant for a clinic in Dubai.
Your tasks:
1. Ask what type of medical issue the patient has (choose from options).
2. Collect details relevant for booking (symptoms, when it started).
3. Collect name, phone number and optional email ONLY when relevant.
4. Do NOT give medical advice or diagnosis.
5. Keep responses short and clear.

Conversation so far. Patient says: "${message}"
`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: message }
      ],
      temperature: 0.6
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Sorry, please repeat.";
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI API running on ${PORT}`));
