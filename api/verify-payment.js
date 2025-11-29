const crypto = require("crypto");
const admin = require("firebase-admin");

// Firebase Init
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orderId, paymentId, signature, userId } = req.body;

    // Verify Signature
    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Get order
    const orderDoc = await admin.firestore().collection("orders").doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderData = orderDoc.data();

    if (orderData.status === "completed") {
      return res.status(200).json({
        success: true,
        message: "Already processed",
        credits: orderData.credits,
      });
    }

    // Update in transaction
    await admin.firestore().runTransaction(async (transaction) => {
      const userRef = admin.firestore().collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);
      const currentCredits = userDoc.data()?.totalCredits || 0;

      transaction.update(userRef, {
        totalCredits: currentCredits + orderData.credits,
        lastPurchaseDate: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(orderDoc.ref, {
        status: "completed",
        paymentId: paymentId,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const txnRef = admin.firestore().collection("transactions").doc();
      transaction.set(txnRef, {
        uid: userId,
        type: "credit_purchase",
        amount: orderData.credits,
        orderId: orderId,
        paymentId: paymentId,
        amountPaid: orderData.amount,
        status: "success",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).json({
      success: true,
      credits: orderData.credits,
      message: "Payment successful",
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Verification failed" });
  }
};