// @ts-check
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

/**
 * Passphrase encryption for study exports.
 *
 * The study runs once and cannot be repeated, so its data is backed up off the
 * hosted database (risk register R6). Those backups sit on a laptop, which is
 * exactly where participant data should not sit in the clear.
 *
 * AES-256-GCM, so a damaged or altered file fails to decrypt rather than
 * decrypting to something subtly wrong. The key is derived from a passphrase with
 * scrypt, at a cost that makes guessing it slow: an export is decrypted a handful
 * of times, so a second per decryption costs nothing.
 *
 * File layout:  "CSX1" | salt (16) | iv (12) | tag (16) | ciphertext
 */

const scrypt = /** @type {(pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>} */ (
  promisify(scryptCb)
);
const MAGIC = Buffer.from("CSX1");
const KDF = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const MIN_PASSPHRASE = 12;

/** @param {string} passphrase @param {Buffer} salt */
async function keyFor(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
  return scrypt(passphrase, salt, 32, KDF);
}

/**
 * @param {Buffer} plaintext
 * @param {string} passphrase
 * @returns {Promise<Buffer>}
 */
export async function encrypt(plaintext, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await keyFor(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/**
 * @param {Buffer} file
 * @param {string} passphrase
 * @returns {Promise<Buffer>}
 */
export async function decrypt(file, passphrase) {
  if (file.length < 48 || !file.subarray(0, 4).equals(MAGIC)) {
    throw new Error("This is not a CyberShield export.");
  }
  const salt = file.subarray(4, 20);
  const iv = file.subarray(20, 32);
  const tag = file.subarray(32, 48);
  const decipher = createDecipheriv("aes-256-gcm", await keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(48)), decipher.final()]);
  } catch {
    // GCM cannot tell a wrong passphrase from a damaged file, so say both.
    throw new Error("Could not decrypt: wrong passphrase, or the file has been altered or damaged.");
  }
}

/**
 * The passphrase, from STUDY_EXPORT_PASSPHRASE or typed at a hidden prompt.
 *
 * The environment variable is for a scheduled backup. Typed is better when a
 * person is at the keyboard, since it then lives nowhere on disk.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function askPassphrase(question = "Export passphrase: ") {
  if (process.env.STUDY_EXPORT_PASSPHRASE) return process.env.STUDY_EXPORT_PASSPHRASE;
  if (!process.stdin.isTTY) {
    throw new Error("Set STUDY_EXPORT_PASSPHRASE, or run this in a terminal to be asked for it.");
  }
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let typed = "";
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    /** @param {string} chunk */
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(typed);
        }
        if (ch === "\u0003") { // Ctrl+C
          stdin.setRawMode(false);
          process.stdout.write("\n");
          return reject(new Error("Cancelled."));
        }
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    stdin.on("data", onData);
  });
}
