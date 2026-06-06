import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore, type Firestore,
  collection, query, where, orderBy, limit,
  getDocs, getDoc, addDoc, updateDoc, setDoc, doc, writeBatch
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

// Lazy-initialize Firebase so any init error is deferred to request time,
// not module load time — prevents the serverless function from crashing on boot.
let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

function getDb(): Firestore {
  if (!_db) {
    _app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    _db = getFirestore(_app, firebaseConfig.firestoreDatabaseId);
  }
  return _db;
}

type WhereProxy = {
  limit: (n: number) => { get: () => Promise<any> };
  get: () => Promise<any>;
};

function makeWhereProxy(colPath: string, field: string, op: any, value: any): WhereProxy {
  return {
    limit: (n: number) => ({
      get: () => getDocs(query(collection(getDb(), colPath), where(field, op, value), limit(n)))
    }),
    get: () => getDocs(query(collection(getDb(), colPath), where(field, op, value)))
  };
}

function makeDocProxy(colPath: string, id: string) {
  const ref = doc(getDb(), colPath, id);
  return {
    ref,
    get: async () => {
      const d = await getDoc(ref);
      return { exists: d.exists(), data: () => d.data(), id: d.id, ref: d.ref };
    },
    set: (data: any) => setDoc(ref, data),
    update: (data: any) => updateDoc(ref, data)
  };
}

export const adminDbWrapper = {
  databaseId: firebaseConfig.firestoreDatabaseId,

  collection: (colPath: string) => ({
    where: (field: string, op: any, value: any) => makeWhereProxy(colPath, field, op, value),
    orderBy: (field: string, dir?: 'asc' | 'desc') => ({
      get: () => getDocs(query(collection(getDb(), colPath), orderBy(field, dir)))
    }),
    get: () => getDocs(collection(getDb(), colPath)),
    add: (data: any) => addDoc(collection(getDb(), colPath), data),
    doc: (id: string) => makeDocProxy(colPath, id)
  }),

  batch: () => {
    const b = writeBatch(getDb());
    return {
      delete: (ref: any) => b.delete(ref),
      set: (ref: any, data: any) => b.set(ref, data),
      update: (ref: any, data: any) => b.update(ref, data),
      commit: () => b.commit()
    };
  }
};
