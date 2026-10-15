/* Form, search and disclosure behavior shared by public and staff screens. */
const prepared = new WeakSet();
let controlId = 0;

function labelFor(field) {
  return field.labels?.[0]?.textContent?.trim() || field.getAttribute("aria-label") || field.placeholder || "This field";
}

function clearError(field) {
  const errorId = field.dataset.validationError;
  if (!errorId) return;
  document.getElementById(errorId)?.remove();
  field.removeAttribute("aria-invalid");
  const described = (field.getAttribute("aria-describedby") || "").split(" ").filter(id => id !== errorId).join(" ");
  if (described) field.setAttribute("aria-describedby", described); else field.removeAttribute("aria-describedby");
  delete field.dataset.validationError;
}

export function validateForm(form) {
  let first;
  for (const field of form.elements) {
    if (!field.willValidate) continue;
    clearError(field);
    if (field.validity.valid) continue;
    first ||= field;
    const error = document.createElement("p");
    error.id = `field-error-${++controlId}`; error.className = "field-error";
    const name = labelFor(field).replace(/\s*\*$/, "");
    error.textContent = field.validity.valueMissing ? `${name} is required.` : field.validity.typeMismatch ? `Enter a valid ${field.type === "email" ? "email address" : "URL"}.` : field.validationMessage;
    field.dataset.validationError = error.id;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
    const container = field.closest(".password-field, .search-field") || field;
    container.insertAdjacentElement("afterend", error);
  }
  first?.focus();
  return !first;
}

function enhance(element) {
  if (prepared.has(element)) return;
  prepared.add(element);
  if (element.matches("form")) { element.noValidate = true; return; }
  if (element.matches("textarea")) {
    const grow = () => {
      if (!element.isConnected || !element.getClientRects().length) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(Math.max(element.scrollHeight + 2, 64), 300)}px`;
    };
    element.addEventListener("input", grow); requestAnimationFrame(grow);
  }
  if (element.matches('input:not([type="hidden"]), textarea, select')) {
    if (!element.labels?.length && !element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) {
      element.setAttribute("aria-label", element.placeholder || element.name || element.id.replace(/([a-z])([A-Z])/g, "$1 $2") || "Input");
    }
  }
  if (element.matches('input[type="search"]')) {
    const wrapper = document.createElement("div"); wrapper.className = "search-field";
    element.before(wrapper); wrapper.append(element);
    const clear = document.createElement("button"); clear.type = "button"; clear.className = "search-clear";
    clear.textContent = "×"; clear.setAttribute("aria-label", `Clear ${labelFor(element).toLowerCase()}`);
    const sync = () => { clear.hidden = !element.value; };
    clear.addEventListener("click", () => { element.value = ""; element.dispatchEvent(new Event("input", { bubbles: true })); element.focus(); sync(); });
    element.addEventListener("input", sync); wrapper.append(clear); sync();
  }
  if (element.matches('input[type="password"]') && !element.closest(".password-field")) {
    const wrapper = document.createElement("div"); wrapper.className = "password-field";
    element.before(wrapper); wrapper.append(element);
    const button = document.createElement("button"); button.type = "button"; button.className = "password-toggle";
    button.textContent = "Show"; button.setAttribute("aria-label", `Show ${labelFor(element).toLowerCase()}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => { const show = element.type === "password"; element.type = show ? "text" : "password"; button.textContent = show ? "Hide" : "Show"; button.setAttribute("aria-pressed", String(show)); button.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${labelFor(element).toLowerCase()}`); });
    wrapper.append(button);
  }
}

function scan(root = document) {
  const selector = "form, input, textarea, select";
  if (root.matches?.(selector)) enhance(root);
  root.querySelectorAll?.(selector).forEach(enhance);
}

function boot() {
  scan();
  document.addEventListener("submit", event => {
    if (event.target instanceof HTMLFormElement && !event.submitter?.formNoValidate && !validateForm(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("input", event => { if (event.target.validity?.valid) clearError(event.target); });
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
