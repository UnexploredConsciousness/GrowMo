# GrowMo

A conversational AI‑powered checkout demo.

## Overview
GrowMo lets a user chat with an AI agent to browse a catalog, select items, and pay via Razorpay.  The backend enforces several safety policies (price ceiling, night‑time block, category restrictions, daily‑spending limits) and supports email‑verification for user accounts.

## Quick Start (local development)
1. **Clone the repo**
   ```
   git clone https://github.com/UnexploredConsciousness/GrowMo.git
   cd GrowMo
   ```
2. **Create a `.env` file** (example contents below).  Use the credentials you generated in Atlas and Gmail.
   ```
   RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXXXXXX
   PORT=5000
   GEMINI_API_KEY=your_gemini_api_key
   GMAIL_USER=yourgmail@gmail.com
   GMAIL_APP_PASSWORD=your_app_password_without_spaces
   FRONTEND_URL=http://localhost:5173
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/growmo?appName=Cluster0
   JWT_SECRET=super_secret_change_me_now
   ```
3. **Install dependencies**
   ```
   npm install            # installs backend deps
   cd frontend && npm install && cd ..
   ```
4. **Run the servers** (two terminals are needed)
   - Backend:
     ```
     npm run dev
     ```
   - Frontend (Vite):
     ```
     cd frontend
     npm run dev
     ```
5. Open <http://localhost:5173> in a browser.  Register a new account, verify the emailed link, then start chatting with the bot.

## Environment variables
| Variable | Description |
|----------|-------------|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay test credentials for creating orders. |
| `GEMINI_API_KEY` | Google Gemini API key for the AI model. |
| `GMAIL_USER` | Gmail address used for sending verification emails. |
| `GMAIL_APP_PASSWORD` | Gmail **App Password** (no spaces). |
| `FRONTEND_URL` | Base URL of the Vite app (used in verification link). |
| `MONGODB_URI` | Atlas connection string (include database name `growmo`). |
| `JWT_SECRET` | Secret used to sign JWTs – must be set; no fallback. |
| `PORT` | Port the Express server listens on (default 5000). |

## Deployment
- **Render** – set the same env vars in the Render dashboard, enable the `MONGODB_URI` that points to your Atlas cluster, and deploy the `npm run dev` start command.
- **Vercel** – the frontend is a standard Vite app; the backend is a separate service on Render.

## Known Issues & Fixes
- **`app is not defined`** – fixed by adding `const app = express();` in `server.js`.
- **Email verification** – works only with a Gmail account that has an App Password configured.
- **Missing MongoDB** – ensure your Atlas cluster is reachable and the IP whitelist contains `0.0.0.0/0` (or Render’s IP).

## Contributing
Feel free to open PRs or issues.  All changes should run `npm test` (if tests exist) and pass the linting step before pushing.
