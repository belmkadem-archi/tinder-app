import admin from 'firebase-admin';
import firebaseConfig from '../../firebase-applet-config.json';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), // This works in AI Studio/Google Cloud
    projectId: firebaseConfig.projectId,
  });
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
