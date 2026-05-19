export const authPromise = fetch("/api/me")
  .then((r) => r.json())
  .catch(() => ({ authenticated: false }));

function updateAuthUI(data) {
  const loggedOutEls = document.querySelectorAll('[data-auth="logged-out"]');
  const loggedInEls = document.querySelectorAll('[data-auth="logged-in"]');
  const userNameEls = document.querySelectorAll('[data-auth="user-name"]');

  if (data.authenticated) {
    for (const el of loggedOutEls) el.hidden = true;
    for (const el of loggedInEls) el.hidden = false;
    for (const el of userNameEls) el.textContent = data.user.displayName;
  } else {
    for (const el of loggedOutEls) el.hidden = false;
    for (const el of loggedInEls) el.hidden = true;
  }
}

const isDashboard = document.body.dataset.page === "dashboard";

authPromise.then((data) => {
  if (isDashboard && !data.authenticated) {
    window.location.replace("/");
    return;
  }

  updateAuthUI(data);

  if (isDashboard && data.authenticated) {
    const loading = document.getElementById("auth-loading");
    const content = document.getElementById("dashboard-content");
    const greeting = document.getElementById("user-greeting");
    if (loading) loading.hidden = true;
    if (content) content.hidden = false;
    if (greeting) greeting.textContent = data.user.displayName;
  }
});
