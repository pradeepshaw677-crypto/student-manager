
        // ═══════════════════════════════════════════════════════════════
        //  FIREBASE CONFIG
        // ═══════════════════════════════════════════════════════════════
        const firebaseConfig = {
            apiKey: "AIzaSyAtgUOiAnQOUPtGc7C4iuwmGUSjqU_8TE0",
            authDomain: "students-manager-b5a76.firebaseapp.com",
            projectId: "students-manager-b5a76",
            storageBucket: "students-manager-b5a76.firebasestorage.app",
            messagingSenderId: "768567956050",
            appId: "1:768567956050:web:655ddc2ebb7b7cc2bf858b",
            measurementId: "G-RMX5056C3P"
        };
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();

        // ─── OPTIONAL: Firebase App Check (recommended for API-abuse protection) ───
        // 1) index.html ke head me ye SDK add karo (baaki Firebase SDKs ke saath):
        //    <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-check-compat.js"></script>
        // 2) Firebase Console > Project Settings > App Check > web app ko reCAPTCHA v3 se register karo.
        // 3) Neeche wali line uncomment karke apni reCAPTCHA SITE key daalo:
        // firebase.appCheck().activate("YOUR_RECAPTCHA_SITE_KEY", true);
        // 4) Firebase Console > Firestore > App Check me "Enforce" ON karo.
        // 5) CSP me script-src me https://www.google.com aur connect-src me https://content-recaptcha.googleapis.com add karna.
