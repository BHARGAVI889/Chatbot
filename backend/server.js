/**
 * LBRCE Chatbot Backend
 * Node.js + Express
 *
 * Flow:
 * 1. Receive user message
 * 2. Try to match against FAQ knowledge base (fast, free, reliable)
 * 3. If no good match, fall back to an LLM API for a general answer
 * 4. Log conversation (optional, for improving FAQs later)
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors()); // restrict to your domain in production, see below
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ---- Load knowledge base ----
const KB_PATH = path.join(__dirname, "knowledge_base.json");
const knowledgeBase = JSON.parse(fs.readFileSync(KB_PATH, "utf-8"));

// ---- Load timetable data (real links scraped from lbrce.ac.in department pages) ----
const TT_PATH = path.join(__dirname, "timetables.json");
const timetableData = JSON.parse(fs.readFileSync(TT_PATH, "utf-8"));

// ---- Simple keyword-based FAQ matcher ----
function findFaqMatch(userMessage) {
  const msg = userMessage.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const item of knowledgeBase) {
    let score = 0;
    for (const keyword of item.keywords) {
      if (msg.includes(keyword.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  // require at least one keyword hit to count as a match
  return bestScore > 0 ? bestMatch : null;
}

// ---- Detect requests for personal/dynamic student data ----
// These are things that live behind ERP login (per-student results, timetables,
// individual records) and are NOT public static content — a public chatbot
// should never claim to have this, and definitely shouldn't invent it.
const PERSONAL_DATA_PATTERNS = [
  "my result", "my marks", "my grade", "my cgpa", "my attendance",
  "student details", "particular student", "specific student", "individual student",
  "roll number", "hall ticket", "my timetable", "my time table",
];

function isPersonalDataRequest(userMessage) {
  const msg = userMessage.toLowerCase();
  return PERSONAL_DATA_PATTERNS.some((p) => msg.includes(p));
}

const MAIN_TOPICS = [
  "Admissions", "Courses offered", "Fee structure", "Placements",
  "Faculty", "Hostel", "Scholarships", "Contact info",
];

// ---- Timetable request parsing ----
// Detects department + semester (+ optional section) from natural phrasing like
// "R23 regulation CSE 5th sem timetable" or "ECE 3rd semester timetable" and
// returns real download links where we have them, or the department's full
// timetable page otherwise.
const DEPARTMENT_ALIASES = {
  cse: "cse", "computer science": "cse",
  ece: "ece", electronics: "ece",
  eee: "eee", electrical: "eee",
  mech: "mech", mechanical: "mech",
  civil: "civil",
  it: "it", "information technology": "it",
  "ai&ds": "aids", "ai & ds": "aids", "ai and ds": "aids", "artificial intelligence": "aids", aids: "aids",
  csm: "csm", "ai&ml": "csm", "ai & ml": "csm",
  ase: "ase", aerospace: "ase",
  mba: "mba",
};

const SEMESTER_WORDS = {
  "1st": 1, first: 1, "i sem": 1, "i semester": 1,
  "2nd": 2, second: 2, "ii sem": 2, "ii semester": 2,
  "3rd": 3, third: 3, "iii sem": 3, "iii semester": 3,
  "4th": 4, fourth: 4, "iv sem": 4, "iv semester": 4,
  "5th": 5, fifth: 5, "v sem": 5, "v semester": 5,
  "6th": 6, sixth: 6, "vi sem": 6, "vi semester": 6,
  "7th": 7, seventh: 7, "vii sem": 7, "vii semester": 7,
  "8th": 8, eighth: 8, "viii sem": 8, "viii semester": 8,
};

function detectTimetableRequest(userMessage) {
  const msg = userMessage.toLowerCase();
  if (!msg.includes("timetable") && !msg.includes("time table")) return null;

  let department = null;
  for (const [alias, code] of Object.entries(DEPARTMENT_ALIASES)) {
    if (msg.includes(alias)) {
      department = code;
      break;
    }
  }

  let semester = null;
  for (const [word, num] of Object.entries(SEMESTER_WORDS)) {
    if (msg.includes(word)) {
      semester = num;
      break;
    }
  }
  // also catch bare "sem 5" / "semester 5" / "5 sem"
  const numMatch = msg.match(/sem(?:ester)?\s*-?\s*(\d)|(\d)\s*(?:st|nd|rd|th)?\s*sem/);
  if (!semester && numMatch) {
    semester = parseInt(numMatch[1] || numMatch[2], 10);
  }

  let section = null;
  const sectionMatch = msg.match(/\bsection\s*([a-h])\b|\b([a-h])\s*section\b|\b([a-h])\s*sec\b/);
  if (sectionMatch) {
    section = (sectionMatch[1] || sectionMatch[2] || sectionMatch[3]).toUpperCase();
  }

  return { department, semester, section };
}

function buildTimetableResponse(request) {
  const { department, semester, section } = request;

  if (!department) {
    return {
      reply: "Which department is this for? Timetables are published separately per department on lbrce.ac.in.",
      links: Object.entries(timetableData.departmentPages).map(([code, url]) => ({
        label: code.toUpperCase() + " Timetables",
        url,
      })),
    };
  }

  if (department === "cse" && semester && timetableData.cse_2026_27_odd[semester]) {
    const sections = timetableData.cse_2026_27_odd[semester];
    if (section && sections[section]) {
      return {
        reply: `Here's the CSE Semester ${semester} Section ${section} timetable for A.Y. 2026-27:`,
        links: [{ label: `CSE Sem ${semester} - Sec ${section} (2026-27)`, url: sections[section] }],
      };
    }
    return {
      reply: `Here are the CSE Semester ${semester} timetables for A.Y. 2026-27 (odd semester), by section:`,
      links: Object.entries(sections).map(([sec, url]) => ({
        label: `Section ${sec}`,
        url,
      })),
    };
  }

  // Fallback: link to that department's full timetable page (covers all years/sems/sections)
  const pageUrl = timetableData.departmentPages[department];
  return {
    reply: `Timetables for ${department.toUpperCase()} are published on the department's Timetables page, organized by academic year, semester, and section:`,
    links: pageUrl ? [{ label: `${department.toUpperCase()} Timetables page`, url: pageUrl }] : [],
  };
}

// ---- Optional: LLM fallback (using Anthropic API as an example) ----
async function askLLM(userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful redirect instead of a dead-end "I don't know" message.
    return {
      reply:
        "That's a bit outside what I can pull up directly here — but I can help with admissions, courses, fees, placements, faculty, hostel, scholarships, and campus facilities. What would you like to know about?",
      quick_replies: MAIN_TOPICS,
    };
  }

  const collegeContext = `
You are the official chatbot for Lakireddy Bali Reddy College of Engineering (LBRCE), Mylavaram, Andhra Pradesh.
Answer briefly and only about the college (admissions, courses, facilities, placements, fees, contact info).
If you don't know something specific, suggest checking the relevant section of lbrce.ac.in or contacting the college office, phrased helpfully rather than as a flat refusal.
Never invent specific facts, names, or numbers you are not given.
`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: collegeContext,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text;
    return { reply: text || "Let me point you to the right section instead — what topic are you after?", quick_replies: MAIN_TOPICS };
  } catch (err) {
    console.error("LLM API error:", err);
    return { reply: "I'm having trouble reaching my full answer engine right now — here are some topics I can help with directly:", quick_replies: MAIN_TOPICS };
  }
}

// ---- In-memory conversation log (swap for a DB in production) ----
const conversationLog = [];

// ---- Main chat endpoint ----
app.post("/api/chat", async (req, res) => {
  const { message, session_id } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  let reply;
  let quick_replies = [];
  let links = [];

  const timetableRequest = detectTimetableRequest(message);

  if (timetableRequest) {
    const result = buildTimetableResponse(timetableRequest);
    reply = result.reply;
    links = result.links || [];
    quick_replies = ["Courses offered", "Contact info"];
  } else if (isPersonalDataRequest(message)) {
    // Individual student data (results, attendance, personal marks) lives
    // behind ERP login, not on the public site — and shouldn't be exposed to
    // anonymous visitors through a public chatbot even if it were available.
    reply =
      "For your individual results, attendance, or personal records, please log in to the LBRCE ERP portal at erp.lbrce.ac.in, or check with your department office. I can help with general college info and published timetables though!";
    quick_replies = MAIN_TOPICS;
  } else {
    const faqMatch = findFaqMatch(message);
    if (faqMatch) {
      reply = faqMatch.answer;
      quick_replies = faqMatch.related || [];
    } else {
      const fallback = await askLLM(message);
      reply = fallback.reply;
      quick_replies = fallback.quick_replies;
    }
  }

  conversationLog.push({
    session_id,
    message,
    reply,
    timestamp: new Date().toISOString(),
  });

  res.json({ reply, quick_replies, links });
});

// ---- Health check ----
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ---- Admin endpoint to view logs (protect this in production!) ----
app.get("/api/logs", (req, res) => {
  res.json(conversationLog.slice(-100));
});

app.listen(PORT, () => {
  console.log(`LBRCE chatbot backend running on port ${PORT}`);
});
