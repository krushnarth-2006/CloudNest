import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { User, ActivityLog } from "../models";
import { isMongoConnected } from "../db";
import { requireAuth, signUser, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });
router.post("/auth/register", authLimit, async (req, res) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected" });
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: "Name, email, and an 8-character password are required" });
  if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: "An account with that email already exists" });
  const user = await User.create({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12) });
  await ActivityLog.create({ userId: user._id, action: "Register", description: "Account created" });
  res.cookie("cloudnest_token", signUser(String(user._id)), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 86400000 });
  return res.status(201).json({ id: user._id, name: user.name, email: user.email });
});
router.post("/auth/login", authLimit, async (req, res) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected" });
  const { email, password } = req.body as { email?: string; password?: string };
  const user = email ? await User.findOne({ email: email.toLowerCase() }) : null;
  if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Invalid email or password" });
  await ActivityLog.create({ userId: user._id, action: "Login", description: "Signed in to CloudNest" });
  res.cookie("cloudnest_token", signUser(String(user._id)), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 86400000 });
  return res.json({ id: user._id, name: user.name, email: user.email });
});
router.post("/auth/logout", requireAuth, async (req: AuthRequest, res) => { await ActivityLog.create({ userId: req.userId, action: "Logout", description: "Signed out of CloudNest" }); res.clearCookie("cloudnest_token"); return res.status(204).send(); });
router.get("/auth/me", requireAuth, async (req: AuthRequest, res) => {
  const user = await User.findById(req.userId).select("_id name email createdAt");
  return user ? res.json(user) : res.status(404).json({ error: "User not found" });
});
router.patch("/auth/me", requireAuth, async (req: AuthRequest, res) => {
  const { name, email } = req.body as { name?: string; email?: string };
  const update: Record<string, string> = {};
  if (typeof name === "string" && name.trim()) update.name = name.trim();
  if (typeof email === "string" && email.trim()) {
    const normalized = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalized, _id: { $ne: req.userId } });
    if (existing) return res.status(409).json({ error: "That email is already in use" });
    update.email = normalized;
  }
  const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select("_id name email createdAt");
  if (!user) return res.status(404).json({ error: "User not found" });
  await ActivityLog.create({ userId: req.userId, action: "Profile updated", description: "Account details changed" });
  return res.json(user);
});
router.post("/auth/change-password", authLimit, requireAuth, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = await User.findById(req.userId);
  if (!user || !currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ error: "Current password is incorrect" });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  await ActivityLog.create({ userId: req.userId, action: "Password changed", description: "Account password was updated" });
  return res.status(204).send();
});
export default router;