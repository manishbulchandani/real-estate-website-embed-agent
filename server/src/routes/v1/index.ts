import { Router } from "express";
import agentRoutes from "../../modules/agent/agent.routes";
import voiceRoutes from "../../modules/voice/voice.routes";

const router = Router();

router.use("/agent", agentRoutes);
router.use("/voice", voiceRoutes);

export default router;
