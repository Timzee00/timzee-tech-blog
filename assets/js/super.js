import { bindStaffLogin } from "./staff-auth.js";

bindStaffLogin({ formId: "superLoginForm", roles: ["super"], destination: "professional-panel.html" });
