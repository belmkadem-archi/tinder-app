import firebaseConfigJson from '../../firebase-applet-config.json';

export const getFirebaseConfig = () => {
  // Safe check for environment variables in both Node.js and Browser
  const isNode = typeof process !== 'undefined' && process.env;
  const isVite = typeof import.meta !== 'undefined' && (import.meta as any).env;
  const isBrowser = typeof window !== 'undefined';

  // Check for injected config from server (Production)
  const injectedConfig = isBrowser ? (window as any).FIREBASE_CONFIG : null;

  const envConfig = {
    apiKey: (isNode ? process.env.FIREBASE_API_KEY : null) || 
            (isVite ? (import.meta as any).env.VITE_FIREBASE_API_KEY : null) ||
            (injectedConfig?.apiKey),
    authDomain: (isNode ? process.env.FIREBASE_AUTH_DOMAIN : null) || 
                (isVite ? (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN : null) ||
                (injectedConfig?.authDomain),
    projectId: (isNode ? process.env.FIREBASE_PROJECT_ID : null) || 
               (isVite ? (import.meta as any).env.VITE_FIREBASE_PROJECT_ID : null) ||
               (injectedConfig?.projectId),
    appId: (isNode ? process.env.FIREBASE_APP_ID : null) || 
           (isVite ? (import.meta as any).env.VITE_FIREBASE_APP_ID : null) ||
           (injectedConfig?.appId),
    firestoreDatabaseId: (isNode ? process.env.FIREBASE_DATABASE_ID : null) || 
                         (isVite ? (import.meta as any).env.VITE_FIREBASE_DATABASE_ID : null) ||
                         (injectedConfig?.firestoreDatabaseId),
  };

  // Prioritize environment variables if they are present
  const hasEnv = envConfig.apiKey && envConfig.projectId;

  if (hasEnv) {
    console.log("🔥 Firebase: Using Environment Variables");
    return {
      ...envConfig,
      firestoreDatabaseId: envConfig.firestoreDatabaseId || '(default)'
    };
  }

  // Fallback to JSON file
  const isJsonValid = firebaseConfigJson && 
                     firebaseConfigJson.apiKey && 
                     !firebaseConfigJson.apiKey.includes('TODO');

  if (isJsonValid) {
    console.log("🔥 Firebase: Using local config file");
    return {
      ...firebaseConfigJson,
      firestoreDatabaseId: firebaseConfigJson.firestoreDatabaseId || '(default)'
    };
  }

  console.warn("⚠️ Firebase: No valid configuration found!");

  return {
    ...envConfig,
    firestoreDatabaseId: envConfig.firestoreDatabaseId || '(default)'
  };
};

export const firebaseConfig = getFirebaseConfig();
