const topVisuals = [...document.querySelectorAll(".top-visual")];
const scrollButton = document.querySelector(".scroll-button");
const floatingCoupon = document.querySelector(".mobile-floating-coupon");
const floatingCouponClose = document.querySelector(".mobile-floating-coupon__close");
const countdownBlocks = [...document.querySelectorAll("[data-countdown-target]")];
const stockAlerts = [...document.querySelectorAll("[data-benefit-stock-remaining]")];
let activeTop = 0;
let floatingCouponTimer;

function showTop(index) {
  topVisuals[activeTop]?.classList.remove("is-active");
  activeTop = index % topVisuals.length;
  topVisuals[activeTop]?.classList.add("is-active");
}

function nextSection() {
  const sections = [...document.querySelectorAll("main > section")];
  const current = window.scrollY + 90;
  const next = sections.find((section) => section.offsetTop > current) || sections[0];
  window.scrollTo({ top: next.offsetTop - 64, behavior: "smooth" });
}

scrollButton?.addEventListener("click", nextSection);

floatingCouponClose?.addEventListener("click", () => {
  floatingCoupon?.classList.add("is-hidden");
  window.clearTimeout(floatingCouponTimer);
  floatingCouponTimer = window.setTimeout(() => {
    floatingCoupon?.classList.remove("is-hidden");
  }, 60000);
});

if (topVisuals.length > 1) {
  window.setInterval(() => showTop(activeTop + 1), 2500);
}

function updateCountdown(block) {
  const target = new Date(block.dataset.countdownTarget).getTime();
  const remaining = target - Date.now();
  const daysEl = block.querySelector("[data-countdown-days]");
  const hoursEl = block.querySelector("[data-countdown-hours]");
  const minutesEl = block.querySelector("[data-countdown-minutes]");
  const secondsEl = block.querySelector("[data-countdown-seconds]");

  if (!Number.isFinite(target)) return;

  if (remaining <= 0) {
    block.classList.add("is-ended");
    const note = block.querySelector(".launch-countdown__note");
    if (daysEl) daysEl.textContent = "00";
    if (hoursEl) hoursEl.textContent = "00";
    if (minutesEl) minutesEl.textContent = "00";
    if (secondsEl) secondsEl.textContent = "00";
    if (note) note.textContent = "先行販売を開始しました。特典枠は終了次第、通常価格に切り替わります。";
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");

  if (daysEl) daysEl.textContent = pad(days);
  if (hoursEl) hoursEl.textContent = pad(hours);
  if (minutesEl) minutesEl.textContent = pad(minutes);
  if (secondsEl) secondsEl.textContent = pad(seconds);
}

if (countdownBlocks.length) {
  const tickCountdowns = () => countdownBlocks.forEach(updateCountdown);
  tickCountdowns();
  window.setInterval(tickCountdowns, 1000);
}

stockAlerts.forEach((alert) => {
  const total = Number(alert.dataset.benefitStockTotal || 50);
  const remaining = Math.max(0, Number(alert.dataset.benefitStockRemaining || 0));
  const count = alert.querySelector("[data-benefit-stock-count]");
  const bar = alert.querySelector(".benefit-stock-alert__bar span");
  const percentage = total > 0 ? Math.min(100, Math.round((remaining / total) * 100)) : 0;

  if (count) count.textContent = String(remaining);
  if (bar) bar.style.width = `${percentage}%`;
});
