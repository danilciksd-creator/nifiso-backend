import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Nifiso backend is running");
});

app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;
  res.json({ reply: `Echo: ${userMessage}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));
