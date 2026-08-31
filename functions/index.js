const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.scheduledSlaEngine = onSchedule("every 1 hours", async (event) => {
  const now = admin.firestore.Timestamp.now();
  
  // Get complaints that are open or processing and not yet overdue
  const complaintsRef = db.collection("complaints");
  const q = complaintsRef.where("status", "in", ["مفتوحة", "قيد المعالجة"]);
  
  const snapshot = await q.get();
  
  if (snapshot.empty) {
    console.log("No active complaints found for SLA check.");
    return;
  }

  const batch = db.batch();
  let updatedCount = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    // Assuming 'dueDate' is a Timestamp field
    if (data.dueDate && data.dueDate.toMillis() < now.toMillis()) {
      // SLA breached!
      batch.update(doc.ref, {
        status: "متأخرة",
        updatedAt: now,
      });
      
      // Add history record
      const historyRef = doc.ref.collection('history').doc();
      batch.set(historyRef, {
        status: "تأخير في الحل (SLA Breach)",
        timestamp: now,
        system: true
      });
      
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    await batch.commit();
    console.log(`Updated ${updatedCount} complaints to overdue status.`);
  } else {
    console.log("No complaints breached SLA in this run.");
  }
});
