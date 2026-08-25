import mongoose from "mongoose";

/**
 * Cached connection.
 *
 * Every serverless invocation runs in a container that may or may not be reused.
 * Calling mongoose.connect() per request opens a new pool each time and exhausts
 * the Atlas connection limit within minutes of any real traffic -- which, on the
 * free tier used for the study, means the platform falls over mid-session.
 *
 * The promise is cached on globalThis rather than in module scope because module
 * instances are not guaranteed to be shared between invocations, but the global is.
 */
const CACHE_KEY = Symbol.for("cybershield.mongoose");

function cache() {
  if (!globalThis[CACHE_KEY]) {
    globalThis[CACHE_KEY] = { conn: null, promise: null };
  }
  return globalThis[CACHE_KEY];
}

export async function connect(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error("MONGODB_URI is not set");

  const c = cache();
  if (c.conn) return c.conn;

  if (!c.promise) {
    c.promise = mongoose.connect(uri, {
      // Fail fast rather than hanging a serverless invocation until it times out.
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      bufferCommands: false
    });
  }

  try {
    c.conn = await c.promise;
  } catch (err) {
    // Clear the cached rejection, or every later request reuses the failure.
    c.promise = null;
    throw err;
  }
  return c.conn;
}

export async function disconnect() {
  const c = cache();
  if (c.conn) await mongoose.disconnect();
  c.conn = null;
  c.promise = null;
}
