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

app.post("/api/chat", async (req, res) => {
  const { message, sessionId, lang = "en" } = req.body;
  if (!sessionId) return res.json({ reply: "Missing session ID" });

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      step: 1,
      data: {}
    };
  }

  const session = sessions[sessionId];
  const t = (en, ar) => (lang === "ar" ? ar : en);

  switch (session.step) {
    case 1:
      session.step++;
      return res.json({
        reply: t("What is your dental issue?", "ما هي مشكلتك السنية؟"),
        options: [
          t("Tooth pain / sensitivity", "ألم أو حساسية في الأسنان"),
          t("Broken or chipped tooth", "كسر أو تشقق في السن"),
          t("Swelling or infection", "تورم أو التهاب"),
          t("Aesthetic treatment", "علاج تجميلي"),
          t("Routine check-up / cleaning", "فحص روتيني / تنظيف")
        ]
      });

    case 2:
      session.data.issueCategory = message;
      session.step++;

      if (
        /pain|sensitivity|swelling|infection|chipped/i.test(
          session.data.issueCategory
        )
      ) {
        return res.json({
          reply: t("Which side?", "أي جهة؟"),
          options: [t("Left", "اليسار"), t("Right", "اليمين"), t("Both", "كلا الجانبين")]
        });
      } else {
        session.data.issueDetail1 = "";
        session.step++;
        return res.json({
          reply: t("How long has this been happening?", "منذ متى تعاني من هذه الحالة؟")
        });
      }

    case 3:
      session.data.issueDetail1 = message;
      session.step++;
      return res.json({
        reply: t("How long has this been happening?", "منذ متى تعاني من هذه الحالة؟")
      });

    case 4:
      session.data.issueDetail2 = message;
      session.step++;
      return res.json({ reply: t("First name:", "الاسم الأول:") });

    case 5:
      session.data.firstName = message;
      session.step++;
      return res.json({ reply: t("Last name:", "اسم العائلة:") });

    case 6:
      session.data.lastName = message;
      session.step++;
      return res.json({ reply: t("Mobile number:", "رقم الهاتف:") });

    case 7:
      session.data.phone = message;
      session.step++;
      return res.json({ reply: t("Email address (optional):", "البريد الإلكتروني (اختياري):") });

    case 8:
      session.data.email = message.toLowerCase() === "no" ? "" : message;
      session.step++;
      return res.json({
        reply: t(
          "Would you like to provide more information about your issue?",
          "هل ترغب في تقديم مزيد من التفاصيل حول مشكلتك؟"
        ),
        options: [t("Yes", "نعم"), t("No", "لا")]
      });

    case 9:
      if (/yes|نعم/i.test(message)) {
        session.step++;
        return res.json({
          reply: t("Please provide more details:", "يرجى تقديم مزيد من التفاصيل:")
        });
      } else {
        session.data.moreInfo = "";
        session.step = 11;
      }

      if (!/yes|نعم/i.test(message)) {
        await db.run(
          `INSERT INTO patients 
          (firstName,lastName,phone,email,issueCategory,issueDetail1,issueDetail2)
          VALUES (?,?,?,?,?,?,?)`,
          [
            session.data.firstName,
            session.data.lastName,
            session.data.phone,
            session.data.email || "",
            session.data.issueCategory,
            session.data.issueDetail1 || "",
            session.data.issueDetail2 || ""
          ]
        );

        return res.json({
          reply: t(
            `Thank you ${session.data.firstName}, our dental team will contact you shortly.`,
            `شكرًا ${session.data.firstName}، سيتواصل معك فريقنا قريبًا.`
          )
        });
      }
      break;

    case 10:
      session.data.moreInfo = message;
      session.step++;
      await db.run(
        `INSERT INTO patients 
        (firstName,lastName,phone,email,issueCategory,issueDetail1,issueDetail2)
        VALUES (?,?,?,?,?,?,?)`,
        [
          session.data.firstName,
          session.data.lastName,
          session.data.phone,
          session.data.email || "",
          session.data.issueCategory,
          session.data.issueDetail1 || "",
          session.data.issueDetail2 || ""
        ]
      );

      return res.json({
        reply: t(
          `Thank you ${session.data.firstName}, our dental team will contact you shortly.`,
          `شكرًا ${session.data.firstName}، سيتواصل معك فريقنا قريبًا.`
        )
      });

    default:
      return res.json({
        reply: t("Please refresh to start again.", "يرجى التحديث للبدء من جديد.")
      });
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
