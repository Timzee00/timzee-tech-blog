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
  ["contactForm", "supportForm", "newsletterForm", "adsForm"].forEach((id) => {
    const form = document.getElementById(id);
    if (!form) return;
    form.dataset.requiresConsent = "true";
    if (form.querySelector("[data-form-consent]")) return;
    const wrapper = document.createElement("label");
    wrapper.dataset.formConsent = "true";
    wrapper.className = "form-consent-row";
    const text = document.createElement("span");
    text.append(document.createTextNode(`${CONSENT_TEXT[formType(form)]} `));
    const link = document.createElement("a");
    link.href = "privacy.html";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Privacy Policy";
    text.append(link, document.createTextNode("."));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "consent";
    checkbox.value = "yes";
    checkbox.required = true;
    wrapper.append(checkbox, text);
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
