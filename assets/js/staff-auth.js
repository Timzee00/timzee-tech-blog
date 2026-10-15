import { login } from "./auth.js";
import { validateForm } from "./ui-controls.js";

export function bindStaffLogin({ formId, roles, destination }) {
  const form = document.getElementById(formId);
  if (!form) return false;
  const message = document.getElementById("loginMessage");
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  let submitting = false;
  message?.setAttribute("role", "status");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting || !validateForm(form)) return;
    submitting = true; button.disabled = true; button.textContent = "Signing in…";
    const email = document.getElementById("username").value.trim();
    // Whitespace can be part of a password; never alter it before authentication.
    const password = document.getElementById("password").value;
    try {
      const result = await login(email, password, roles);
      if (!result.ok) { if (message) message.textContent = result.message; return; }
      window.location.href = destination;
    } catch (error) {
      console.error("Staff sign-in failed:", error);
      if (message) message.textContent = "Unable to sign in. Check your connection and try again.";
    } finally {
      submitting = false; button.disabled = false; button.textContent = label;
    }
  });
  return true;
}
