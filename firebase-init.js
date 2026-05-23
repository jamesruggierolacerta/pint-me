// Firebase init for Pint-me
const firebaseConfig = {
  apiKey: "AIzaSyBDtf45OKxZIKUjv3ehbMBjpOMq1yVcKFs",
  authDomain: "pint-ping-b65ab.firebaseapp.com",
  projectId: "pint-ping-b65ab",
  storageBucket: "pint-ping-b65ab.firebasestorage.app",
  messagingSenderId: "1009708394894",
  appId: "1:1009708394894:web:6e2a948f21434a57e71cdf"
};

firebase.initializeApp(firebaseConfig);
window.fb = { auth: firebase.auth(), db: firebase.firestore() };
