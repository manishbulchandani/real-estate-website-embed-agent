import express from "express";
import { createServer } from "http";
import { spawn, type ChildProcess } from "node:child_process";
import dotenv from "dotenv";
import morgan from "morgan";
import cors from "cors";
import path from "path";
import fs from "node:fs";
import { env } from "./config/env.config";
import connectDB from "./config/db.config";
import v1Routes from "./routes/v1/index";
import errorHandlerMiddleware from "./middlewares/errorHandler";
import notFoundMiddleware from "./middlewares/notFound";
import cookieParser from "cookie-parser";

dotenv.config();

connectDB();

const app = express();

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

const corsOptions = {
  origin: env.FRONTEND_URL,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-VERIFY", "x-verify"],
};

app.use(cors(corsOptions));

app.use(cookieParser());

// Apply express.json() to all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



app.use("/api/v1", v1Routes);


if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") {
  const buildPath = path.join(__dirname, "..", "..", "client", "dist");
  app.use(express.static(buildPath));

  app.get(/.*/, (req, res) => {
    res.sendFile(path.resolve(buildPath, "index.html"));
  });
}


app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

const args = process.argv.slice(2);
const portArgIndex = args.indexOf("--port");
const PORT = portArgIndex !== -1 ? Number(args[portArgIndex + 1]) : env.PORT;

const server = createServer(app);

let voiceWorkerProcess: ChildProcess | null = null;

const shouldStartVoiceWorker = process.env.START_VOICE_WORKER !== "false";

const startVoiceWorker = () => {
  if (!shouldStartVoiceWorker || voiceWorkerProcess) {
    return;
  }

  const isCompiled = __filename.endsWith('.js');
  const runtimeFile = isCompiled
    ? path.resolve(__dirname, "modules/voice/voice.worker.runtime.js")
    : path.resolve(__dirname, "modules/voice/voice.worker.runtime.ts");

  const tsxBinary = path.resolve(__dirname, "..", "node_modules/.bin/tsx");
  const isRuntimeAvailable = fs.existsSync(runtimeFile);

  if (!isRuntimeAvailable) {
    console.warn(`[Voice Worker] Runtime file not found: ${runtimeFile}`);
    return;
  }

  const command = isCompiled ? "node" : tsxBinary;
  const args = [runtimeFile, "dev"];

  console.log(`[Voice Worker] Starting worker with ${command} ${args.join(" ")}`);

  voiceWorkerProcess = spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      LIVEKIT_AGENT_NAME: env.LIVEKIT_AGENT_NAME,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-placeholder-livekit-gateway",
    },
  });

  voiceWorkerProcess.on("exit", (code, signal) => {
    console.log(`[Voice Worker] Exited with code=${code} signal=${signal}`);
    voiceWorkerProcess = null;
  });
};

server.listen(PORT, () => {
  console.log(`Server running in ${env.NODE_ENV} mode on port ${PORT}`);
  startVoiceWorker();
});

const stopVoiceWorker = async () => {
  if (!voiceWorkerProcess || voiceWorkerProcess.killed) {
    return;
  }

  voiceWorkerProcess.kill("SIGTERM");
  voiceWorkerProcess = null;
};

process.on("SIGINT", async () => {
  await stopVoiceWorker();
});

process.on("SIGTERM", async () => {
  await stopVoiceWorker();
});
