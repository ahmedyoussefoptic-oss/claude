import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { BRANCHES, DEPARTMENTS } from '../config/orgData';
import { COMPLAINT_TYPES, SUB_TYPES } from '../config/complaintTypes';
import { PROBLEM_TYPES, PLATFORMS } from '../config/techSupport';
import { ITEM_CATEGORIES } from '../config/lostFound';

// Flatten the legacy { ACADEMIC: [...names], ... } shape into the flat
// {id, name, parentType, order}[] shape the Firestore-backed hook returns —
// `name` (not `id`) is the value stored on complaint.subType, so existing
// records keep matching regardless of what id a Firestore-added item gets.
const SUB_TYPES_FALLBACK = Object.entries(SUB_TYPES).flatMap(([parentType, names]) =>
  names.map((name, order) => ({ id: `${parentType}_${order}`, name, parentType, order }))
);

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

export function useComplaintTypes() {
  return useOrgCollection('complaintTypes', COMPLAINT_TYPES);
}

export function useSubTypes() {
  return useOrgCollection('complaintSubTypes', SUB_TYPES_FALLBACK);
}

export function useProblemTypes() {
  return useOrgCollection('problemTypes', PROBLEM_TYPES);
}

export function usePlatforms() {
  return useOrgCollection('platforms', PLATFORMS);
}

export function useItemCategories() {
  return useOrgCollection('itemCategories', ITEM_CATEGORIES);
}
