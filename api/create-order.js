const Razorpay = require("razorpay");
const admin = require("firebase-admin");

// Firebase Init (one time)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { amount, credits, packageId, userId } = req.body;

    // Validate
    if (!amount || !credits || !userId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Create Razorpay Order
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: `order_${Date.now()}`,
      notes: {
        userId: userId,
        credits: credits.toString(),
        packageId: packageId.toString(),
      },
    });

    // Save to Firestore
    await admin.firestore().collection("orders").doc(order.id).set({
      orderId: order.id,
      userId: userId,
      amount: amount,
      credits: credits,
      packageId: packageId,
      status: "created",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ Order created:", order.id);

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
    });

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ error: "Order creation failed" });
  }
};