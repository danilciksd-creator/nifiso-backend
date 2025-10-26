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

const sessions = {};

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!sessionId) return res.json({ reply: "Missing session ID" });

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      step: 1,
      data: {}
    };
  }

  const session = sessions[sessionId];

  switch (session.step) {
    case 1:
      session.step++;
      return res.json({
        reply: "What is your dental issue?",
        options: [
          "Tooth pain / sensitivity",
          "Broken or chipped tooth",
          "Swelling or infection",
          "Aesthetic treatment",
          "Routine check-up / cleaning"
        ]
      });

    case 2:
      session.data.issueCategory = message;
      session.step++;
      return res.json({
        reply: "Which side?",
        options: ["Left", "Right", "Both"]
      });

    case 3:
      session.data.issueDetail1 = message;
      session.step++;
      return res.json({
        reply: "How long has this been happening? (e.g. 2 days)"
      });

    case 4:
      session.data.issueDetail2 = message;
      session.step++;
      return res.json({ reply: "First name:" });

    case 5:
      session.data.firstName = message;
      session.step++;
      return res.json({ reply: "Last name:" });

    case 6:
      session.data.lastName = message;
      session.step++;
      return res.json({ reply: "Mobile number:" });

    case 7:
      session.data.phone = message;
      session.step++;
      return res.json({ reply: "Date of birth (YYYY-MM-DD):" });

    case 8:
      session.data.dob = message;
      session.step++;
      return res.json({
        reply: "Do you have insurance?",
        options: ["AXA", "Daman", "Thiqa", "Other", "No insurance"]
      });

    case 9:
      session.data.insuranceProvider = message;
      session.step++;
      return res.json({ reply: "Email (optional): or type 'no'" });

    case 10:
      session.data.email = message.toLowerCase() === "no" ? "" : message;
      session.step++;
      return res.json({ reply: "Which area of Dubai are you in?" });

    case 11:
      session.data.location = message;
      session.step++;

      await db.run(
        `INSERT INTO patients 
        (firstName,lastName,phone,dob,email,insuranceProvider,location,
        issueCategory,issueDetail1,issueDetail2)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          session.data.firstName,
          session.data.lastName,
          session.data.phone,
          session.data.dob,
          session.data.email,
          session.data.insuranceProvider,
          session.data.location,
          session.data.issueCategory,
          session.data.issueDetail1,
          session.data.issueDetail2
        ]
      );

      return res.json({
        reply:
          `Thank you ${session.data.firstName}, our dental team will contact you shortly.`
      });

    default:
      return res.json({ reply: "Please refresh to start again." });
  }
});

// Simple admin auth (static login for MVP)
const adminUser = {
  username: "admin",
  password: "nifiso123" // später env-var/ hashed
};

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === adminUser.username &&
    password === adminUser.password
  ) {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false });
});

app.get("/api/admin/patients", async (req, res) => {
  try {
    const data = await db.all("SELECT * FROM patients ORDER BY timestamp DESC");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});




const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => console.log(`Live with DB + AI on ${PORT}`));
});
