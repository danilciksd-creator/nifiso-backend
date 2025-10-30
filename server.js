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

  // 1) Create table if not exists
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

  // 2) Add optional columns if they don't exist (safe)
  await db.exec(`ALTER TABLE patients ADD COLUMN notes TEXT`).catch(() => {});
  await db.exec(`ALTER TABLE patients ADD COLUMN leadScore INTEGER`).catch(() => {});
  await db.exec(`ALTER TABLE patients ADD COLUMN subcategory TEXT`).catch(() => {});
}


const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Nifiso backend with DB + AI is running");
});

const sessions = {};
app.post("/api/chat", async (req, res) => {
  const { message, sessionId, lang = "en" } = req.body;
  if (!sessionId) return res.json({ reply: "Missing session ID" });

  const t = (en, ar) => (lang === "ar" ? ar : en);

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      step: 1,
      branch: null, // pain | broken | swelling | aesthetic | routine
      data: {}
    };
  }
  const s = sessions[sessionId];

  // helper: pain-like?
  const isPainLike = (txt) => {
    const en = /(pain|sensitivity|swelling|infection|chipped)/i.test(txt);
    const ar = /(ألم|حساسية|تورم|التهاب|مكسور|متشقق)/.test(txt);
    return en || ar;
  };

  // compute a simple lead score for triage
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
    // STEP 1: choose issue category (first real question)
    case 1: {
      s.step = 2;
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
    }

    // STEP 2: branch based on category
    case 2: {
      s.data.issueCategory = message;

      // set branch
      if (/pain|sensitivity|ألم|حساسية/i.test(message)) s.branch = "pain";
      else if (/broken|chipped|مكسور|متشقق/i.test(message)) s.branch = "broken";
      else if (/swelling|infection|تورم|التهاب/i.test(message)) s.branch = "swelling";
      else if (/aesthetic|تجميلي/i.test(message)) s.branch = "aesthetic";
      else s.branch = "routine";

      // next question depends on branch
      s.step = 3;

      if (s.branch === "pain") {
        return res.json({
          reply: t("Which side is affected?", "أي جهة متأثرة؟"),
          options: [t("Left", "اليسار"), t("Right", "اليمين"), t("Both", "كلا الجانبين"), t("Not sure", "غير متأكد")]
        });
      }

      if (s.branch === "broken") {
        return res.json({
          reply: t("Is it a front or back tooth?", "هل هو سن أمامي أم خلفي؟"),
          options: [t("Front tooth", "سن أمامي"), t("Back tooth", "سن خلفي"), t("Not sure", "غير متأكد")]
        });
      }

      if (s.branch === "swelling") {
        return res.json({
          reply: t("Do you have fever?", "هل لديك حمى؟"),
          options: [t("Yes", "نعم"), t("No", "لا")]
        });
      }

      if (s.branch === "aesthetic") {
        s.step = 3;
        return res.json({
          reply: t("What type of aesthetic treatment are you interested in?", "ما نوع العلاج التجميلي الذي تريده؟"),
          options: [
            t("Whitening", "تبييض الأسنان"),
            t("Veneers", "ابتسامة هوليوود/الفينير"),
            t("Invisalign / Braces", "تقويم شفاف / تقويم"),
            t("Implants", "زراعة الأسنان"),
            t("Crowns / Bridges", "تيجان / جسور")
          ]
        });
      }

      // routine
      return res.json({
        reply: t("When was your last dental visit?", "متى كانت آخر زيارة لطبيب الأسنان؟"),
        options: [t("< 6 months", "أقل من 6 أشهر"), t("6–12 months", "من 6 إلى 12 شهرًا"), t("> 12 months", "أكثر من 12 شهرًا"), t("Never", "أبدًا")]
      });
    }

    // STEP 3: follow-ups per branch
    case 3: {
      if (s.branch === "pain") {
        s.data.side = message;
        s.step = 4;
        return res.json({
          reply: t("Upper or lower?", "فك علوي أم سفلي؟"),
          options: [t("Upper", "علوي"), t("Lower", "سفلي"), t("Both", "كلاهما"), t("Not sure", "غير متأكد")]
        });
      }

      if (s.branch === "broken") {
        s.data.toothPosition = message; // front/back/not sure
        s.step = 4;
        return res.json({
          reply: t("How big is the chip?", "ما حجم الكسر؟"),
          options: [t("Small", "صغير"), t("Medium", "متوسط"), t("Large", "كبير")]
        });
      }

      if (s.branch === "swelling") {
        s.data.fever = message; // Yes/No
        s.step = 4;
        return res.json({
          reply: t("Since when did this start?", "منذ متى بدأ ذلك؟")
        });
      }

      if (s.branch === "aesthetic") {
        s.data.subcategory = message;
        s.step = 4;

        // ask specific follow-up by subcategory
        const sub = s.data.subcategory;
        if (/Whitening|تبييض/.test(sub)) {
          return res.json({
            reply: t("When was your last cleaning?", "متى كان آخر تنظيف أسنان؟"),
            options: [t("< 6 months", "أقل من 6 أشهر"), t("6–12 months", "من 6 إلى 12 شهرًا"), t("> 12 months", "أكثر من 12 شهرًا")]
          });
        }
        if (/Veneers|الفينير|هوليوود/i.test(sub)) {
          return res.json({
            reply: t("How many teeth are you considering?", "كم عدد الأسنان المطلوبة؟"),
            options: [t("1–2", "1–2"), t("3–6", "3–6"), t("Full smile", "ابتسامة كاملة")]
          });
        }
        if (/Invisalign|Braces|تقويم/i.test(sub)) {
          return res.json({
            reply: t("Crowding level?", "ما درجة تزاحم الأسنان؟"),
            options: [t("Mild", "خفيف"), t("Moderate", "متوسط"), t("Severe", "شديد")]
          });
        }
        if (/Implants|زراعة/.test(sub)) {
          return res.json({
            reply: t("How many missing teeth?", "كم عدد الأسنان المفقودة؟"),
            options: [t("1", "1"), t("2–3", "2–3"), t("4+", "4+")]
          });
        }
        if (/Crowns|Bridges|تيجان|جسور/.test(sub)) {
          return res.json({
            reply: t("Is anything urgent (broken crown, pain)?", "هل هناك أمر عاجل (تاج مكسور، ألم)؟"),
            options: [t("Yes", "نعم"), t("No", "لا")]
          });
        }

        // default if no match
        return res.json({
          reply: t("When would you like to start?", "متى تريد البدء؟"),
          options: [t("ASAP", "في أقرب وقت"), t("This week", "هذا الأسبوع"), t("This month", "هذا الشهر")]
        });
      }

      if (s.branch === "routine") {
        s.data.lastVisit = message;
        s.step = 4;
        return res.json({
          reply: t("Preferred time?", "الوقت المفضل؟"),
          options: [t("Morning", "الصباح"), t("Afternoon", "بعد الظهر"), t("Evening", "المساء")]
        });
      }

      // fallback
      s.step = 4;
      return res.json({ reply: t("How long has this been happening?", "منذ متى تعاني من هذه الحالة؟") });
    }

    // STEP 4: more branch follow-ups → then patient identity
    case 4: {
      if (s.branch === "pain") {
        s.data.arch = message; // upper/lower/both/unsure
        s.step = 5;
        return res.json({
          reply: t("On a scale of 1–10, how strong is the pain?", "من 1 إلى 10، ما شدة الألم؟"),
          options: ["1","2","3","4","5","6","7","8","9","10"]
        });
      }

      if (s.branch === "broken") {
        s.data.chipSize = message;
        s.step = 5;
        return res.json({
          reply: t("Any pain?", "هل يوجد ألم؟"),
          options: [t("Yes", "نعم"), t("No", "لا")]
        });
      }

      if (s.branch === "swelling") {
        s.data.duration = message;
        s.step = 5;
        return res.json({
          reply: t("Which area (left/right/upper/lower)?", "أي منطقة (يسار/يمين/فك علوي/فك سفلي)؟")
        });
      }

      if (s.branch === "aesthetic") {
        // capture previous sub-answers
        s.data.aestheticAnswer = message;
        s.step = 5;
        return res.json({
          reply: t("When would you like to start?", "متى تريد البدء؟"),
          options: [t("ASAP", "في أقرب وقت"), t("This week", "هذا الأسبوع"), t("This month", "هذا الشهر")]
        });
      }

      if (s.branch === "routine") {
        s.data.preferredTime = message;
        s.step = 5;
        return res.json({ reply: t("First name:", "الاسم الأول:") });
      }

      // default
      s.data.duration = message;
      s.step = 5;
      return res.json({ reply: t("First name:", "الاسم الأول:") });
    }

    // STEP 5 → identity and wrap-up common path
    case 5: {
      if (s.branch === "pain") {
        s.data.painScale = message;
        s.step = 6;
        return res.json({ reply: t("First name:", "الاسم الأول:") });
      }

      if (s.branch === "broken") {
        s.data.hasPain = message;
        s.step = 6;
        return res.json({ reply: t("First name:", "الاسم الأول:") });
      }

      if (s.branch === "swelling") {
        s.data.area = message; // left/right/upper/lower
        s.step = 6;
        return res.json({ reply: t("First name:", "الاسم الأول:") });
      }

      if (s.branch === "aesthetic") {
        s.data.timeframe = message;
        s.step = 6;
        return res.json({ reply: t("First name:", "الاسم الأول:") });
      }

      // routine already asked first name at step 5, so message is firstName here
      s.data.firstName = message;
      s.step = 7;
      return res.json({ reply: t("Last name:", "اسم العائلة:") });
    }

    case 6: {
      s.data.firstName = message;
      s.step = 7;
      return res.json({ reply: t("Last name:", "اسم العائلة:") });
    }

    case 7: {
      s.data.lastName = message;
      s.step = 8;
      return res.json({ reply: t("Mobile number:", "رقم الهاتف:") });
    }

    case 8: {
      s.data.phone = message;
      s.step = 9;
      return res.json({
        reply: t("Would you like to add more information?", "هل ترغب في إضافة مزيد من المعلومات؟"),
        options: [t("Yes", "نعم"), t("No", "لا")]
      });
    }

    case 9: {
      if (/yes|نعم/i.test(message)) {
        s.step = 10;
        return res.json({ reply: t("Please provide any additional details:", "يرجى تقديم أي تفاصيل إضافية:") });
      } else {
        s.data.moreInfo = "";
        s.step = 11;
      }
      // fall-through to saving
    }

    case 10: {
      if (s.step === 10) {
        s.data.moreInfo = message;
        s.step = 11;
      }
      // SAVE
      const notesObj = {
        branch: s.branch,
        side: s.data.side,
        arch: s.data.arch,
        painScale: s.data.painScale,
        duration: s.data.duration,
        fever: s.data.fever,
        area: s.data.area,
        toothPosition: s.data.toothPosition,
        chipSize: s.data.chipSize,
        subcategory: s.data.subcategory,
        aestheticAnswer: s.data.aestheticAnswer,
        timeframe: s.data.timeframe,
        lastVisit: s.data.lastVisit,
        preferredTime: s.data.preferredTime,
        moreInfo: s.data.moreInfo
      };
      const notes = JSON.stringify(notesObj);
      const leadScore = scoreLead({ ...s.data, branch: s.branch });

      await db.run(
        `INSERT INTO patients 
         (firstName,lastName,phone,dob,email,insuranceProvider,location,
          issueCategory,issueDetail1,issueDetail2,notes,leadScore, subcategory)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          s.data.firstName || "",
          s.data.lastName || "",
          s.data.phone || "",
          s.data.dob || "",
          "", // email not used
          s.data.insuranceProvider || "",
          s.data.location || "",
          s.data.issueCategory || "",
          s.data.side || s.data.toothPosition || s.data.subcategory || "",
          s.data.duration || s.data.painScale || s.data.preferredTime || "",
          notes,
          leadScore,
          s.data.subcategory || ""
        ]
      );

      // Done
      return res.json({
        reply: t(
          `Thank you ${s.data.firstName}, our dental team will contact you shortly.`,
          `شكرًا ${s.data.firstName}، سيتواصل معك فريقنا قريبًا.`
        )
      });
    }

    default:
      return res.json({ reply: t("Please refresh to start again.", "يرجى التحديث للبدء من جديد.") });
  }
});




const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => console.log(`Live with DB + AI on ${PORT}`));
});
