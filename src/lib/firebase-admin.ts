import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, limit, getDocs, addDoc, doc, updateDoc, setDoc, orderBy } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Client SDK for server-side use (works on Vercel)
const app = initializeApp(firebaseConfig);
export const adminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Mock admin-like interface for the scraper using Client SDK
export const adminDbWrapper = {
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
      get: () => getDocs(query(collection(adminDb, path), where('__name__', '==', id))), // Simplified
      set: (data: any) => setDoc(doc(adminDb, path, id), data),
      update: (data: any) => updateDoc(doc(adminDb, path, id), data),
      ref: doc(adminDb, path, id)
    })
  }),
  batch: () => ({
    delete: (ref: any) => {}, // Batch not easily shimmed, skipping for now or implement properly
    commit: async () => {}
  })
};
