// modal.js — shared accessible confirm-dialog, used by report.js and popup.js.
// Both pages have identical `#modal-backdrop` / `#modal-card` / `#modal-message`
// / `#modal-actions` markup (see report.html / popup.html), so one
// implementation covers both instead of keeping two copies in sync.
//
// Adds what a bare role="dialog" doesn't give you for free: an accessible
// name (aria-labelledby -> the message), focus moved into the dialog on
// open, a Tab/Shift+Tab trap that keeps focus inside it, and focus restored
// to whatever triggered it on close.

// Shows `message` with one button per `choices` entry
// ({ key, label, className }), resolves with the clicked choice's key, or
// null if dismissed via backdrop click or Escape.
export function confirmChoice(message, choices) {
  return new Promise((resolve) => {
    const backdrop = document.querySelector("#modal-backdrop");
    const card = backdrop.querySelector(".modal-card");
    const messageEl = document.querySelector("#modal-message");
    const actions = document.querySelector("#modal-actions");

    messageEl.textContent = message;
    actions.innerHTML = "";
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.className = "btn " + (c.className || "");
      btn.textContent = c.label;
      btn.addEventListener("click", () => finish(c.key));
      actions.appendChild(btn);
    }

    const previouslyFocused = document.activeElement;
    const focusables = () =>
      [...card.querySelectorAll("button, [href], input, select, textarea, [tabindex]")]
        .filter((el) => !el.disabled && el.tabIndex !== -1);

    let done = false;
    const finish = (key) => {
      if (done) return;
      done = true;
      backdrop.hidden = true;
      backdrop.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKeydown);
      // Restore focus to whatever opened the dialog — a dialog shouldn't
      // strand keyboard/screen-reader users wherever it happened to close.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(key);
    };
    const onBackdropClick = (e) => {
      if (e.target === backdrop) finish(null);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") return finish(null);
      if (e.key !== "Tab") return;

      // Trap Tab/Shift+Tab inside the dialog so focus can't leak to the page
      // underneath while it's open.
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeydown);
    backdrop.hidden = false;
    focusables()[0]?.focus();
  });
}
