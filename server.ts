import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Load config for database ID and project ID
  let firebaseConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (e) {
    console.warn("Could not load config for server initialization");
  }

  if (!getApps().length) {
    initializeApp({
      projectId: firebaseConfig.projectId
    });
  }
  
  // Try to use the databaseId from config if it exists
  let db: any;
  try {
    const appInstance = getApps()[0];
    // In some environments, passing the long database ID to getFirestore fails if IAM is restricted.
    // We try the provided ID first, then fallback to (default).
    db = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId || "(default)");
    console.log("Firestore initialized for project:", firebaseConfig.projectId, "with database:", firebaseConfig.firestoreDatabaseId || "(default)");
  } catch (err) {
    console.error("Failed to initialize Firestore with named database, trying (default):", err);
    db = getFirestore(getApps()[0], "(default)");
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  // Error reporter helper
  const reportError = async (error: any, context: string) => {
    console.error(`[${context}]`, error);
    try {
      if (db) {
        await db.collection('logs').add({
          level: 'error',
          context,
          message: error.message || String(error),
          stack: error.stack || null,
          timestamp: FieldValue.serverTimestamp(),
          adminNotified: false
        });
      }
    } catch (e) {
      console.error("Failed to log error to DB:", e);
    }
  };

  // API Routes
  app.post("/api/verify-task", async (req, res) => {
    const { userId, taskId } = req.body;
    if (!userId || !taskId) return res.status(400).json({ error: "Missing parameters" });

    try {
      if (taskId === 'join_channel') {
        const channelId = "@ebisa_emoji";
        const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${channelId}&user_id=${userId}`);
        const tgData = await tgRes.json();

        if (tgData.ok) {
          const status = tgData.result.status;
          const isMember = ['member', 'administrator', 'creator'].includes(status);

          if (isMember) {
            const userRef = db.collection('users').doc(userId.toString());
            
            await db.runTransaction(async (transaction: any) => {
              const userDoc = await transaction.get(userRef);
              if (!userDoc.exists) throw new Error("User not found");
              
              const userData = userDoc.data();
              if (userData?.completedTasks?.includes('join_channel')) {
                throw new Error("Task already completed");
              }

              transaction.update(userRef, {
                balance: FieldValue.increment(200),
                completedTasks: FieldValue.arrayUnion('join_channel'),
                updatedAt: FieldValue.serverTimestamp()
              });
            });

            return res.json({ success: true, reward: 200 });
          }
          return res.status(400).json({ error: "Please join the channel first!" });
        }
        throw new Error(tgData.description || "Telegram API Error");
      }
      res.status(400).json({ error: "Unknown task" });
    } catch (error: any) {
      if (error.message !== "Task already completed") {
        await reportError(error, "verify-task");
      }
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/sync-user", async (req, res) => {
    const { userId, username, startParam, firebaseUid } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    try {
      const userRef = db.collection('users').doc(userId.toString());
      
      await db.runTransaction(async (transaction: any) => {
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          const userData: any = {
            username: username || 'User',
            firebaseUid: firebaseUid || '',
            balance: 0,
            withdrawn: 0,
            adsWatched: 0,
            referralCount: 0,
            completedTasks: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          };

          if (startParam && startParam !== userId.toString()) {
            const referrerRef = db.collection('users').doc(startParam);
            const referrerDoc = await transaction.get(referrerRef);
            
            if (referrerDoc.exists) {
              transaction.update(referrerRef, {
                balance: FieldValue.increment(50),
                referralCount: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp()
              });
              userData.referredBy = startParam;
            }
          }
          transaction.set(userRef, userData);
        } else {
          const existingData = userDoc.data();
          const updates: any = { updatedAt: FieldValue.serverTimestamp() };
          let changed = false;
          if (username && existingData?.username !== username) {
            updates.username = username;
            changed = true;
          }
          if (firebaseUid && (!existingData?.firebaseUid || existingData.firebaseUid !== firebaseUid)) {
            updates.firebaseUid = firebaseUid;
            changed = true;
          }
          if (changed) {
            transaction.update(userRef, updates);
          }
        }
      });

      res.json({ success: true });
    } catch (error: any) {
      await reportError(error, "sync-user");
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
        if (req.path.startsWith('/api')) return;
        res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
