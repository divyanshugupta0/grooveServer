const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const candidatePaths = [];
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  candidatePaths.push(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT));
}
candidatePaths.push(path.join(__dirname, '..', 'serviceAccount.json'));
candidatePaths.push(path.join(__dirname, 'serviceAccount.json'));

const serviceAccountPath = candidatePaths.find(p => fs.existsSync(p));

if (!serviceAccountPath) {
  throw new Error(`Missing service account JSON. Tried: ${candidatePaths.join(', ')}`);
}

const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) {
  throw new Error('FIREBASE_DATABASE_URL is required');
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  databaseURL
});

const db = admin.database();
const auth = admin.auth();

module.exports = { admin, db, auth };
