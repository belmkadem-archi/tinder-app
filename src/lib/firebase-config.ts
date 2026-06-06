// Inline defaults — avoids JSON ESM import assertion issues (Node.js v20+ requires
// `with { type: 'json' }` which not all bundlers/runtimes handle consistently)
const FIREBASE_DEFAULTS = {
  apiKey: "AIzaSyDmBOKDFLI36Gzk0A8eY6_gkBRMQuIwXGs",
  authDomain: "ace-slice-490203-u1.firebaseapp.com",
  projectId: "ace-slice-490203-u1",
  appId: "1:995051012371:web:b0e388378fb4efd40b5ae6",
  firestoreDatabaseId: "ai-studio-51d94d8a-ef8e-4e42-8927-072c80d1c0ba"
};

function resolveConfig() {
  const isNode = typeof process !== 'undefined' && process.env != null;
  const isVite = typeof import.meta !== 'undefined' && (import.meta as any).env != null;
  const injected = typeof window !== 'undefined' ? (window as any).FIREBASE_CONFIG : null;

  const apiKey =
    (isNode && process.env.FIREBASE_API_KEY) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_API_KEY) ||
    injected?.apiKey ||
    FIREBASE_DEFAULTS.apiKey;

  const projectId =
    (isNode && process.env.FIREBASE_PROJECT_ID) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_PROJECT_ID) ||
    injected?.projectId ||
    FIREBASE_DEFAULTS.projectId;

  const authDomain =
    (isNode && process.env.FIREBASE_AUTH_DOMAIN) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN) ||
    injected?.authDomain ||
    FIREBASE_DEFAULTS.authDomain;

  const appId =
    (isNode && process.env.FIREBASE_APP_ID) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_APP_ID) ||
    injected?.appId ||
    FIREBASE_DEFAULTS.appId;

  const firestoreDatabaseId =
    (isNode && process.env.FIREBASE_DATABASE_ID) ||
    (isVite && (import.meta as any).env.VITE_FIREBASE_DATABASE_ID) ||
    injected?.firestoreDatabaseId ||
    FIREBASE_DEFAULTS.firestoreDatabaseId;

  return { apiKey, authDomain, projectId, appId, firestoreDatabaseId };
}

export const firebaseConfig = resolveConfig();
