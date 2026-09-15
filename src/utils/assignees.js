// Normalizes assignedTo/assignedToNames into the array shape every consumer
// expects. Complaints have supported multi-assignee since early on, but a
// small number of very old records still hold the pre-migration shape (a
// single scalar uid/name rather than an array) — reading one of those
// without normalizing crashes any `.every`/`.includes`/`.join` call downstream
// (e.g. ComplaintDetails.jsx's assignment section). Call this wherever
// complaint docs are read from Firestore, spreading the result over the raw
// doc data.
export function normalizeAssignees(data) {
  const assignedTo = Array.isArray(data.assignedTo)
    ? data.assignedTo
    : (data.assignedTo ? [data.assignedTo] : []);
  const assignedToNames = Array.isArray(data.assignedToNames)
    ? data.assignedToNames
    : (data.assignedToNames ? [data.assignedToNames] : (data.assignedToName ? [data.assignedToName] : []));
  return { assignedTo, assignedToNames };
}
