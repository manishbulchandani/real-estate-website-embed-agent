import { Router } from "express";
import { chatWithAgent, getChatHistory, togglePropertyPreference, getPreferences } from "./agent.controller";

const router = Router();

router.post("/chat", chatWithAgent);
router.get("/chat/:sessionId", getChatHistory);

router.post("/chat/:sessionId/preferences", togglePropertyPreference);
router.get("/chat/:sessionId/preferences", getPreferences);

export default router;
