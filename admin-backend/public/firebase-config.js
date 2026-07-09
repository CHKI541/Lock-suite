// Reemplazá estos valores con los de tu proyecto real:
// Firebase Console → ⚙️ Configuración del proyecto → General → Tus apps → Configuración del SDK
// (Si todavía no tenés una "app web" registrada en el proyecto, creá una ahí mismo — es gratis y no
// tiene nada que ver con la app de Android, es solo para que este panel pueda hablar con Firebase)

const firebaseConfig = {
  apiKey: "AIzaSyAwrQjtHDC0YKfPWCHnCnQL2Dg7prwEyfw",
  authDomain: "locksuite-nueva.firebaseapp.com",
  databaseURL: "https://locksuite-nueva-default-rtdb.firebaseio.com",
  projectId: "locksuite-nueva",
  storageBucket: "locksuite-nueva.firebasestorage.app",
  messagingSenderId: "687828714595",
  appId: "1:687828714595:web:220bf9b3ba93c12a8e2456"
};

firebase.initializeApp(firebaseConfig);
