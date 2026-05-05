import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, limit, getDocs, getDoc, addDoc, doc, updateDoc, setDoc, orderBy, writeBatch } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

// Initialize Client SDK for server-side use (works on Vercel)
const app = initializeApp(firebaseConfig);
export const adminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Mock admin-like interface for the scraper using Client SDK
export const adminDbWrapper = {
  databaseId: firebaseConfig.firestoreDatabaseId,
  collection: (path: string) => ({
    where: (field: string, op: any, value: any) => ({
      limit: (n: number) => ({
        get: () => getDocs(query(collection(adminDb, path), where(field, op, value), limit(n)))
      }),
      get: () => getDocs(query(collection(adminDb, path), where(field, op, value)))
    }),
    orderBy: (field: string, dir: any) => ({
      get: () => getDocs(query(collection(adminDb, path), orderBy(field, dir)))
    }),
    get: () => getDocs(collection(adminDb, path)),
    add: (data: any) => addDoc(collection(adminDb, path), data),
    doc: (id: string) => ({
      get: async () => {
        const d = await getDoc(doc(adminDb, path, id));
        return {
          exists: d.exists(),
          data: () => d.data(),
          id: d.id,
          ref: d.ref
        };
      },
      set: (data: any) => setDoc(doc(adminDb, path, id), data),
      update: (data: any) => updateDoc(doc(adminDb, path, id), data),
      ref: doc(adminDb, path, id)
    })
  }),
  batch: () => {
    const b = writeBatch(adminDb);
    return {
      delete: (ref: any) => b.delete(ref),
      set: (ref: any, data: any) => b.set(ref, data),
      update: (ref: any, data: any) => b.update(ref, data),
      commit: () => b.commit()
    };
  }
};
