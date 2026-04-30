const topVisuals = [...document.querySelectorAll(".top-visual")];
const scrollButton = document.querySelector(".scroll-button");
const rouletteButton = document.querySelector(".launch-cta");
const roulettePanel = document.querySelector(".roulette-panel");
const rouletteWheel = document.querySelector(".roulette-wheel");
const rouletteStatus = document.querySelector(".roulette-status");
const rouletteResult = document.querySelector(".roulette-result");
let activeTop = 0;
let rouletteAngle = 0;
let rouletteRunning = false;
let rouletteAttempts = 0;
let rouletteCompleted = false;

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

if (topVisuals.length > 1) {
  window.setInterval(() => showTop(activeTop + 1), 2500);
}

function easeOutQuint(progress) {
  return 1 - Math.pow(1 - progress, 5);
}

function rouletteSpinEase(progress) {
  return easeOutQuint(progress);
}

function celebrateRoulette() {
  if (!roulettePanel) return;

  roulettePanel.querySelector(".roulette-confetti")?.remove();
  const confettiLayer = document.createElement("div");
  confettiLayer.className = "roulette-confetti";

  const colors = ["#ffd76d", "#ffffff", "#e40016", "#ff9f1c"];
  const pieces = 88;

  for (let index = 0; index < pieces; index += 1) {
    const piece = document.createElement("i");
    const angle = (Math.PI * 2 * index) / pieces;
    const distance = 110 + Math.random() * 210;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance + 90 + Math.random() * 90;

    piece.style.setProperty("--confetti-x", `${x}px`);
    piece.style.setProperty("--confetti-y", `${y}px`);
    piece.style.setProperty("--confetti-rotate", `${Math.random() * 360}deg`);
    piece.style.setProperty("--confetti-color", colors[index % colors.length]);
    piece.style.animationDelay = `${Math.random() * 180}ms`;
    confettiLayer.append(piece);
  }

  roulettePanel.append(confettiLayer);
  window.setTimeout(() => confettiLayer.remove(), 3200);
}

function hideRetryPopup() {
  roulettePanel?.querySelector(".roulette-retry-modal")?.remove();
}

function hideCouponPopup() {
  roulettePanel?.querySelector(".roulette-coupon-modal")?.remove();
}

function showRetryPopup() {
  if (!roulettePanel) return;

  hideRetryPopup();

  const retryModal = document.createElement("div");
  retryModal.className = "roulette-retry-modal";
  retryModal.innerHTML = `
    <div class="roulette-retry-card">
      <p>&#24796;&#12375;&#12356;&#65281;</p>
      <button class="roulette-retry-button" type="button">&#12418;&#12358;&#19968;&#22238;&#65281;</button>
    </div>
  `;

  retryModal.querySelector(".roulette-retry-button")?.addEventListener("click", () => {
    spinRoulette();
  });

  roulettePanel.append(retryModal);
}

function showCouponPopup() {
  if (!roulettePanel) return;

  hideCouponPopup();

  const couponModal = document.createElement("div");
  couponModal.className = "roulette-coupon-modal";
  couponModal.innerHTML = `
    <div class="roulette-coupon-card">
      <p class="coupon-kicker">&#12463;&#12540;&#12509;&#12531;&#29554;&#24471;</p>
      <h2>LINE&#30331;&#37682;&#12391;<br>&#38480;&#23450;&#12463;&#12540;&#12509;&#12531;&#12434;&#21463;&#12369;&#21462;&#12427;</h2>
      <div class="coupon-code-list">
        <div class="coupon-ticket">
          <strong>10,000&#20870;&#21106;&#24341;</strong>
          <span>1&#20491;&#36092;&#20837;</span>
        </div>
        <div class="coupon-ticket">
          <strong>25,000&#20870;&#21106;&#24341;</strong>
          <span>2&#20491;&#36092;&#20837;</span>
        </div>
      </div>
      <button class="roulette-line-button" type="button">LINE&#30331;&#37682;&#12391;&#29554;&#24471;</button>
    </div>
  `;

  roulettePanel.append(couponModal);

  couponModal.querySelector(".roulette-line-button")?.addEventListener("click", () => {
    window.open("https://lin.ee/Qi4NUTn", "_blank", "noopener,noreferrer");
  });
}

function spinRoulette(event) {
  event?.preventDefault();
  if (!roulettePanel || !rouletteWheel || rouletteRunning || rouletteCompleted) return;

  rouletteAttempts += 1;
  const isWinningSpin = rouletteAttempts >= 2;

  rouletteRunning = true;
  roulettePanel.hidden = false;
  roulettePanel.classList.remove("is-complete", "is-miss");
  rouletteButton?.classList.add("is-spinning");
  rouletteButton?.setAttribute("aria-disabled", "true");
  hideRetryPopup();
  hideCouponPopup();

  if (rouletteStatus) rouletteStatus.textContent = "";
  if (rouletteResult) rouletteResult.hidden = true;

  roulettePanel.scrollIntoView({ behavior: "smooth", block: "center" });

  const startAngle = rouletteAngle;
  const fullTurns = 7 * 360;
  const hitOffset = isWinningSpin ? -4 : -54;
  const normalizedStart = ((startAngle % 360) + 360) % 360;
  const finalAngle = startAngle + fullTurns + (360 - normalizedStart) + hitOffset;
  const duration = 4000;
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = rouletteSpinEase(progress);
    rouletteAngle = startAngle + (finalAngle - startAngle) * eased;
    rouletteWheel.style.transform = `rotate(${rouletteAngle}deg)`;

    if (progress < 1) {
      requestAnimationFrame(animate);
      return;
    }

    rouletteAngle = finalAngle;
    rouletteWheel.style.transform = `rotate(${rouletteAngle}deg)`;
    if (rouletteStatus) rouletteStatus.textContent = "";

    if (isWinningSpin) {
      rouletteCompleted = true;
      roulettePanel.classList.add("is-complete");
      if (rouletteResult) rouletteResult.hidden = false;
      celebrateRoulette();
      window.setTimeout(showCouponPopup, 900);
      rouletteButton?.classList.add("is-complete");
      rouletteButton?.setAttribute("aria-disabled", "true");
      rouletteButton?.querySelector("span")?.replaceChildren(document.createTextNode("抽選済み"));
    } else {
      roulettePanel.classList.add("is-miss");
      showRetryPopup();
    }

    rouletteButton?.classList.remove("is-spinning");
    if (!rouletteCompleted) {
      rouletteButton?.removeAttribute("aria-disabled");
    }
    rouletteRunning = false;
  }

  requestAnimationFrame(animate);
}

rouletteButton?.addEventListener("click", spinRoulette);
