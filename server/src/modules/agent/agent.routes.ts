import { Router } from "express";
import { chatWithAgent, getChatHistory } from "./agent.controller";

const router = Router();

router.post("/chat", chatWithAgent);
router.get("/chat/:sessionId", getChatHistory);
export default router;
