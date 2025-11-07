import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Database setup
let db;
async function initDB() {
  db = await open({
    filename: "./patients.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstName TEXT,
      lastName TEXT,
      dob TEXT,
      phone TEXT,
      email TEXT,
      insuranceProvider TEXT,
      location TEXT,
      issueCategory TEXT,
      issueDetail1 TEXT,
      issueDetail2 TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      leadScore INTEGER,
      subcategory TEXT
    )
  `);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Nifiso backend (English only) with DB + AI is running");
});

const sessions = {};

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!sessionId) return res.json({ reply: "Missing session ID" });

  if (!sessions[sessionId]) {
    sessions[sessionId] = { step: 1, branch: null, data: {} };
  }
  const s = sessions[sessionId];

  const scoreLead = (d) => {
    let score = 0;
    if (d.branch === "swelling") score += 30;
    if (d.branch === "pain") score += (Number(d.painScale) >= 7 ? 20 : 5);
    if (d.fever === "Yes") score += 20;
    if (d.chipSize === "Large") score += 15;
    if (d.subcategory === "Implants") score += 15;
    if (d.subcategory === "Veneers") score += 10;
    if (d.timeframe === "ASAP") score += 10;
    if (d.timeframe === "This week") score += 5;
    return score;
  };

  switch (s.step) {
    // STEP 1 — first message to user
    case 1: {
      s.step = 2;
      return res.json({
        reply: "Hello! What dental issue brings you in today?",
        options: [
          "Tooth pain / sensitivity",
          "Broken or chipped tooth",
          "Swelling or infection",
          "Aesthetic treatment",
          "Routine check-up / cleaning"
        ]
      });
    }

    // STEP 2 — branch selection
    case 2: {
      s.data.issueCategory = message;

      if (/pain|sensitivity/i.test(message)) s.branch = "pain";
      else if (/broken|chipped/i.test(message)) s.branch = "broken";
      else if (/swelling|infection/i.test(message)) s.branch = "swelling";
      else if (/aesthetic/i.test(message)) s.branch = "aesthetic";
      else s.branch = "routine";

      s.step = 3;

      if (s.branch === "pain")
        return res.json({ reply: "Which side is affected?", options: ["Left", "Right", "Both", "Not sure"] });

      if (s.branch === "broken")
        return res.json({ reply: "Is it a front or back tooth?", options: ["Front tooth", "Back tooth", "Not sure"] });

      if (s.branch === "swelling")
        return res.json({ reply: "Do you have fever?", options: ["Yes", "No"] });

      if (s.branch === "aesthetic")
        return res.json({
          reply: "What type of aesthetic treatment are you interested in?",
          options: ["Whitening", "Veneers", "Invisalign / Braces", "Implants", "Crowns / Bridges"]
        });

      return res.json({
        reply: "When was your last dental visit?",
        options: ["< 6 months", "6–12 months", "> 12 months", "Never"]
      });
    }

    // STEP 3 — branch follow-up
    case 3: {
      if (s.branch === "pain") {
        s.data.side = message;
        s.step = 4;
        return res.json({ reply: "Upper or lower?", options: ["Upper", "Lower", "Both", "Not sure"] });
      }
      if (s.branch === "broken") {
        s.data.toothPosition = message;
        s.step = 4;
        return res.json({ reply: "How big is the chip?", options: ["Small", "Medium", "Large"] });
      }
      if (s.branch === "swelling") {
        s.data.fever = message;
        s.step = 4;
        return res.json({ reply: "Since when did this start?" });
      }
      if (s.branch === "aesthetic") {
        s.data.subcategory = message;
        s.step = 4;
        return res.json({
          reply: "When would you like to start?",
          options: ["ASAP", "This week", "This month"]
        });
      }
      if (s.branch === "routine") {
        s.data.lastVisit = message;
        s.step = 4;
        return res.json({ reply: "Preferred time?", options: ["Morning", "Afternoon", "Evening"] });
      }
      s.step = 4;
      return res.json({ reply: "How long has this been happening?" });
    }

    // STEP 4 → identity info
    case 4:
      s.step = 5;
      return res.json({ reply: "First name:" });

    case 5:
      s.data.firstName = message;
      s.step = 6;
      return res.json({ reply: "Last name:" });

    case 6:
      s.data.lastName = message;
      s.step = 7;
      return res.json({ reply: "Mobile number:" });

    case 7:
      s.data.phone = message;
      s.step = 8;
      return res.json({
        reply: "Would you like to add more information?",
        options: ["Yes", "No"]
      });

    case 8:
      if (/yes/i.test(message)) {
        s.step = 9;
        return res.json({ reply: "Please provide any additional details:" });
      } else {
        s.data.moreInfo = "";
        s.step = 10;
      }

    case 9:
      if (s.step === 9) {
        s.data.moreInfo = message;
        s.step = 10;
      }

      const notes = JSON.stringify(s.data);
      const leadScore = scoreLead({ ...s.data, branch: s.branch });

      await db.run(
        `INSERT INTO patients (firstName,lastName,phone,issueCategory,notes,leadScore)
         VALUES (?,?,?,?,?,?)`,
        [s.data.firstName, s.data.lastName, s.data.phone, s.data.issueCategory, notes, leadScore]
      );

      return res.json({
        reply: `Thank you ${s.data.firstName}, our dental team will contact you shortly.`
      });

    default:
      return res.json({ reply: "Please refresh to start again." });
  }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`Nifiso backend (EN only) live on ${PORT}`));
});
