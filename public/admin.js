const loginPanel = document.querySelector("#login-panel");
const editorPanel = document.querySelector("#editor-panel");
const loginForm = document.querySelector("#login-form");
const passwordInput = document.querySelector("#password");
const loginMessage = document.querySelector("#login-message");
const editorMessage = document.querySelector("#editor-message");
const editor = document.querySelector("#json-editor");
const fileLabel = document.querySelector("#file-label");
const saveButton = document.querySelector("#save");
const reloadButton = document.querySelector("#reload");
const tabs = [...document.querySelectorAll(".tab")];
let currentFile = "capes.json";
let savedText = "";

function message(el, text, kind = "") {
  el.textContent = text;
  el.className = `message ${kind}`.trim();
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showEditor() {
  loginPanel.classList.add("hidden");
  editorPanel.classList.remove("hidden");
}
function showLogin() {
  editorPanel.classList.add("hidden");
  loginPanel.classList.remove("hidden");
}
async function loadFile(file = currentFile) {
  currentFile = file;
  fileLabel.textContent = file;
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.file === file));
  try {
    const data = await api(`/api/${file}`);
    savedText = JSON.stringify(data, null, 2) + "\n";
    editor.value = savedText;
    message(editorMessage, `${file} loaded from the live host.`, "success");
  } catch (err) {
    message(editorMessage, err.message, "error");
    if (err.message.includes("Sign in")) showLogin();
  }
}
async function checkSession() {
  try {
    const session = await api("/api/session");
    if (session.authenticated) {
      showEditor();
      await loadFile();
    } else showLogin();
  } catch { showLogin(); }
}
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  message(loginMessage, "Signing in…");
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: passwordInput.value }) });
    passwordInput.value = "";
    message(loginMessage, "");
    showEditor();
    await loadFile("capes.json");
  } catch (err) { message(loginMessage, err.message, "error"); }
});
tabs.forEach(tab => tab.addEventListener("click", async () => {
  if (editor.value !== savedText && !confirm("Discard unsaved changes and switch files?")) return;
  await loadFile(tab.dataset.file);
}));
reloadButton.addEventListener("click", async () => {
  if (editor.value !== savedText && !confirm("Discard unsaved changes?")) return;
  await loadFile();
});
saveButton.addEventListener("click", async () => {
  let parsed;
  try { parsed = JSON.parse(editor.value); }
  catch (err) { message(editorMessage, `Invalid JSON syntax: ${err.message}`, "error"); return; }
  saveButton.disabled = true;
  message(editorMessage, "Validating and saving…");
  try {
    const result = await api(`/api/${currentFile}`, { method: "PUT", body: JSON.stringify(parsed) });
    savedText = JSON.stringify(parsed, null, 2) + "\n";
    editor.value = savedText;
    message(editorMessage, result.message, "success");
  } catch (err) { message(editorMessage, err.message, "error"); }
  finally { saveButton.disabled = false; }
});
document.querySelector("#logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
  showLogin();
  message(loginMessage, "Signed out.");
});
checkSession();
