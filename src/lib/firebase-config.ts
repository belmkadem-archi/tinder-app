import firebaseConfigJson from '../../firebase-applet-config.json';

function resolveConfig() {
  const isNode = typeof process !== 'undefined' && process.env != null;
  const isVite = typeof import.meta !== 'undefined' && (import.meta as any).env != null;
  const injected = typeof window !== 'undefined' ? (window as any).FIREBASE_CONFIG : null;

  const apiKey =
    (isNode && process.env.FIREBASE_API_KEY) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_API_KEY) ||
    injected?.apiKey ||
    firebaseConfigJson.apiKey;

  const projectId =
    (isNode && process.env.FIREBASE_PROJECT_ID) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_PROJECT_ID) ||
    injected?.projectId ||
    firebaseConfigJson.projectId;

  const authDomain =
    (isNode && process.env.FIREBASE_AUTH_DOMAIN) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN) ||
    injected?.authDomain ||
    firebaseConfigJson.authDomain;

  const appId =
    (isNode && process.env.FIREBASE_APP_ID) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_APP_ID) ||
    injected?.appId ||
    firebaseConfigJson.appId;

  const firestoreDatabaseId =
    (isNode && process.env.FIREBASE_DATABASE_ID) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_DATABASE_ID) ||
    injected?.firestoreDatabaseId ||
    firebaseConfigJson.firestoreDatabaseId ||
    '(default)';

  return { apiKey, authDomain, projectId, appId, firestoreDatabaseId };
}

export const firebaseConfig = resolveConfig();
