import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { branchScopeConstraintValues } from '../utils/scope';
import { normalizeAssignees } from '../utils/assignees';

// Live, branch-scoped read of a whole records collection (complaints,
// techSupportTickets, lostFoundItems), newest first — the same scoping rule
// firestore.rules enforces on `list`. Pass enabled=false for a collection
// the caller may not read at all, so no permission-denied listener is opened.
export function useBranchScopedCollection(collectionName, userData, enabled = true) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!userData || !enabled) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, collectionName), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDocs(snapshot.docs.map((d) => {
        const data = d.data();
        return { id: d.id, ...data, ...normalizeAssignees(data) };
      }));
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, userData?.access, userData?.branch, userData?.branches?.join(','), enabled]);
  return { docs, loading };
}
