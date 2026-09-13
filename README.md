# LBRCE College Chatbot

A chatbot widget for lbrce.ac.in that answers FAQs about admissions, courses, fees, placements, and more, with an optional AI fallback for open-ended questions.

## Structure

```
lbrce-chatbot/
├── frontend/
│   └── chatbot-widget.html   # Drop-in widget: HTML + CSS + JS
├── backend/
│   ├── server.js             # Express API server
│   ├── knowledge_base.json   # FAQ data (edit this to add more answers)
│   └── package.json
```

## How it works

1. User types a question in the chat widget.
2. Frontend sends `POST /api/chat` with `{ message, session_id }`.
3. Backend checks `knowledge_base.json` for a keyword match.
4. If a match is found, it replies instantly with the stored answer + related quick-reply buttons.
5. If no match, it optionally calls an LLM API (Claude, in the example) for a general answer, telling the user to contact the office if unsure.

## Running locally

```bash
cd backend
npm install
npm start
```

The server runs on `http://localhost:5000` by default.

To enable the AI fallback, set an environment variable before starting:

```bash
export ANTHROPIC_API_KEY=your_key_here
npm start
```

(Without this, the bot still works fine for FAQ-matched questions — it just gives a "contact the office" message for anything outside the knowledge base.)

## Adding the widget to lbrce.ac.in

1. Open `frontend/chatbot-widget.html`.
2. Update the `API_URL` constant near the top of the `<script>` to point to your deployed backend, e.g. `https://chatbot-api.lbrce.ac.in/api/chat`.
3. Copy the entire contents of that file and paste it just before the closing `</body>` tag on every page you want the widget to appear on — or better, save it as `chatbot-widget.js`/`.html` and include it via your CMS's site-wide footer/include so you only maintain it in one place.

## Expanding the knowledge base

Edit `backend/knowledge_base.json`. Each entry looks like:

```json
{
  "keywords": ["hostel", "accommodation"],
  "answer": "Your answer text here.",
  "related": ["Optional quick reply 1", "Optional quick reply 2"]
}
```

Add as many keyword variants as you expect students to type (e.g. typos, short forms) — matching is simple keyword scoring, not fuzzy.

## Deployment options

- **Backend**: Render, Railway, or Vercel (serverless functions) all have free tiers suitable for a college chatbot. If LBRCE's website is on shared hosting, you may need a separate small VPS or a platform like Render since the college host likely doesn't run Node.js.
- **Frontend**: no separate deployment needed — it's just embedded into the existing website's HTML.
- **CORS**: In `server.js`, restrict CORS to the actual domain in production:
  ```js
  app.use(cors({ origin: "https://lbrce.ac.in" }));
  ```

## Suggested improvements later

- Move the knowledge base into a small database (MongoDB/PostgreSQL) so non-technical staff can update answers via an admin panel.
- Add analytics on unanswered questions (the `conversationLog`) to see what students actually ask and expand the FAQ accordingly.
- Add multilingual support (Telugu) since many students may prefer it.
- Rate-limit the `/api/chat` endpoint to avoid abuse if you enable the paid LLM fallback.
