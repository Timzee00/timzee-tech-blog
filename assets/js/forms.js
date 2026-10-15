import { supabase } from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { setupReveal } from "./reveal.js";
import { extractErrorMessage, reportAppError } from "./utils.js";
import { mountFormConsent } from "./form-consent.js";
import "./nav.js";
import { validateForm } from "./ui-controls.js";

async function applySiteTheme(settings) {
  if (settings?.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }
}

function normalizePhone(raw = "") { return raw.replace(/[^\d]/g, ""); }

function applySupportTools(settings) {
  const whatsappBtn = document.getElementById("whatsappSupportBtn");
  if (whatsappBtn) {
    const number = normalizePhone(settings?.support?.whatsappNumber || "");
    if (number) {
      const message = encodeURIComponent(settings?.support?.whatsappMessage || "Hi there");
      whatsappBtn.href = `https://wa.me/${number}?text=${message}`;
      whatsappBtn.style.display = "inline-flex";
    } else whatsappBtn.style.display = "none";
  }

  const donationBtn = document.getElementById("donationBtn");
  const donationModal = document.getElementById("donationModal");
  const donationTitle = document.getElementById("donationTitle");
  const donationDetails = document.getElementById("donationDetails");
  const donationLink = document.getElementById("donationLink");
  const donationClose = document.getElementById("donationClose");
  const donationEnabled = settings?.donation?.enabled;
  if (donationBtn) donationBtn.style.display = donationEnabled ? "inline-flex" : "none";
  if (donationTitle) donationTitle.textContent = settings?.donation?.title || "Support Timzee Tech Hub";
  if (donationDetails) donationDetails.textContent = settings?.donation?.details || "Thanks for supporting our community.";
  if (donationLink) {
    const url = settings?.donation?.url || "";
    donationLink.style.display = url ? "inline-flex" : "none";
    if (url) donationLink.href = url;
  }
  if (donationBtn && donationModal) donationBtn.addEventListener("click", () => donationModal.classList.add("show"));
  if (donationClose && donationModal) donationClose.addEventListener("click", () => donationModal.classList.remove("show"));
  donationModal?.addEventListener("click", (event) => { if (event.target === donationModal) donationModal.classList.remove("show"); });
}

function bindForm({ formId, statusId, table, map }) {
  const form = document.getElementById(formId);
  const status = document.getElementById(statusId);
  if (!form) return;

  let submitting = false;
  if (status) status.setAttribute("role", "status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || !validateForm(form)) return;
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.requiresConsent === "true" && data.consent !== "yes") {
      if (status) { status.textContent = "Please review the privacy notice and give consent before submitting."; status.style.display = "block"; }
      return;
    }
    const payload = map(data);
    if (form.dataset.requiresConsent === "true") payload.consent_at = new Date().toISOString();
    submitting = true;
    const button = form.querySelector('button[type="submit"]');
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "Sending…"; }
    form.setAttribute("aria-busy", "true");
    if (status) { status.textContent = "Sending your request…"; status.style.display = "block"; }
    try {
      const result = await supabase.from(table).insert(payload);
      if (result.error) throw result.error;
      form.reset();
      if (status) status.textContent = "Thanks! We received your submission.";
    } catch (error) {
      console.error("Form submission failed:", error);
      if (status) status.textContent = "We could not send this. Your details are still here; check your connection and try again.";
    } finally {
      submitting = false; form.setAttribute("aria-busy", "false");
      if (button) { button.disabled = false; button.textContent = original; }
    }
  });
}

async function boot() {
  setupReveal();
  mountFormConsent();
  const settings = await fetchSettings();
  await applySiteTheme(settings);
  applySupportTools(settings);

  bindForm({
    formId: "contactForm", statusId: "contactStatus", table: "contact_requests",
    map: (data) => ({ id: crypto.randomUUID(), name: data.name || "", email: data.email || "", subject: data.subject || "", message: data.message || "", created_at: new Date().toISOString(), status: "open" })
  });
  bindForm({
    formId: "supportForm", statusId: "supportStatus", table: "support_requests",
    map: (data) => ({ id: crypto.randomUUID(), name: data.name || "", email: data.email || "", issue: data.issue || "", message: data.message || "", created_at: new Date().toISOString(), status: "open" })
  });
  bindForm({
    formId: "newsletterForm", statusId: "newsletterStatus", table: "newsletter_signups",
    map: (data) => ({ id: crypto.randomUUID(), name: data.name || "", email: data.email || "", interest: data.interest || "", created_at: new Date().toISOString(), status: "open" })
  });
  bindForm({
    formId: "adsForm", statusId: "adsStatus", table: "ad_applications",
    map: (data) => ({ id: crypto.randomUUID(), name: data.name || "", email: data.email || "", company: data.company || "", budget: data.budget || "", message: data.message || "", created_at: new Date().toISOString(), status: "open" })
  });
}

boot().catch((error) => {
  reportAppError(error, "Form page load failed");
  const message = extractErrorMessage(error, "Unable to initialize this page.");
  ["contactStatus", "supportStatus", "newsletterStatus", "adsStatus"].forEach((id) => {
    const target = document.getElementById(id);
    if (target) { target.textContent = message; target.style.display = "block"; }
  });
});
