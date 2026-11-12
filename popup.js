const MIN = 0.25, MAX = 4;
const clamp = (r) => Math.min(MAX, Math.max(MIN, Math.round(r * 100) / 100));
const num = document.getElementById("num");
const range = document.getElementById("range");
const custom = document.getElementById("custom");
const segButtons = [...document.querySelectorAll("#seg button")];

function show(r) {
  num.textContent = +r.toFixed(2);
  range.value = r;
  const p = ((Math.min(Math.max(r, range.min), range.max) - range.min) / (range.max - range.min)) * 100;
  range.style.setProperty("--p", p + "%");
  segButtons.forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.v - r) < 0.001));
}

function save(r) {
  r = clamp(r);
  chrome.storage.local.set({ speed: r });
  show(r);
}

chrome.storage.local.get({ speed: 1 }, (d) => show(clamp(d.speed)));
range.addEventListener("input", () => save(parseFloat(range.value)));
segButtons.forEach((b) => b.addEventListener("click", () => save(parseFloat(b.dataset.v))));
custom.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const r = parseFloat(custom.value.replace(",", ".").replace("×", ""));
  if (r > 0) save(r);
  custom.value = "";
});
