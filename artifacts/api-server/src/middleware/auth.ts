import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthRequest = Request & { userId?: string };
export function signUser(id: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({ sub: id }, secret, { expiresIn: "7d" });
}
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.cloudnest_token ?? req.headers.authorization?.replace("Bearer ", "");
  const secret = process.env.JWT_SECRET;
  if (!token || !secret) return res.status(401).json({ error: "Authentication required" });
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    req.userId = String(decoded.sub);
    return next();
  } catch {
    return res.status(401).json({ error: "Token expired or invalid" });
  }
}