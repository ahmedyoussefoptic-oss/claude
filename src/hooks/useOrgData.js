import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { BRANCHES, DEPARTMENTS } from '../config/orgData';

function useOrgCollection(collectionName, fallback) {
  const [items, setItems] = useState(fallback);

  useEffect(() => {
    const q = query(collection(db, collectionName), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setItems(fallback);
          return;
        }
        setItems(
          snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((item) => item.active !== false)
        );
      },
      () => setItems(fallback)
    );
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName]);

  return items;
}

export function useBranches() {
  return useOrgCollection('branches', BRANCHES);
}

export function useDepartments() {
  return useOrgCollection('departments', DEPARTMENTS);
}
