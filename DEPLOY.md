# Supabase Edge Functions Deployment Guide (Windows)

This document provides the exact commands and paths to deploy your optimized Edge Functions directly to your Supabase Cloud instance.

## 1. Canonical Project File Structure
The Edge Functions are organized in the standard Supabase structure:
*   **Ingest Function**: [supabase/functions/ingest/index.ts](file:///d:/Wheel_Chair_Project/supabase/functions/ingest/index.ts) (Contains the optimized HMAC-verified telemetry ingestion and command-piggyback logic).
*   **Commands Function**: [supabase/functions/commands/index.ts](file:///d:/Wheel_Chair_Project/supabase/functions/commands/index.ts) (Handles pending command polling and ACK endpoints).

---

## 2. Deployment Prerequisites
*   Ensure the [Supabase CLI](https://supabase.com/docs/guides/cli) is installed and you are logged in:
    ```powershell
    supabase login
    ```
*   You **do not need Docker installed** to deploy using the cloud compiler path.

---

## 3. Exact Deployment Commands
Run these commands from the **project root directory** (`D:\Wheel_Chair_Project`):

### Deploy the Ingestion / Piggyback Function
```powershell
supabase functions deploy ingest --no-verify-jwt --project-ref txqjevrhedgsjltnflmg
```

### Deploy the Commands Polling / Ack Function
```powershell
supabase functions deploy commands --no-verify-jwt --project-ref txqjevrhedgsjltnflmg
```

---

## 4. Verification Check
After deploying, the endpoints will be live at:
*   Telemetry Ingestion: `https://txqjevrhedgsjltnflmg.supabase.co/functions/v1/ingest`
*   Command Control: `https://txqjevrhedgsjltnflmg.supabase.co/functions/v1/commands`

Verify in the Supabase Dashboard under **Edge Functions** that both functions are successfully deployed with JWT verification disabled (`no-verify-jwt`).
