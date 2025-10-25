import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Database initialization
let db;
async function initDB() {
  db = await open({
    filename: "./patients.db",
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      issueCategory TEXT,
      issueDetails TEXT,
      insuranceProvider TEXT,
      email TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Nifiso backend with DB + AI is running");
});

app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;
  const reply = await getAIReply(userMessage);
  res.json({ reply });
});

app.post("/api/patient", async (req, res) => {
  try {
    const { name, phone, issueCategory, issueDetails, insuranceProvider, email } = req.body;

    await db.run(
      `INSERT INTO patients (name, phone, issueCategory, issueDetails, insuranceProvider, email)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, phone, issueCategory, issueDetails, insuranceProvider, email]
    );

    res.status(201).json({ message: "Stored successfully" });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

async function getAIReply(message) {
  const apiKey = process.env.OPENAI_API_KEY;

  const prompt = `
You are Nifiso, a medical intake assistant for Dubai clinics.
Rules:
1. First ask the patient what type of issue they have (provide selectable options).
2. Then collect details: location, pain type, duration.
3. Then collect: Name + Phone + (optional Email).
4. Then briefly summarize and say a doctor will contact them.
5. Never give medical advice, only intake info.

Patient says: "${message}"
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
  return data.choices?.[0]?.message?.content || "Please repeat.";
}

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => console.log(`Live with DB + AI on ${PORT}`));
});
