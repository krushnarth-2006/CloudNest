import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cloudnestRouter from "./cloudnest";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cloudnestRouter);
router.use(authRouter);

export default router;
