@'
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST.",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body && typeof req.body === "object"
        ? req.body
        : {};

    const method = String(body.method || "mobile").trim().toLowerCase();
    const destination = String(body.destination || "").trim();
    const amountUsd = Number(body.amountUsd);
    const handle = String(body.handle || "@scott").trim() || "@scott";

    const allowedMethods = ["mobile", "bank"];
    if (!allowedMethods.includes(method)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported payout method. Expected 'mobile' or 'bank'.",
      });
    }

    if (!destination || destination.length < 4) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid payout destination.",
      });
    }

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid positive USD amount.",
      });
    }

    const reference = `SG-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return res.status(200).json({
      ok: true,
      status: "queued",
      reference,
      method,
      destination,
      amountUsd: Number(amountUsd.toFixed(2)),
      handle,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: "Invalid JSON request body.",
    });
  }
}
'@ | Set-Content -Path api\payouts\withdraw.js -Encoding UTF8