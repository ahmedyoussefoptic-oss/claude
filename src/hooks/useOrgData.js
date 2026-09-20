import { useEffect, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, writeBatch } from 'firebase/firestore';
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

// Maps each Firestore collection to the hardcoded seed list useOrgCollection
// falls back to while the collection is still empty — used by ensureSeeded()
// below, called before any "add a new item" write.
const FALLBACKS = {
  branches: BRANCHES,
  departments: DEPARTMENTS,
  complaintTypes: COMPLAINT_TYPES,
  complaintSubTypes: SUB_TYPES_FALLBACK,
  problemTypes: PROBLEM_TYPES,
  platforms: PLATFORMS,
  itemCategories: ITEM_CATEGORIES,
};

// Writes the hardcoded fallback list into `collectionName` as real documents
// for any entry not already represented there (matched by id for the
// id-keyed lists, or by name+parentType for sub-types, since that's the
// field actually persisted on complaint records). Settings.jsx calls this
// before every "add" write.
//
// Why this exists: useOrgCollection() below shows the hardcoded fallback
// list ONLY while its Firestore collection is completely empty — the
// instant ANY real document exists there, it switches to showing only real
// documents. So the very first item ever added to a still-unseeded
// collection used to make every other (fallback-only, never actually
// written to Firestore) entry vanish from the UI in the same instant —
// indistinguishable from all of them having been deleted, because nothing
// backed them but this hardcoded list. Seeding the rest of the fallback as
// real documents in the same moment closes that gap for good.
export async function ensureSeeded(collectionName) {
  const fallback = FALLBACKS[collectionName];
  if (!fallback?.length) return;

  const existing = await getDocs(collection(db, collectionName));
  const existingByKey = new Set(
    existing.docs.map((d) => {
      const data = d.data();
      return collectionName === 'complaintSubTypes' ? `${data.parentType}::${data.name}` : d.id;
    })
  );

  const batch = writeBatch(db);
  let queued = 0;
  fallback.forEach((item, index) => {
    const key = collectionName === 'complaintSubTypes' ? `${item.parentType}::${item.name}` : item.id;
    if (existingByKey.has(key)) return;
    const { id, ...data } = item;
    // `order` defaults to the item's position in the fallback list — the
    // fallback configs (COMPLAINT_TYPES, BRANCHES, ...) don't define one
    // per entry, and useOrgCollection() below now sorts client-side, but a
    // doc with no `order` field at all is still worth avoiding on principle.
    batch.set(doc(db, collectionName, id), { order: index, ...data, active: true });
    queued++;
  });
  if (queued > 0) await batch.commit();
}

function useOrgCollection(collectionName, fallback) {
  const [items, setItems] = useState(fallback);

  useEffect(() => {
    // Sorted client-side rather than via a Firestore orderBy('order') query:
    // Firestore silently excludes any document missing the field it orders
    // by, and not every doc here is guaranteed to have `order` (e.g. one
    // manually added to the Firestore console, or written by older code) —
    // an excluded doc looked exactly like data loss even though it was
    // still there. Missing `order` now just sorts last instead of vanishing.
    const unsubscribe = onSnapshot(
      collection(db, collectionName),
      (snapshot) => {
        if (snapshot.empty) {
          setItems(fallback);
          return;
        }
        setItems(
          snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((item) => item.active !== false)
            .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
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
