// Coalesce simultaneous reads only. A completed request is never cached,
// so sign-in/sign-out and refreshed server permissions are observed next time.
export function singleFlight(task) {
  let pending = null;
  return (...args) => {
    if (pending) return pending;
    const request = Promise.resolve().then(() => task(...args));
    pending = request;
    void request.then(
      () => { if (pending === request) pending = null; },
      () => { if (pending === request) pending = null; }
    );
    return request;
  };
}
