import crypto from "crypto";

// Store nonces with their creation timestamp
const seenNonces = new Map();
const MAX_TIMESTAMP_DELTA_MS = 5 * 60 * 1000; // 5 minutes

// Sweep expired nonces every minute
setInterval(() => {
  const now = Date.now();
  for (const [nonce, timestamp] of seenNonces.entries()) {
    if (now - timestamp > MAX_TIMESTAMP_DELTA_MS) {
      seenNonces.delete(nonce);
    }
  }
}, 60 * 1000);

const verifyApiHandshake = (req, res, next) => {
  try {
    const apiKeyId = req.headers["x-api-key-id"];
    const apiSignature = req.headers["x-api-signature"];
    const timestampStr = req.headers["x-api-timestamp"];
    const nonce = req.headers["x-api-nonce"];

    const expectedKeyId = process.env.API_KEY_ID;
    const secretKey = process.env.API_SECRET_KEY;

    if (!expectedKeyId || !secretKey) {
      console.error(
        "CRITICAL: API_KEY_ID or API_SECRET_KEY missing in backend .env",
      );
      return res
        .status(500)
        .json({ message: "API security configuration missing on server." });
    }

    if (!apiKeyId || apiKeyId !== expectedKeyId) {
      return res
        .status(403)
        .json({ message: "Forbidden: Invalid API Key Identifier." });
    }

    if (!timestampStr || !nonce) {
      return res
        .status(400)
        .json({ message: "Bad Request: Missing timestamp or nonce headers." });
    }

    const requestTime = parseInt(timestampStr, 10);
    const currentTime = Date.now();

    if (
      isNaN(requestTime) ||
      Math.abs(currentTime - requestTime) > MAX_TIMESTAMP_DELTA_MS
    ) {
      return res.status(401).json({
        message: "Unauthorized: Request timestamp expired or invalid.",
      });
    }

    if (seenNonces.has(nonce)) {
      return res.status(401).json({
        message: "Unauthorized: Replay attack detected (nonce reused).",
      });
    }

    // Match raw body string from frontend payload
    const bodyString =
      req.body && Object.keys(req.body).length > 0
        ? JSON.stringify(req.body)
        : "";
    const bodyHash = crypto
      .createHash("sha256")
      .update(bodyString)
      .digest("hex");

    // Clean endpoint string (e.g., /api/auth/login)
    const endpointPath = req.originalUrl.split("?")[0];

    const payloadToSign = `${req.method}:${endpointPath}:${timestampStr}:${nonce}:${bodyHash}`;
    const computedSignature = crypto
      .createHmac("sha256", secretKey)
      .update(payloadToSign)
      .digest("hex");

    if (!apiSignature) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Missing API signature." });
    }

    const apiSigBuffer = Buffer.from(apiSignature, "utf8");
    const computedSigBuffer = Buffer.from(computedSignature, "utf8");

    if (
      apiSigBuffer.length !== computedSigBuffer.length ||
      !crypto.timingSafeEqual(apiSigBuffer, computedSigBuffer)
    ) {
      console.warn(
        `Signature Mismatch! Computed: ${computedSignature} | Received: ${apiSignature}`,
      );
      return res
        .status(401)
        .json({ message: "Unauthorized: Handshake signature mismatch." });
    }

    // Store nonce with timestamp after successful signature check
    seenNonces.set(nonce, Date.now());
    next();
  } catch (err) {
    console.error("Handshake Middleware Exception:", err);
    return res.status(500).json({
      message: "Internal server error during handshake verification.",
    });
  }
};

export default verifyApiHandshake;
