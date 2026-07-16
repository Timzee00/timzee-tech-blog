import { supabase } from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { setupReveal } from "./reveal.js";
import { extractErrorMessage, reportAppError } from "./utils.js";
import "./nav.js";

async function applySiteTheme(settings) {
  if (settings?.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }
}

function normalizePhone(raw = "") {
  return raw.replace(/[^\d]/g, "");
}

function applySupportTools(settings) {
  const whatsappBtn = document.getElementById("whatsappSupportBtn");
  if (whatsappBtn) {
    const number = normalizePhone(settings?.support?.whatsappNumber || "");
    if (number) {
      const message = encodeURIComponent(settings?.support?.whatsappMessage || "Hi there");
      whatsappBtn.href = `https://wa.me/${number}?text=${message}`;
      whatsappBtn.style.display = "inline-flex";
    } else {
      whatsappBtn.style.display = "none";
    }
  }

  const donationBtn = document.getElementById("donationBtn");
  const donationModal = document.getElementById("donationModal");
  const donationTitle = document.getElementById("donationTitle");
  const donationDetails = document.getElementById("donationDetails");
  const donationLink = document.getElementById("donationLink");
  const donationClose = document.getElementById("donationClose");
  const donationEnabled = settings?.donation?.enabled;
  if (donationBtn) {
    donationBtn.style.display = donationEnabled ? "inline-flex" : "none";
  }
  if (donationTitle) {
    donationTitle.textContent = settings?.donation?.title || "Support Timzee Tech Hub";
  }
  if (donationDetails) {
    donationDetails.textContent = settings?.donation?.details || "Thanks for supporting our community.";
  }
  if (donationLink) {
    const url = settings?.donation?.url || "";
    if (url) {
      donationLink.href = url;
      donationLink.style.display = "inline-flex";
    } else {
      donationLink.style.display = "none";
    }
  }
  if (donationBtn && donationModal) {
    donationBtn.addEventListener("click", () => {
      donationModal.classList.add("show");
    });
  }
  if (donationClose && donationModal) {
    donationClose.addEventListener("click", () => {
      donationModal.classList.remove("show");
    });
  }
  if (donationModal) {
    donationModal.addEventListener("click", (event) => {
      if (event.target === donationModal) {
        donationModal.classList.remove("show");
      }
    });
  }
}

function bindForm({ formId, statusId, table, map }) {
  const form = document.getElementById(formId);
  const status = document.getElementById(statusId);
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = map(data);
    const result = await supabase.from(table).insert(payload);
    if (result.error) {
      if (status) {
        status.textContent = result.error.message || "Submission failed.";
        status.style.display = "block";
      }
      return;
    }
    form.reset();
    if (status) {
      status.textContent = "Thanks! We received your message.";
      status.style.display = "block";
    }
  });
}

async function boot() {
  setupReveal();
  const settings = await fetchSettings();
  await applySiteTheme(settings);
  applySupportTools(settings);

  bindForm({
    formId: "contactForm",
    statusId: "contactStatus",
    table: "contact_requests",
    map: (data) => ({
      id: crypto.randomUUID(),
      name: data.name || "",
      email: data.email || "",
      subject: data.subject || "",
      message: data.message || "",
      created_at: new Date().toISOString(),
      status: "open"
    })
  });

  bindForm({
    formId: "supportForm",
    statusId: "supportStatus",
    table: "support_requests",
    map: (data) => ({
      id: crypto.randomUUID(),
      name: data.name || "",
      email: data.email || "",
      issue: data.issue || "",
      message: data.message || "",
      created_at: new Date().toISOString(),
      status: "open"
    })
  });

  bindForm({
    formId: "newsletterForm",
    statusId: "newsletterStatus",
    table: "newsletter_signups",
    map: (data) => ({
      id: crypto.randomUUID(),
      name: data.name || "",
      email: data.email || "",
      interest: data.interest || "",
      created_at: new Date().toISOString(),
      status: "open"
    })
  });

  bindForm({
    formId: "adsForm",
    statusId: "adsStatus",
    table: "ad_applications",
    map: (data) => ({
      id: crypto.randomUUID(),
      name: data.name || "",
      email: data.email || "",
      company: data.company || "",
      budget: data.budget || "",
      message: data.message || "",
      created_at: new Date().toISOString(),
      status: "open"
    })
  });
}

boot().catch((error) => {
  reportAppError(error, "Form page load failed");
  const message = extractErrorMessage(error, "Unable to initialize this page.");
  const statuses = ["contactStatus", "supportStatus", "newsletterStatus", "adsStatus"];
  statuses.forEach((id) => {
    const target = document.getElementById(id);
    if (target) {
      target.textContent = message;
      target.style.display = "block";
    }
  });
});
