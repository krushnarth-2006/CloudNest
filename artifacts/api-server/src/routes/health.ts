import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isMongoConnected } from "../db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    database: isMongoConnected() ? "connected" : "disconnected",
    redis: process.env.REDIS_URL ? "configured" : "disconnected",
    aiService: process.env.AI_SERVICE_URL ? "configured" : "unavailable",
  });
});

export default router;
