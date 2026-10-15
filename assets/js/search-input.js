/* A single debounce/IME policy for server-backed searches. */
export function bindSearch(input, search, delay = 300) {
  let timer;
  let composing = false;
  const run = () => {
    clearTimeout(timer);
    if (!composing) search(input.value.trim());
  };
  const schedule = event => {
    clearTimeout(timer);
    if (composing || event?.isComposing) return;
    if (!input.value.trim()) run(); else timer = setTimeout(run, delay);
  };
  input.addEventListener("compositionstart", () => { composing = true; clearTimeout(timer); });
  input.addEventListener("compositionend", () => { composing = false; schedule(); });
  input.addEventListener("input", schedule);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing && !composing) { event.preventDefault(); run(); }
  });
  return run;
}
