
import mongoose from "mongoose";
import { logger } from "./lib/logger";

let connected = false;

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;

  if (!uri) return false;

  try {
    await mongoose.connect(uri);

    console.log(
      "[DEBUG MongoDB] Connected database:",
      mongoose.connection.name
    );

    connected = true;
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection failed");
  }

  return connected;
}

export const isMongoConnected = () =>
  connected && mongoose.connection.readyState === 1;
