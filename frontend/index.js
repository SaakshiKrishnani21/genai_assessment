  // ════════════════════════════════════════════════════════════════
  // Login page logic. There are three situations:
  //   1. Local mode (Firebase not set up)  -> just pick Student or Admin
  //   2. Firebase mode, already signed in  -> go straight to the dashboard
  //   3. Firebase mode, signed out         -> show the log in / sign up form
  // ════════════════════════════════════════════════════════════════
  import { setRole, getDisplayName, setDisplayName, setUserEmail, isValidEmail, showToast, SESSION, FIREBASE_MODE } from "./js/app.js?v=6";

  const $ = id => document.getElementById(id);   // short for "find the element with this id"

  // Animate the bars in the sample report on the left (they start at width 0).
  setTimeout(() => document.querySelectorAll(".fill").forEach(f => f.style.width = f.dataset.w + "%"), 350);

  if (!FIREBASE_MODE) {
    // ── 1. Local mode ──────────────────────────────────────────────
    $("local-area").classList.remove("hidden");
    $("h-title").textContent = "Get started";
    $("h-sub").textContent = "Pick how you want to use the app.";
    $("l-name").value = getDisplayName() === "Guest" ? "" : getDisplayName();

    // Save the name/email, remember the role, then open that role's dashboard.
    const go = role => {
      const n = $("l-name").value.trim(),
            e = $("l-email").value.trim();
      if (role === "student" && !isValidEmail(e)) return showToast("Enter a valid email for your reports.", "error");
      if (n) setDisplayName(n);
      if (e) setUserEmail(role, e);
      setRole(role);
      location.href = role + "/dashboard.html";
    };
    $("l-student").onclick = () => go("student");
    $("l-admin").onclick = () => go("admin");

  } else if (SESSION) {
    // ── 2. Already signed in ───────────────────────────────────────
    location.replace(`${SESSION.role}/dashboard.html`);

  } else {
    // ── 3. Firebase mode, signed out ───────────────────────────────
    const { signInWithGoogle, emailSignIn, emailSignUp, resetPassword, resendVerification } = await import("./js/firebase.js");
    const { firebaseConfig } = await import("./js/firebase-config.js");
    $("fb-area").classList.remove("hidden");

    // The form works in two modes: "login" and "signup". setMode() changes the
    // wording and which fields are visible.
    let mode = "login";
    const setMode = m => {
      mode = m;
      const su = m === "signup";
      $("t-login").classList.toggle("on", !su);
      $("t-signup").classList.toggle("on", su);
      $("f-name").classList.toggle("hidden", !su);
      $("forgot-row").classList.toggle("hidden", su);
      $("h-title").textContent = su ? "Create your account" : "Welcome back";
      $("h-sub").textContent = su ? "Join in seconds and start getting scored." : "Log in to continue your assessments.";
      $("go").textContent = su ? "Create account" : "Log in";
      $("g-lbl").textContent = su ? "Sign up with Google" : "Continue with Google";
      $("in-pass").autocomplete = su ? "new-password" : "current-password";
    };
    $("t-login").onclick = () => setMode("login");
    $("t-signup").onclick = () => setMode("signup");

    // "Show / Hide" button next to the password.
    $("eye").onclick = () => {
      const p = $("in-pass"),
            h = p.type === "password";
      p.type = h ? "text" : "password";
      $("eye").textContent = h ? "Hide" : "Show";
    };

    // "Check your inbox" card: shown after sign-up, or when the email is not verified yet.
    $("ok-back").onclick = () => {
      $("ok-card").style.display = "none";
      $("auth-card").style.display = "";
      setMode("login");
    };
    const showCheck = (email, msg) => {
      $("auth-card").style.display = "none";
      $("ok-card").style.display = "block";
      $("ok-msg").textContent = msg;
      $("ok-hint").textContent = `Not there? Check Spam / Promotions. The sender is noreply@${firebaseConfig.authDomain}.`;
    };
    $("ok-resend").onclick = async () => {
      const email = $("in-email").value.trim(),
            pass = $("in-pass").value;
      if (!email || !pass) return showToast("Enter your email and password, then press Resend.", "error");
      busy($("ok-resend"), true, "Sending…");
      try {
        const r = await resendVerification(email, pass);
        showToast(r === "verified" ? "Your email is already verified. Go back and log in." : "Verification email sent. Check your inbox and spam.", "success", 6000);
      } catch (e) { fail(e); }
      busy($("ok-resend"), false, "Resend email");
    };

    // Friendly messages for Firebase error codes (anything else shows the raw error).
    const MSG = {
      "auth/popup-closed-by-user": "Sign-in was cancelled.",
      "auth/popup-blocked": "Your browser blocked the pop-up. Allow pop-ups for this site and retry.",
      "auth/unauthorized-domain": "This address isn't an authorized domain. Use http://localhost:8000 or add it in Firebase → Authentication → Settings.",
      "auth/operation-not-allowed": "This sign-in method isn't enabled in Firebase (Authentication → Sign-in method).",
      "auth/invalid-credential": "Wrong email or password.",
      "auth/invalid-email": "That email doesn't look valid.",
      "auth/email-already-in-use": "An account with this email already exists. Try logging in.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/too-many-requests": "Firebase is rate-limiting this email for a while. Check your spam folder for the earlier link, or wait 15-60 minutes and try again.",
      "app/unverified": "Please verify your email first. We just sent a fresh link to your inbox.",
    };
    const fail = e => showToast(MSG[e.code] || ("Failed: " + (e.message || e.code)), "error", 6500);

    // Disables a button (and optionally changes its text) while something is loading.
    const busy = (btn, on, txt) => {
      btn.disabled = on;
      if (txt) btn.textContent = txt;
    };

    // "Continue with Google"
    $("g-btn").onclick = async () => {
      try { await signInWithGoogle(); location.reload(); } catch (e) { fail(e); }
    };

    // "Forgot password?"
    $("forgot").onclick = async () => {
      const email = $("in-email").value.trim();
      if (!isValidEmail(email)) return showToast("Type your email above first, then click Forgot password.", "error");
      try {
        await resetPassword(email);
        showToast("Password reset link sent. Check your inbox.", "success", 5000);
      } catch (e) { fail(e); }
    };

    // Main button: "Log in" or "Create account", depending on the mode.
    $("go").onclick = async () => {
      const email = $("in-email").value.trim(),
            pass = $("in-pass").value,
            name = $("in-name").value.trim();
      if (!isValidEmail(email)) return showToast("Enter a valid email.", "error");
      if (pass.length < 6) return showToast("Password must be at least 6 characters.", "error");
      if (mode === "signup" && !name) return showToast("Enter your full name.", "error");

      const label = $("go").textContent;
      busy($("go"), true, mode === "signup" ? "Creating…" : "Logging in…");
      try {
        if (mode === "signup") {
          const r = await emailSignUp(name, email, pass);
          showCheck(email, r.sent
            ? `Account created. We sent a verification link to ${email}. Click it, then come back and log in.`
            : `Account created, but the verification email could not be sent (${r.code || "unknown"}). Press Resend email in a minute.`);
        } else {
          await emailSignIn(email, pass);
          location.reload();
        }
      } catch (e) {
        if (e.code === "app/unverified") showCheck(email, e.sent
          ? `Your email isn't verified yet. We just sent a fresh link to ${email}. Click it, then log in.`
          : `Your email isn't verified yet, and the new link could not be sent (${e.sendCode || "unknown"}). Check your spam folder for the earlier link.`);
        else fail(e);
      }
      busy($("go"), false, label);
    };

    // Pressing Enter in any field is the same as clicking the main button.
    [$("in-email"), $("in-pass"), $("in-name")].forEach(i => i.addEventListener("keydown", e => e.key === "Enter" && $("go").click()));
  }
