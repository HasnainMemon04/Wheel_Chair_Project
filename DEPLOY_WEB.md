# Web App Vercel Deployment Guide

This guide provides the exact Git commands, Vercel project configurations, and environment variables needed to deploy the Next.js fleet console and rider panel.

---

## 1. Step-by-Step Git Commands (Private Repository)
Open your terminal at the project root (`D:\Wheel_Chair_Project`) and execute the following to push your code:

```bash
# 1. Initialize git (if not already done)
git init

# 2. Add all files (root .gitignore is configured to keep build junk out but preserve .env/headers)
git add .

# 3. Commit the code
git commit -m "feat: optimize live pipeline and real-time actuators"

# 4. Link your private GitHub repository (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_PRIVATE_REPO.git

# 5. Push to GitHub
git branch -M main
git push -u origin main
```

---

## 2. Vercel Project Configurations
When importing your repository on the [Vercel Dashboard](https://vercel.com/dashboard):

1.  **Select Repository**: Click **Import** next to your private repository.
2.  **Root Directory**: Set to `webapp` (This is critical since the Next.js app sits inside the subfolder).
3.  **Framework Preset**: Select `Next.js` (Vercel will auto-configure the build command `next build` and output directory `.next`).
4.  **Node.js Version**: Vercel General settings defaults to Node `20.x` or `18.x` which is fully compatible.

---

## 3. Environment Variables
Add the following key-value pairs in the **Environment Variables** section of the Vercel project setup:

| Variable Name | Exposure | Purpose / Description | Value |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Database Connection Endpoint | `https://txqjevrhedgsjltnflmg.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Public anonymous database key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODcyNDIsImV4cCI6MjA5ODQ2MzI0Mn0.y8vhajDI0f2p2dbDbdmN82WNs7x6jf9rbU_ojsGvP54` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Only | Privileged admin key (reconciles webhooks/RLS) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg4NzI0MiwiZXhwIjoyMDk4NDYzMjQyfQ.u8hh_MYE3tq2JgHLJTUWXKbea33Lwcy3y-Dax_MmWHc` |
| `PAYMENT_PROVIDER` | Server-Only | Gateway type selection | `mock` |
| `PAYMENT_WEBHOOK_SECRET` | Server-Only | Verification key for incoming mock payments | `super-secret-webhook-key-123` |

---

## 4. Payment Webhook Registration
Your payment webhook API route will be hosted at:
`https://<your-vercel-domain>.vercel.app/api/payments/webhook`

*   **Variables Required**: `/api/payments/webhook` utilizes `SUPABASE_SERVICE_ROLE_KEY` to insert mock transactions bypassing RLS restrictions, and checks against `PAYMENT_WEBHOOK_SECRET` to verify signatures.
*   Once Vercel generates your production domain, copy the final URL and configure it in your mock payments dispatch console or settings page.
