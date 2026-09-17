const CONSENT_TEXT = {
  contact: "I agree that Timzee Corp may use these details to respond to my request.",
  support: "I agree that Timzee Corp may use these details to provide support and troubleshoot my request.",
  newsletter: "I agree to receive the Timzee Tech Hub newsletter and understand I can unsubscribe at any time.",
  ads: "I agree that Timzee Corp may use these details to review and respond to this advertising application."
};

function formType(form) {
  if (form.id === "newsletterForm") return "newsletter";
  if (form.id === "supportForm") return "support";
  if (form.id === "adsForm") return "ads";
  return "contact";
}

export function mountFormConsent() {
  document.querySelectorAll("form[data-requires-consent]").forEach((form) => {
    if (form.querySelector("[data-form-consent]")) return;
    const wrapper = document.createElement("label");
    wrapper.dataset.formConsent = "true";
    wrapper.className = "form-consent-row";
    wrapper.innerHTML = `<input type="checkbox" name="consent" value="yes" required><span>${CONSENT_TEXT[formType(form)]} <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>`;
    const submit = form.querySelector("button[type=submit]");
    if (submit) form.insertBefore(wrapper, submit);
    else form.appendChild(wrapper);
  });
}

if (typeof window !== "undefined") {
  const boot = () => mountFormConsent();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
