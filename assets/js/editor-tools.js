function wrapSelection(textarea, before, after = before) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  textarea.value = next;
  const cursorStart = start + before.length;
  const cursorEnd = cursorStart + selected.length;
  textarea.setSelectionRange(cursorStart, cursorEnd);
  textarea.focus();
}

function prefixLines(textarea, prefix) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const before = value.slice(0, start);
  const selection = value.slice(start, end) || "";
  const lines = (selection || " ").split(/\r?\n/);
  const updated = lines.map((line) => `${prefix}${line.replace(/^\s*/, "")}`).join("\n");
  const next = `${before}${updated}${value.slice(end)}`;
  textarea.value = next;
  textarea.setSelectionRange(start, start + updated.length);
  textarea.focus();
}

function insertLink(textarea) {
  const url = prompt("Enter URL (https://...)");
  if (!url) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || "link text";
  const insert = `[${selected}](${url})`;
  const next = value.slice(0, start) + insert + value.slice(end);
  textarea.value = next;
  textarea.setSelectionRange(start + 1, start + 1 + selected.length);
  textarea.focus();
}

export function bindEditorToolbar(toolbarId, textareaId) {
  const toolbar = document.getElementById(toolbarId);
  const textarea = document.getElementById(textareaId);
  if (!toolbar || !textarea) return;

  toolbar.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (!action) return;
      if (action === "bold") wrapSelection(textarea, "**", "**");
      if (action === "italic") wrapSelection(textarea, "*", "*");
      if (action === "h2") prefixLines(textarea, "## ");
      if (action === "h3") prefixLines(textarea, "### ");
      if (action === "quote") prefixLines(textarea, "> ");
      if (action === "ul") prefixLines(textarea, "- ");
      if (action === "ol") prefixLines(textarea, "1. ");
      if (action === "link") insertLink(textarea);
    });
  });
}

function exec(command, value = null) {
  document.execCommand(command, false, value);
}

function formatBlock(tag) {
  exec("formatBlock", tag);
}

function createLinkFromSelection() {
  const url = prompt("Enter URL (https://...)");
  if (!url) return;
  exec("createLink", url);
}

export function bindRichEditorToolbar(toolbarId, editorId) {
  const toolbar = document.getElementById(toolbarId);
  const editor = document.getElementById(editorId);
  if (!toolbar || !editor) return;

  const normalizeEmpty = () => {
    if (!editor.innerText.trim()) {
      editor.innerHTML = "";
    }
  };

  toolbar.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (!action) return;
      editor.focus();
      if (action === "bold") exec("bold");
      if (action === "italic") exec("italic");
      if (action === "underline") exec("underline");
      if (action === "h2") formatBlock("h2");
      if (action === "h3") formatBlock("h3");
      if (action === "quote") formatBlock("blockquote");
      if (action === "ul") exec("insertUnorderedList");
      if (action === "ol") exec("insertOrderedList");
      if (action === "link") createLinkFromSelection();
      if (action === "left") exec("justifyLeft");
      if (action === "center") exec("justifyCenter");
      if (action === "right") exec("justifyRight");
      if (action === "undo") exec("undo");
      if (action === "redo") exec("redo");
      if (action === "clear") exec("removeFormat");
      normalizeEmpty();
    });
  });

  editor.addEventListener("blur", normalizeEmpty);
}
