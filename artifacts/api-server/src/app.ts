import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: process.env.FRONTEND_URL ?? true, credentials: true }));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// The Dropbox app for this project ("CloudNest-MultiCloud-Krushnarth") was already registered
// with the redirect URI http://localhost:5000/auth/dropbox/callback (outside the /api prefix
// every other route uses). Rather than asking for that to be reconfigured in the Dropbox
// console, this alias forwards it straight into the real handler at
// /api/providers/dropbox/callback, query string and all.
app.get("/auth/dropbox/callback", (req, res) => {
  const qs = req.originalUrl.split("?")[1];
  res.redirect(`/api/providers/dropbox/callback${qs ? `?${qs}` : ""}`);
});

export default app;
