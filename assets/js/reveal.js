let observer = null;
let reduceMotion = null;

function ensureObserver() {
  if (observer) return;
  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion.matches) return;
  if (!("IntersectionObserver" in window)) return;
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
}

export function setupReveal(scope = document) {
  ensureObserver();
  const nodes = Array.from(scope.querySelectorAll("[data-reveal]:not([data-reveal-ready])"));
  if (!nodes.length) return;
  if (reduceMotion && reduceMotion.matches) {
    nodes.forEach((node) => {
      node.dataset.revealReady = "true";
      node.classList.add("in");
    });
    return;
  }
  if (!observer) {
    nodes.forEach((node) => {
      node.dataset.revealReady = "true";
      node.classList.add("in");
    });
    return;
  }
  nodes.forEach((node, index) => {
    node.dataset.revealReady = "true";
    if (!node.style.getPropertyValue("--delay")) {
      node.style.setProperty("--delay", `${index * 0.06}s`);
    }
    observer.observe(node);
  });
}
